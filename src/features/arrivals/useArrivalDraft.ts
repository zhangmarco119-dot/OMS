import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { createUuid } from '../../lib/uuid';
import { supabase } from '../../lib/supabase';
import {
  applyArrivalOpenedAt,
  loadOrCreateArrivalDraft,
  localArrivalDate,
  localArrivalTime,
  saveArrivalDraft,
  submitArrivalReport,
  type ArrivalReportRow,
  type ProductRow,
} from '../../services/arrivals.service';
import {
  loadArrivalImages,
  removeArrivalImage,
  uploadArrivalImage,
  type ArrivalImageType,
  type ArrivalImageWithUrl,
} from '../../services/arrival-images.service';
import { createEmptyArrivalItem, getArrivalValidationIssues, type ArrivalDraftItem } from './arrivalForm';

export interface ArrivalDraftFormState {
  arrivalDate: string;
  arrivalTime: string;
  carrierName: string;
  items: ArrivalDraftItem[];
  note: string;
  trackingNo: string;
}

type LoadStatus = 'loading' | 'ready' | 'error';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const cachedFormSchema = z.object({
  form: z.object({
    arrivalDate: z.string(),
    arrivalTime: z.string(),
    carrierName: z.string(),
    items: z.array(z.object({
      id: z.string().uuid(),
      isUnmatchedProduct: z.boolean(),
      note: z.string(),
      productId: z.string().uuid().nullable(),
      productName: z.string(),
      quantity: z.string(),
      sortOrder: z.number().int().nonnegative(),
      spec: z.string(),
      unit: z.string(),
    })),
    note: z.string(),
    trackingNo: z.string(),
  }),
  reportId: z.string().uuid(),
  version: z.number().int().positive(),
});

const cacheKey = (profileId: string, storeId: string) =>
  `storehub:v2:arrival-draft:${profileId}:${storeId}`;

const readCachedForm = (profileId: string, storeId: string, reportId: string, version: number) => {
  try {
    const raw = window.localStorage.getItem(cacheKey(profileId, storeId));
    if (!raw) return null;
    const parsed = cachedFormSchema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.reportId === reportId && parsed.data.version === version) {
      return parsed.data.form;
    }
    window.localStorage.removeItem(cacheKey(profileId, storeId));
    return null;
  } catch {
    window.localStorage.removeItem(cacheKey(profileId, storeId));
    return null;
  }
};

const writeCachedForm = (
  profileId: string,
  storeId: string,
  reportId: string,
  version: number,
  form: ArrivalDraftFormState,
) => {
  try {
    window.localStorage.setItem(cacheKey(profileId, storeId), JSON.stringify({ form, reportId, version }));
  } catch {
    // Database autosave still protects complete fields when local storage is unavailable.
  }
};

export function useArrivalDraft(profileId: string | undefined, storeId: string | undefined) {
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [report, setReport] = useState<ArrivalReportRow | null>(null);
  const [form, setForm] = useState<ArrivalDraftFormState | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [images, setImages] = useState<ArrivalImageWithUrl[]>([]);
  const [uploadCount, setUploadCount] = useState(0);
  const [dirtyRevision, setDirtyRevision] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);

  const reportRef = useRef<ArrivalReportRow | null>(null);
  const formRef = useRef<ArrivalDraftFormState | null>(null);
  const savePromiseRef = useRef<Promise<ArrivalReportRow> | null>(null);
  const saveAgainRef = useRef(false);
  const idempotencyKeyRef = useRef(createUuid());

  useEffect(() => {
    if (!supabase || !profileId || !storeId) {
      setLoadStatus('error');
      setMessage('需要先登录并配置 Supabase，才能使用到货上报。');
      return;
    }

    let cancelled = false;
    setLoadStatus('loading');
    setMessage(null);
    setSaveStatus('idle');
    const openedAt = new Date();

    void (async () => {
      try {
        const draft = await loadOrCreateArrivalDraft(supabase, storeId, profileId);
        const loadedImages = await loadArrivalImages(supabase, draft.report.id);
        if (cancelled) return;

        const hasSavedContent = draft.items.length > 0
          || loadedImages.length > 0
          || Boolean(draft.report.carrier_name || draft.report.tracking_no || draft.report.note)
          || draft.report.updated_at !== draft.report.created_at;
        const databaseForm: ArrivalDraftFormState = {
          arrivalDate: hasSavedContent ? draft.report.arrival_date : localArrivalDate(),
          arrivalTime: hasSavedContent ? draft.report.arrival_time?.slice(0, 5) ?? '' : localArrivalTime(),
          carrierName: draft.report.carrier_name ?? '',
          items: draft.items.length > 0 ? draft.items : [createEmptyArrivalItem()],
          note: draft.report.note ?? '',
          trackingNo: draft.report.tracking_no ?? '',
        };
        const restoredDraft = hasSavedContent
          ? readCachedForm(profileId, storeId, draft.report.id, draft.report.version) ?? databaseForm
          : databaseForm;
        // Always show the actual device-local moment captured when this page was
        // opened. Existing draft products, images and notes remain untouched.
        const restored = applyArrivalOpenedAt(restoredDraft, openedAt);
        reportRef.current = draft.report;
        formRef.current = restored;
        setReport(draft.report);
        setForm(restored);
        setProducts(draft.products);
        setImages(loadedImages);
        setDirtyRevision(0);
        setLoadStatus('ready');
      } catch (error) {
        if (!cancelled) {
          setLoadStatus('error');
          setMessage(error instanceof Error ? error.message : '加载到货草稿失败。');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profileId, reloadToken, storeId]);

  const updateForm = useCallback((updater: (current: ArrivalDraftFormState) => ArrivalDraftFormState) => {
    setForm((current) => {
      if (!current) return current;
      const next = updater(current);
      formRef.current = next;
      if (profileId && storeId && reportRef.current) {
        writeCachedForm(profileId, storeId, reportRef.current.id, reportRef.current.version, next);
      }
      return next;
    });
    setDirtyRevision((revision) => revision + 1);
    setSaveStatus('idle');
  }, [profileId, storeId]);

  const saveNow = useCallback((): Promise<ArrivalReportRow> => {
    if (!supabase) {
      return Promise.reject(new Error('Supabase 未配置。'));
    }
    if (savePromiseRef.current) {
      saveAgainRef.current = true;
      return savePromiseRef.current;
    }

    const run = (async () => {
      let latest: ArrivalReportRow | null = null;
      do {
        saveAgainRef.current = false;
        const currentReport = reportRef.current;
        const currentForm = formRef.current;
        if (!currentReport || !currentForm) {
          throw new Error('到货草稿尚未加载。');
        }

        setSaveStatus('saving');
        setMessage(null);
        latest = await saveArrivalDraft(supabase, {
          arrivalDate: currentForm.arrivalDate,
          arrivalTime: currentForm.arrivalTime,
          carrierName: currentForm.carrierName,
          expectedVersion: currentReport.version,
          items: currentForm.items,
          note: currentForm.note,
          reportId: currentReport.id,
          trackingNo: currentForm.trackingNo,
        });
        reportRef.current = latest;
        setReport(latest);
        if (profileId && storeId && formRef.current) {
          writeCachedForm(profileId, storeId, latest.id, latest.version, formRef.current);
        }
        setSaveStatus('saved');
      } while (saveAgainRef.current);

      if (!latest) {
        throw new Error('到货草稿保存没有返回结果。');
      }
      return latest;
    })().catch((error) => {
      setSaveStatus('error');
      setMessage(error instanceof Error ? error.message : '保存草稿失败。');
      throw error;
    }).finally(() => {
      savePromiseRef.current = null;
    });

    savePromiseRef.current = run;
    return run;
  }, [profileId, storeId]);

  useEffect(() => {
    if (loadStatus !== 'ready' || dirtyRevision === 0) return undefined;
    const timer = window.setTimeout(() => {
      void saveNow().catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [dirtyRevision, loadStatus, saveNow]);

  const updateField = useCallback(<Key extends keyof Omit<ArrivalDraftFormState, 'items'>>(
    key: Key,
    value: ArrivalDraftFormState[Key],
  ) => {
    updateForm((current) => ({ ...current, [key]: value }));
  }, [updateForm]);

  const updateItem = useCallback((itemId: string, updater: (item: ArrivalDraftItem) => ArrivalDraftItem) => {
    updateForm((current) => ({
      ...current,
      items: current.items.map((item) => item.id === itemId ? updater(item) : item),
    }));
  }, [updateForm]);

  const addItem = useCallback(() => {
    updateForm((current) => ({
      ...current,
      items: [...current.items, createEmptyArrivalItem(current.items.length)],
    }));
  }, [updateForm]);

  const removeItem = useCallback(async (itemId: string) => {
    if (!supabase) throw new Error('Supabase 未配置。');
    const itemImages = images.filter((image) => image.arrival_item_id === itemId);
    try {
      for (const image of itemImages) {
        await removeArrivalImage(supabase, image);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除产品图片失败，请重试。');
      return;
    }
    if (itemImages.length > 0) {
      setImages((current) => current.filter((image) => image.arrival_item_id !== itemId));
    }
    updateForm((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== itemId)
        .map((item, index) => ({ ...item, sortOrder: index })),
    }));
  }, [images, updateForm]);

  const addImage = useCallback(async (
    file: File,
    imageType: ArrivalImageType,
    onProgress?: (progress: number) => void,
    arrivalItemId?: string | null,
  ) => {
    if (!supabase || !profileId || !storeId || !reportRef.current) {
      throw new Error('到货草稿尚未加载。');
    }
    setUploadCount((count) => count + 1);
    try {
      const uploaded = await uploadArrivalImage(supabase, {
        arrivalItemId,
        file,
        imageType,
        profileId,
        reportId: reportRef.current.id,
        storeId,
      }, onProgress);
      setImages((current) => [...current, uploaded]);
      return uploaded;
    } finally {
      setUploadCount((count) => Math.max(0, count - 1));
    }
  }, [profileId, storeId]);

  const deleteImage = useCallback(async (image: ArrivalImageWithUrl) => {
    if (!supabase) throw new Error('Supabase 未配置。');
    await removeArrivalImage(supabase, image);
    setImages((current) => current.filter((entry) => entry.id !== image.id));
  }, []);

  const submit = useCallback(async () => {
    if (!supabase || !profileId || !storeId || !formRef.current || !reportRef.current) {
      throw new Error('到货草稿尚未加载。');
    }

    const issues = getArrivalValidationIssues({
      goodsImageItemIds: images
        .filter((image) => image.image_type === 'goods' && image.arrival_item_id)
        .map((image) => image.arrival_item_id as string),
      items: formRef.current.items,
      uploadCount,
      waybillImageCount: images.filter((image) => image.image_type === 'waybill').length,
    });
    if (issues.length > 0) {
      throw new Error(issues[0]);
    }

    const saved = await saveNow();
    await submitArrivalReport(supabase, saved.id, saved.version, idempotencyKeyRef.current);
    try {
      window.localStorage.removeItem(cacheKey(profileId, storeId));
    } catch {
      // A stale local cache is ignored because the submitted report is no longer a draft.
    }
    return saved.id;
  }, [images, profileId, saveNow, storeId, uploadCount]);

  return {
    addImage,
    addItem,
    deleteImage,
    form,
    images,
    loadStatus,
    message,
    products,
    reload: () => setReloadToken((token) => token + 1),
    removeItem,
    report,
    saveNow,
    saveStatus,
    submit,
    updateField,
    updateItem,
    uploadCount,
  };
}
