import { Archive, ArchiveRestore, Download, FileText, FileUp, FolderPlus, ImageIcon, ListChecks, Pencil, Pin, Plus, RefreshCw, Rocket, Save, Search, Trash2, Undo2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { BatchImportReportDialog } from '../components/feedback/BatchImportReportDialog';
import { SuccessToast } from '../components/feedback/SuccessToast';
import { FeedbackBanner } from '../components/ui/Feedback';
import { useAuth } from '../features/auth/AuthContext';
import type { SopBatchImportProgress, SopBatchImportResult } from '../features/content/sopBatchImport';
import { formatSopActionError, type SopSaveStage } from '../features/content/sopFeedback';
import { useSopCategoryFilter } from '../features/content/useSopCategoryFilter';
import { SopImageUpload, type SopImageUploadStatus } from '../features/content/SopImageUpload';
import { normalizeSopSteps, type OrderedSopStep } from '../features/content/sopSteps';
import { getSopPreviewAsset } from '../features/content/sopPreview';
import { filterAdminSops } from '../features/content/sopLibrary';
import { TaskTemplateReferenceImageUpload } from '../features/task-templates/TaskTemplateReferenceImageUpload';
import { supabase } from '../lib/supabase';
import {
  archiveSop,
  archiveNotice,
  createEmptyNoticeDraft,
  createEmptySopDraft,
  createSopCategory,
  createSopTextStep,
  deleteArchivedSop,
  deleteSopCategory,
  deleteSopAsset,
  deleteNotice,
  loadNotices,
  loadSopCategories,
  loadSopArchiveCount,
  loadSopDetail,
  loadSopPage,
  publishNotice,
  publishSop,
  renameSopCategory,
  removeSopStepImage,
  retractSop,
  unarchiveSop,
  reorderSopAssets,
  retractNotice,
  saveNotice,
  saveSop,
  uploadSopAsset,
  uploadNoticeAsset,
  updateSopAssetSteps,
  type NoticeDraft,
  type NoticeListItem,
  type SopDraft,
  type SopListItem,
  type SopCategoryRow,
} from '../services/v2-content.service';

export type AdminContentSection = 'notices' | 'sops';
type ContentRecipient = { display_name: string; id: string; role: 'staff' | 'manager'; store_id: string };
type SopBatchLifecycleAction = 'publish' | 'retract' | 'archive';

const sopBatchLifecycleCopy: Record<SopBatchLifecycleAction, { button: string; eligibleStatus: SopListItem['status']; success: string; title: string }> = {
  archive: { button: '批量归档', eligibleStatus: 'draft', success: '归档', title: '选择需要归档的待发布 SOP' },
  publish: { button: '批量发布', eligibleStatus: 'draft', success: '发布', title: '选择需要发布的 SOP 草稿' },
  retract: { button: '批量撤回', eligibleStatus: 'published', success: '撤回', title: '选择需要撤回的已发布 SOP' },
};

const noticeStatus: Record<NoticeListItem['status'], string> = { archived: '已归档', draft: '待发布', published: '已发布', retracted: '待发布' };
const sopStatus: Record<SopListItem['status'], string> = { archived: '已归档', draft: '待发布', published: '已发布' };
const revokeLocalUrl = (url: string) => { if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url); };
const SOP_PAGE_SIZE = 16;

export function AdminContentPage({ section }: { section: AdminContentSection }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [sopCategoryFilter, setSopCategoryFilter] = useSopCategoryFilter();
  const [sopSearch, setSopSearch] = useState('');
  const [debouncedSopSearch, setDebouncedSopSearch] = useState('');
  const [notices, setNotices] = useState<NoticeListItem[]>([]);
  const [sops, setSops] = useState<SopListItem[]>([]);
  const [archivedSops, setArchivedSops] = useState<SopListItem[]>([]);
  const [sopTotal, setSopTotal] = useState(0);
  const [archivedSopTotal, setArchivedSopTotal] = useState(0);
  const [loadingMoreSops, setLoadingMoreSops] = useState(false);
  const [loadingMoreArchivedSops, setLoadingMoreArchivedSops] = useState(false);
  const [sopCategories, setSopCategories] = useState<SopCategoryRow[]>([]);
  const [recipientProfiles, setRecipientProfiles] = useState<ContentRecipient[]>([]);
  const [noticeDraft, setNoticeDraft] = useState<NoticeDraft | null>(null);
  const [sopDraft, setSopDraft] = useState<SopDraft | null>(null);
  const [showSopBatchOperations, setShowSopBatchOperations] = useState(false);
  const [showSopBatchImport, setShowSopBatchImport] = useState(false);
  const [showSopCategoryManager, setShowSopCategoryManager] = useState(false);
  const [showSopArchiveManager, setShowSopArchiveManager] = useState(false);
  const [showNoticeArchiveManager, setShowNoticeArchiveManager] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [sopExportMode, setSopExportMode] = useState(false);
  const [sopBatchAction, setSopBatchAction] = useState<SopBatchLifecycleAction | null>(null);
  const [sopBatchActionProgress, setSopBatchActionProgress] = useState<{ completed: number; total: number } | null>(null);
  const [selectedSopIds, setSelectedSopIds] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sopDraftRef = useRef<SopDraft | null>(null);
  const sopsRef = useRef<SopListItem[]>([]);
  const sopLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const contentLoadedRef = useRef(false);
  const refreshRequestRef = useRef(0);

  useEffect(() => { sopDraftRef.current = sopDraft; }, [sopDraft]);
  useEffect(() => { sopsRef.current = sops; }, [sops]);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSopSearch(sopSearch), 250); return () => window.clearTimeout(timer); }, [sopSearch]);

  const updateSopDraft = (nextDraft: SopDraft | null) => {
    sopDraftRef.current = nextDraft;
    setSopDraft(nextDraft);
  };

  const updateSops = (nextSops: SopListItem[]) => {
    sopsRef.current = nextSops;
    setSops(nextSops);
  };

  const withOrderedImages = (sop: SopListItem, orderedAssetIds: string[]): SopListItem => {
    const byId = new Map(sop.assetUrls.map((asset) => [asset.id, asset]));
    const images = orderedAssetIds.flatMap((id, index) => {
      const asset = byId.get(id);
      return asset ? [{ ...asset, sort_order: index }] : [];
    });
    return { ...sop, assetUrls: [...images, ...sop.assetUrls.filter((asset) => asset.asset_kind !== 'step')] };
  };

  const refresh = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage(`缺少 Supabase 配置，暂时无法管理${section === 'notices' ? '公告' : ' SOP'}。`); return; }
    const requestId = ++refreshRequestRef.current;
    if (!contentLoadedRef.current) setStatus('loading');
    try {
      if (section === 'notices') {
        const [nextNotices, profiles] = await Promise.all([
          loadNotices(supabase),
          supabase.from('profiles').select('id,display_name,role,store_id').in('role', ['staff', 'manager']).eq('is_active', true).is('deleted_at', null),
        ]);
        if (profiles.error) throw new Error(profiles.error.message);
        if (requestId !== refreshRequestRef.current) return;
        setNotices(nextNotices);
        setRecipientProfiles((profiles.data ?? []) as ContentRecipient[]);
      } else {
        const [activePage, archiveCount, nextCategories] = await Promise.all([
          loadSopPage(supabase, { archived: false, category: sopCategoryFilter, limit: SOP_PAGE_SIZE, search: debouncedSopSearch }),
          loadSopArchiveCount(supabase),
          loadSopCategories(supabase),
        ]);
        if (requestId !== refreshRequestRef.current) return;
        sopsRef.current = activePage.items;
        setSops(activePage.items);
        setSopTotal(activePage.total);
        setArchivedSopTotal(archiveCount);
        setSopCategories(nextCategories);
      }
      contentLoadedRef.current = true;
      setStatus('ready');
      setMessage(null);
    } catch (error) {
      if (requestId !== refreshRequestRef.current) return;
      setStatus('error');
      setMessage(error instanceof Error ? error.message : `加载${section === 'notices' ? '公告' : ' SOP'}失败。`);
    }
  }, [debouncedSopSearch, section, sopCategoryFilter]);
  useEffect(() => { void refresh(); }, [refresh]);
  const loadMoreSops = useCallback(async () => {
    if (!supabase || section !== 'sops' || loadingMoreSops || sopsRef.current.length >= sopTotal) return;
    setLoadingMoreSops(true);
    try {
      const page = await loadSopPage(supabase, { archived: false, category: sopCategoryFilter, limit: SOP_PAGE_SIZE, offset: sopsRef.current.length, search: debouncedSopSearch });
      const next = [...sopsRef.current, ...page.items.filter((entry) => !sopsRef.current.some((current) => current.id === entry.id))];
      updateSops(next);
      setSopTotal(page.total);
    } catch { setMessage('加载更多 SOP 失败，请稍后重试。'); }
    finally { setLoadingMoreSops(false); }
  }, [debouncedSopSearch, loadingMoreSops, section, sopCategoryFilter, sopTotal]);
  useEffect(() => {
    const target = sopLoadMoreRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) void loadMoreSops(); }, { rootMargin: '500px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMoreSops]);
  useEffect(() => {
    if (section === 'sops' && status === 'ready' && sopCategoryFilter !== 'all' && !sopCategories.some((category) => category.name === sopCategoryFilter)) {
      setSopCategoryFilter('all');
    }
  }, [section, setSopCategoryFilter, sopCategories, sopCategoryFilter, status]);
  const defaultStores = auth.availableStores.map((store) => store.id);
  const storeName = (id: string) => auth.availableStores.find((store) => store.id === id)?.short_name ?? '未知门店';

  const saveNoticeDraft = async (publishAfterSave = false) => {
    if (!supabase || !noticeDraft) return;
    setBusy(true);
    try { const saved = await saveNotice(supabase, noticeDraft); if (publishAfterSave) await publishNotice(supabase, saved.id); setNoticeDraft(null); await refresh(); setSuccess(publishAfterSave ? '公告已发布。' : '公告草稿已保存。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存公告失败。'); }
    finally { setBusy(false); }
  };
  const saveSopDraft = async (changes: SopEditorChanges = { deletedAssets: [], existingSteps: [], pendingAssets: [], removedImageAssets: [], replacements: [] }) => {
    if (!supabase || !sopDraft || !auth.profile) return false;
    setBusy(true);
    setMessage(null);
    let stage: SopSaveStage = 'saving';
    try {
      const saved = await saveSop(supabase, sopDraft);
      updateSopDraft({ ...sopDraft, id: saved.id });
      stage = 'uploading';
      await updateSopAssetSteps(supabase, changes.existingSteps);
      for (const replacement of changes.replacements) {
        await replaceSopImage(replacement.asset, replacement.file, replacement.stepText, () => undefined, replacement.sortOrder);
      }
      for (const asset of changes.pendingAssets) {
        if (asset.file) await uploadSopAsset(supabase, { assetKind: asset.assetKind, file: asset.file, profileId: auth.profile.id, sopId: saved.id, sortOrder: asset.sortOrder, stepText: asset.stepText });
        else if (asset.assetKind === 'step') await createSopTextStep(supabase, { sopId: saved.id, sortOrder: asset.sortOrder, stepText: asset.stepText });
        else throw new Error('SOP 封面或附件缺少待上传文件。');
      }
      for (const asset of changes.removedImageAssets) {
        await removeSopStepImage(supabase, asset);
      }
      for (const asset of changes.deletedAssets) {
        await deleteSopAsset(supabase, asset);
      }
      await refresh();
      setSuccess(`SOP 草稿已保存${changes.pendingAssets.length ? `，已上传 ${changes.pendingAssets.length} 个步骤或附件。` : '。'}`);
      return true;
    }
    catch (error) { setMessage(formatSopActionError(stage, error)); return false; }
    finally { setBusy(false); }
  };
  const saveAndPreviewSop = async (changes: SopEditorChanges) => {
    const succeeded = await saveSopDraft(changes);
    const sopId = sopDraftRef.current?.id;
    if (succeeded && sopId) {
      updateSopDraft(null);
      navigate(`/app/sops/${sopId}`);
    }
    return succeeded;
  };
  const run = async (action: () => Promise<unknown>, successText: string) => {
    setBusy(true); setMessage(null);
    try { await action(); await refresh(); setSuccess(successText); }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失败。'); }
    finally { setBusy(false); }
  };
  const removeSopAsset = async (asset: SopListItem['assetUrls'][number]) => {
    const client = supabase;
    if (!client) return;
    const owner = sopsRef.current.find((sop) => sop.assetUrls.some((entry) => entry.id === asset.id));
    if (!owner) return;
    setBusy(true); setMessage(null);
    try {
      const deletion = await deleteSopAsset(client, asset);
      const remainingIds = owner.assetUrls
        .filter((entry) => entry.id !== asset.id && entry.asset_kind === 'step')
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((entry) => entry.id);
      updateSops(sopsRef.current.map((sop) => sop.id === owner.id
        ? withOrderedImages({ ...sop, assetUrls: sop.assetUrls.filter((entry) => entry.id !== asset.id) }, remainingIds)
        : sop));
      await reorderSopAssets(client, owner.id, remainingIds);
      if (deletion.storageCleanupFailed) setMessage('记录已删除，但存储文件清理失败，请联系管理员处理。');
      setSuccess(asset.asset_kind === 'step'
        ? 'SOP 步骤已删除，后续步骤序号已自动更新。'
        : asset.asset_kind === 'cover'
          ? 'SOP 产品图已删除，列表将自动使用最后一个步骤图。'
          : 'SOP 附件已删除。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除 SOP 图片失败。');
    } finally { setBusy(false); }
  };
  const uploadSopImage = async (file: File, insertAt: number, onProgress: (progress: number) => void) => {
    const client = supabase; const profile = auth.profile; const currentDraft = sopDraftRef.current;
    if (!client || !profile || !currentDraft?.id) throw new Error('SOP 草稿尚未加载。');
    setBusy(true); setMessage(null);
    try {
      // Existing drafts already have a durable id, so image upload must not
      // validate or persist the currently edited text fields. Those checks run
      // only when the administrator explicitly saves or opens publish preview.
      const existingSop = sopsRef.current.find((sop) => sop.id === currentDraft.id);
      if (!existingSop) throw new Error('无法识别当前 SOP 草稿，请重新打开后再试。');
      const currentImages = [...existingSop.assetUrls.filter((asset) => asset.asset_kind === 'step')].sort((left, right) => left.sort_order - right.sort_order);
      const targetIndex = Math.max(0, Math.min(insertAt, currentImages.length));
      const uploaded = await uploadSopAsset(client, { file, profileId: profile.id, sopId: currentDraft.id, sortOrder: targetIndex, stepText: '' }, onProgress);
      currentImages.splice(targetIndex, 0, uploaded);
      const orderedAssetIds = currentImages.map((entry) => entry.id);
      try {
        await reorderSopAssets(client, currentDraft.id, orderedAssetIds);
      } catch (error) {
        await deleteSopAsset(client, uploaded).catch(() => undefined);
        throw error;
      }
      const nextSop = withOrderedImages({ ...existingSop, assetUrls: [...existingSop.assetUrls, uploaded] }, orderedAssetIds);
      updateSops(sopsRef.current.map((sop) => sop.id === currentDraft.id ? nextSop : sop));
      setSuccess('SOP 图片已上传并保存。');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '上传 SOP 图片失败。';
      setMessage(errorMessage);
      throw new Error(errorMessage);
    } finally { setBusy(false); }
  };
  const replaceSopImage = async (asset: SopListItem['assetUrls'][number], file: File, stepText: string, onProgress: (progress: number) => void, sortOrder = asset.sort_order) => {
    const client = supabase; const profile = auth.profile;
    if (!client || !profile) throw new Error('SOP 草稿尚未加载。');
    const owner = sopsRef.current.find((sop) => sop.assetUrls.some((entry) => entry.id === asset.id));
    if (!owner || asset.asset_kind !== 'step') throw new Error('无法识别需要替换的 SOP 步骤。');
    setBusy(true); setMessage(null);
    try {
      const uploaded = await uploadSopAsset(client, {
        assetKind: 'step',
        file,
        profileId: profile.id,
        sopId: owner.id,
        sortOrder,
        stepText,
      }, onProgress);
      try {
        await deleteSopAsset(client, asset);
      } catch (error) {
        await deleteSopAsset(client, uploaded).catch(() => undefined);
        throw error;
      }
      const orderedAssetIds = owner.assetUrls
        .filter((entry) => entry.asset_kind === 'step')
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((entry) => entry.id === asset.id ? uploaded.id : entry.id);
      const nextOwner = withOrderedImages({
        ...owner,
        assetUrls: owner.assetUrls.map((entry) => entry.id === asset.id ? uploaded : entry),
      }, orderedAssetIds);
      updateSops(sopsRef.current.map((sop) => sop.id === owner.id ? nextOwner : sop));
      setSuccess(`第 ${asset.sort_order + 1} 步图片已替换。`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '替换 SOP 图片失败。';
      setMessage(errorMessage);
      throw new Error(errorMessage);
    } finally { setBusy(false); }
  };
  const uploadSopCover = async (file: File, onProgress: (progress: number) => void) => {
    const client = supabase; const profile = auth.profile; const currentDraft = sopDraftRef.current;
    if (!client || !profile || !currentDraft?.id) throw new Error('SOP 草稿尚未加载。');
    setBusy(true); setMessage(null);
    try {
      const existingSop = sopsRef.current.find((sop) => sop.id === currentDraft.id);
      if (!existingSop) throw new Error('无法识别当前 SOP 草稿，请重新打开后再试。');
      const oldCovers = existingSop.assetUrls.filter((asset) => asset.asset_kind === 'cover');
      const uploaded = await uploadSopAsset(client, {
        assetKind: 'cover', file, profileId: profile.id, sopId: currentDraft.id, sortOrder: 0, stepText: '',
      }, onProgress);
      const nextSop = { ...existingSop, assetUrls: [...existingSop.assetUrls.filter((asset) => asset.asset_kind !== 'cover'), uploaded] };
      updateSops(sopsRef.current.map((sop) => sop.id === currentDraft.id ? nextSop : sop));
      for (const cover of oldCovers) await deleteSopAsset(client, cover).catch(() => undefined);
      setSuccess('SOP 产品图已上传并立即设为列表预览图。');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '上传 SOP 产品图失败。';
      setMessage(errorMessage);
      throw new Error(errorMessage);
    } finally { setBusy(false); }
  };
  const reorderSopImages = async (orderedAssetIds: string[]) => {
    const client = supabase; const sopId = sopDraftRef.current?.id;
    if (!client || !sopId) throw new Error('请先保存 SOP 草稿后再调整步骤顺序。');
    setBusy(true); setMessage(null);
    try {
      await reorderSopAssets(client, sopId, orderedAssetIds);
      updateSops(sopsRef.current.map((sop) => sop.id === sopId ? withOrderedImages(sop, orderedAssetIds) : sop));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '保存 SOP 步骤顺序失败。';
      setMessage(errorMessage);
      throw new Error(errorMessage);
    } finally { setBusy(false); }
  };
  const uploadNotice = async (file: File | undefined) => {
    const client = supabase; const profile = auth.profile; const noticeId = noticeDraft?.id;
    if (!file || !client || !profile || !noticeId) return;
    await run(() => uploadNoticeAsset(client, { file, noticeId, profileId: profile.id }), '公告附件已上传。');
  };
  const addSopCategory = async () => {
    const client = supabase; const profile = auth.profile;
    if (!client || !profile) return;
    const name = newCategoryName.trim();
    if (!name) { setMessage('请填写 SOP 分类名称。'); return; }
    await run(() => createSopCategory(client, { name, profileId: profile.id }), `SOP 分类“${name}”已创建。`);
    setNewCategoryName('');
  };
  const removeSopCategory = async (category: SopCategoryRow) => {
    const client = supabase;
    if (!client) return;
    const usageCount = sopsRef.current.filter((sop) => sop.category === category.name).length;
    if (usageCount > 0) {
      setMessage(`分类“${category.name}”仍有 ${usageCount} 个 SOP 在使用，请先修改这些 SOP 的分类。`);
      return;
    }
    if (!window.confirm(`确定删除 SOP 分类“${category.name}”吗？`)) return;
    await run(() => deleteSopCategory(client, category.id), `SOP 分类“${category.name}”已删除。`);
    if (sopCategoryFilter === category.name) setSopCategoryFilter('all');
  };
  const renameCategory = async (category: SopCategoryRow, newName: string) => {
    const client = supabase;
    if (!client) return false;
    setBusy(true); setMessage(null);
    try {
      await renameSopCategory(client, { categoryId: category.id, newName });
      await refresh();
      if (sopCategoryFilter === category.name) setSopCategoryFilter(newName.trim());
      setSuccess(`分类“${category.name}”已修改为“${newName.trim()}”，已有 SOP 已同步更新。`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '修改 SOP 分类失败。');
      return false;
    } finally { setBusy(false); }
  };
  const loadArchivedSopPage = async (reset = false) => {
    const client = supabase;
    if (!client || loadingMoreArchivedSops) return false;
    setLoadingMoreArchivedSops(true);
    try {
      const offset = reset ? 0 : archivedSops.length;
      const page = await loadSopPage(client, { archived: true, limit: SOP_PAGE_SIZE, offset });
      setArchivedSops((current) => reset ? page.items : [...current, ...page.items.filter((entry) => !current.some((item) => item.id === entry.id))]);
      setArchivedSopTotal(page.total);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载已归档 SOP 失败。');
      return false;
    } finally { setLoadingMoreArchivedSops(false); }
  };
  const openArchivedSops = async () => {
    setMessage(null);
    if (await loadArchivedSopPage(true)) setShowSopArchiveManager(true);
  };
  const removeArchivedSop = async (sop: SopListItem) => {
    const client = supabase;
    if (!client || sop.status !== 'archived') return;
    if (!window.confirm(`确定永久删除已归档 SOP“${sop.title}”吗？相关图片和附件也会删除，且无法恢复。`)) return;
    setBusy(true); setMessage(null);
    try {
      const detail = await loadSopDetail(client, sop.id);
      if (!detail) throw new Error('找不到该 SOP。');
      await deleteArchivedSop(client, detail);
      setArchivedSops((current) => current.filter((entry) => entry.id !== sop.id));
      setArchivedSopTotal((current) => Math.max(0, current - 1));
      setSuccess(`已归档 SOP“${sop.title}”已永久删除。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '删除已归档 SOP 失败。'); }
    finally { setBusy(false); }
  };
  const restoreArchivedSop = async (sop: SopListItem) => {
    const client = supabase;
    if (!client || sop.status !== 'archived') return;
    if (!window.confirm(`确定取消归档 SOP“${sop.title}”吗？恢复后会成为待发布草稿，不会自动通知员工。`)) return;
    setBusy(true); setMessage(null);
    try {
      await unarchiveSop(client, sop.id);
      setArchivedSops((current) => current.filter((entry) => entry.id !== sop.id));
      setArchivedSopTotal((current) => Math.max(0, current - 1));
      await refresh();
      setSuccess(`SOP“${sop.title}”已取消归档并恢复为待发布草稿。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '取消归档失败。'); }
    finally { setBusy(false); }
  };
  const removeArchivedNotice = async (notice: NoticeListItem) => {
    const client = supabase;
    if (!client || notice.status !== 'archived') return;
    if (!window.confirm(`确定永久删除已归档公告“${notice.title}”吗？相关附件也会删除，且无法恢复。`)) return;
    await run(() => deleteNotice(client, notice), `已归档公告“${notice.title}”已永久删除。`);
  };
  const runSopBatchImport = async (workbookFile: File, imageFiles: File[], onProgress: (progress: SopBatchImportProgress) => void) => {
    if (!supabase || !auth.profile) return null;
    setBusy(true); setMessage(null);
    try {
      const { importSopBatch } = await import('../features/content/sopBatchImport');
      const result = await importSopBatch(supabase, { imageFiles, onProgress, profileId: auth.profile.id, stores: auth.availableStores, workbookFile });
      await refresh();
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'SOP 批量导入失败。');
      return null;
    } finally { setBusy(false); }
  };

  const exportSelectedSops = async () => {
    const selected = sopsRef.current.filter((sop) => sop.status !== 'archived' && selectedSopIds.includes(sop.id));
    if (!selected.length) { setMessage('请先勾选需要导出的 SOP。'); return; }
    setBusy(true); setMessage(null);
    try {
      const details = (await Promise.all(selected.map((sop) => loadSopDetail(supabase!, sop.id)))).filter((sop): sop is SopListItem => Boolean(sop));
      if (details.length !== selected.length) throw new Error('部分 SOP 详情未能加载，请刷新后重试。');
      const { downloadSopCollection } = await import('../features/content/sopExport');
      const result = await downloadSopCollection(details, storeName);
      setSuccess(result.missingAssetCount
        ? `已导出 ${selected.length} 份 SOP；有 ${result.missingAssetCount} 个图片或附件未能写入，请检查网络后重试。`
        : `已将 ${selected.length} 份 SOP 导出为一个离线合集文件。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出 SOP 失败。');
    } finally { setBusy(false); }
  };

  const startSopBatchAction = (action: SopBatchLifecycleAction) => {
    setMessage(null);
    setSopExportMode(false);
    setSopBatchAction(action);
    setSelectedSopIds([]);
    setShowSopBatchOperations(false);
  };

  const runSopBatchLifecycle = async () => {
    const client = supabase;
    const action = sopBatchAction;
    if (!client || !action) return;
    const copy = sopBatchLifecycleCopy[action];
    const selected = sopsRef.current.filter((sop) => selectedSopIds.includes(sop.id) && sop.status === copy.eligibleStatus);
    if (!selected.length) { setMessage(`请先勾选需要${copy.success}的 SOP。`); return; }
    if (!window.confirm(`确定${copy.success}已选择的 ${selected.length} 个 SOP 吗？${action === 'publish' ? '批量发布将使用默认静默发布，不通知员工。' : ''}`)) return;
    setBusy(true);
    setMessage(null);
    setSopBatchActionProgress({ completed: 0, total: selected.length });
    const failed: string[] = [];
    let completed = 0;
    for (const sop of selected) {
      try {
        if (action === 'publish') await publishSop(client, sop.id, { silent: true });
        else if (action === 'retract') await retractSop(client, sop.id);
        else await archiveSop(client, sop.id);
      } catch {
        failed.push(sop.title);
      }
      completed += 1;
      setSopBatchActionProgress({ completed, total: selected.length });
    }
    await refresh();
    setBusy(false);
    setSopBatchActionProgress(null);
    setSelectedSopIds([]);
    if (failed.length) {
      setMessage(`批量${copy.success}完成，但以下 ${failed.length} 个 SOP 操作失败：${failed.join('、')}。`);
      return;
    }
    setSopBatchAction(null);
    setSuccess(`已批量${copy.success} ${selected.length} 个 SOP${action === 'publish' ? '，本次为静默发布。' : '。'}`);
  };

  const activeSops = sops.filter((sop) => sop.status !== 'archived');
  const activeNotices = notices.filter((notice) => notice.status !== 'archived');
  const archivedNotices = notices.filter((notice) => notice.status === 'archived');
  const normalizedSopSearch = sopSearch.trim().toLocaleLowerCase('zh-CN');
  const visibleSops = filterAdminSops(activeSops, sopCategoryFilter, sopSearch);
  const sopSelectionMode = sopExportMode || Boolean(sopBatchAction);
  const eligibleBatchSops = sopBatchAction
    ? visibleSops.filter((sop) => sop.status === sopBatchLifecycleCopy[sopBatchAction].eligibleStatus)
    : [];

  const pageCopy = section === 'notices'
    ? { description: '创建和发布门店公告，并查看员工已读情况。', label: '门店公告', title: '公告管理' }
    : { description: '创建、发布、分类和归档门店标准作业流程。', label: '标准作业流程', title: 'SOP 管理' };

  return <PageShell eyebrow="门店运营系统 · 管理员" title={pageCopy.title} backTo="/app/workbench">
    {section === 'notices' ? <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-brand-700">{pageCopy.label}</p><p className="mt-1 text-sm text-slate-500">{pageCopy.description}</p></div><button aria-label={`刷新${pageCopy.title}`} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200" onClick={() => void refresh()} type="button"><RefreshCw className="h-4 w-4" /></button></div></section> : null}
    {status === 'error' && message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}
    {status === 'loading' ? <p className="rounded-lg bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">正在加载内容</p> : null}
    {section === 'notices' ? <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button className="ui-button-primary px-2" onClick={() => { setSopDraft(null); setNoticeDraft(createEmptyNoticeDraft(defaultStores)); }} type="button"><Plus className="h-4 w-4" />新建公告</button>
        <button className="ui-button-secondary px-2" onClick={() => setShowNoticeArchiveManager(true)} type="button"><Archive className="h-4 w-4" />已归档（{archivedNotices.length}）</button>
      </div>
      {activeNotices.length === 0 ? <p className="ui-card p-6 text-center text-sm text-slate-500">暂无待发布或已发布公告。</p> : null}
      {activeNotices.map((notice) => <article className="rounded-lg bg-white p-4 shadow-sm" key={notice.id}>
        <div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1 text-xs font-bold text-brand-700">{notice.is_pinned ? <><Pin className="h-3.5 w-3.5" />置顶</> : '公告'} · {noticeStatus[notice.status]}</p><h2 className="mt-1 text-lg font-bold text-slate-900">{notice.title}</h2><p className="mt-2 text-xs text-slate-500">门店：{notice.storeIds.map(storeName).join('、')} · {notice.readCount}/{notice.recipientCount} 已读{notice.expires_at ? ` · ${new Date(notice.expires_at).toLocaleDateString('zh-CN')} 到期` : ''}</p></div></div>
        <p className="mt-3 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{notice.body || '暂无正文内容。'}</p>
        <details className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><summary className="cursor-pointer font-bold text-slate-700">查看已读/未读人员</summary><div className="mt-2 grid gap-1">{notice.recipients.map((recipient) => { const profile = recipientProfiles.find((item) => item.id === recipient.profileId); return <p key={recipient.profileId} className="text-slate-600">{recipient.firstReadAt ? '已读' : '未读'} · {profile?.display_name ?? '已离职/未知账号'} · {recipient.firstReadAt ? new Date(recipient.firstReadAt).toLocaleString('zh-CN') : '尚未打开'}</p>; })}</div></details>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button className="min-h-10 rounded-lg border border-slate-200 text-sm font-bold" disabled={busy} onClick={() => setNoticeDraft({ body: notice.body, expiresAt: notice.expires_at?.slice(0, 16) ?? '', id: notice.id, isPinned: notice.is_pinned, recipientIds: notice.recipientIds, requiresAcknowledgment: notice.requires_acknowledgment, storeIds: notice.storeIds, title: notice.title })} type="button">编辑</button>
          {notice.status === 'published' ? <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-amber-200 text-sm font-bold text-amber-800" disabled={busy} onClick={() => void run(() => retractNotice(supabase!, notice.id), '公告已撤回并恢复为待发布状态。')} type="button"><Undo2 className="h-4 w-4" />撤回</button> : <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-brand-600 text-sm font-bold text-white" disabled={busy} onClick={() => void run(() => publishNotice(supabase!, notice.id), '公告已发布。')} type="button"><Rocket className="h-4 w-4" />发布</button>}
          <button className={`inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border text-sm font-bold ${notice.status === 'published' ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400' : 'border-slate-200 text-slate-700'}`} disabled={busy || notice.status === 'published'} onClick={() => { if (window.confirm(`确定归档公告“${notice.title}”吗？归档后请到“已归档”中管理。`)) void run(() => archiveNotice(supabase!, notice.id), '公告已归档。'); }} type="button"><Archive className="h-4 w-4" />归档</button>
        </div>
      </article>)}
    </section> : null}
    {section === 'sops' ? <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button className="ui-button-primary px-1 text-sm" onClick={() => { setMessage(null); setNoticeDraft(null); setSopDraft(createEmptySopDraft(defaultStores)); }} type="button"><Plus className="h-4 w-4" />新建 SOP</button>
        <button className="ui-button-secondary px-1 text-sm" onClick={() => { setMessage(null); setShowSopBatchOperations(true); }} type="button"><ListChecks className="h-4 w-4" />批量操作</button>
        <button className="ui-button-secondary px-1 text-sm" onClick={() => { setMessage(null); setShowSopCategoryManager(true); }} type="button"><FolderPlus className="h-4 w-4" />分类管理</button>
        <button className="ui-button-secondary px-1 text-sm" disabled={loadingMoreArchivedSops} onClick={() => void openArchivedSops()} type="button"><Archive className="h-4 w-4" />{loadingMoreArchivedSops ? '加载归档' : `已归档（${archivedSopTotal}）`}</button>
        <button className={sopExportMode ? 'ui-button-primary col-span-2 px-1 text-sm' : 'ui-button-secondary col-span-2 px-1 text-sm'} onClick={() => { setMessage(null); setSopBatchAction(null); setSopExportMode((current) => !current); setSelectedSopIds([]); }} type="button"><Download className="h-4 w-4" />{sopExportMode ? '退出导出选择' : '导出 SOP'}</button>
      </div>
      <section className="ui-card space-y-2.5 p-3">
        <div className="flex items-end gap-3">
          <label className="min-w-0 flex-1 text-sm font-bold text-slate-700">分类查看
            <select className="ui-input mt-1.5" onChange={(event) => setSopCategoryFilter(event.target.value)} value={sopCategoryFilter}>
            <option value="all">全部分类</option>
            {sopCategories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
            </select>
          </label>
          <span className="pb-3 text-xs font-semibold text-brand-700">{visibleSops.length} 个 SOP</span>
        </div>
        <label className="flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-slate-400 transition focus-within:border-brand-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-100">
          <Search className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
          <input aria-label="检索 SOP" className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400" onChange={(event) => setSopSearch(event.target.value)} placeholder="检索 SOP 名称、分类或说明" type="search" value={sopSearch} />
          {sopSearch ? <button aria-label="清空 SOP 检索" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600" onClick={() => setSopSearch('')} type="button"><X className="h-3.5 w-3.5" /></button> : null}
        </label>
      </section>
      {sopExportMode ? <section className="ui-card space-y-3 border-brand-200 bg-brand-50/40 p-3">
        <div><p className="text-sm font-bold text-brand-900">选择需要合并导出的 SOP</p><p className="mt-1 text-xs leading-5 text-brand-800">将生成一个包含目录、图片步骤和附件的离线 HTML 文件，可直接查看或打印为 PDF。</p></div>
        <div className="grid grid-cols-3 gap-2"><button className="ui-button-secondary px-1 text-xs" onClick={() => setSelectedSopIds((current) => Array.from(new Set([...current, ...visibleSops.map((sop) => sop.id)])))} type="button">全选当前结果</button><button className="ui-button-secondary px-1 text-xs" onClick={() => setSelectedSopIds([])} type="button">清空选择</button><button className="ui-button-primary px-1 text-xs" disabled={busy || selectedSopIds.length === 0} onClick={() => void exportSelectedSops()} type="button"><Download className="h-4 w-4" />导出（{selectedSopIds.length}）</button></div>
      </section> : null}
      {sopBatchAction ? <section className="ui-card space-y-3 border-brand-200 bg-brand-50/40 p-3">
        <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-brand-900">{sopBatchLifecycleCopy[sopBatchAction].title}</p><p className="mt-1 text-xs leading-5 text-brand-800">当前分类有 {eligibleBatchSops.length} 个可操作项目。{sopBatchAction === 'publish' ? '批量发布默认静默进行，不发送员工通知。' : ''}</p></div><button className="text-xs font-bold text-slate-600" onClick={() => { setSopBatchAction(null); setSelectedSopIds([]); }} type="button">退出</button></div>
        <div className="grid grid-cols-3 gap-2"><button className="ui-button-secondary px-1 text-xs" onClick={() => setSelectedSopIds(eligibleBatchSops.map((sop) => sop.id))} type="button">全选可操作项</button><button className="ui-button-secondary px-1 text-xs" onClick={() => setSelectedSopIds([])} type="button">清空选择</button><button className="ui-button-primary px-1 text-xs" disabled={busy || selectedSopIds.length === 0} onClick={() => void runSopBatchLifecycle()} type="button">{sopBatchLifecycleCopy[sopBatchAction].button}（{selectedSopIds.length}）</button></div>
        {sopBatchActionProgress ? <div aria-label="SOP 批量操作进度" className="space-y-1"><div className="h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.round((sopBatchActionProgress.completed / Math.max(sopBatchActionProgress.total, 1)) * 100)}%` }} /></div><p className="text-xs text-brand-800">正在处理 {sopBatchActionProgress.completed}/{sopBatchActionProgress.total}</p></div> : null}
      </section> : null}
      {visibleSops.length === 0 ? <p className="ui-card p-6 text-center text-sm text-slate-500">{normalizedSopSearch ? '没有符合检索条件的 SOP。' : '当前分类暂无 SOP。'}</p> : null}
      {visibleSops.map((sop) => {
        const preview = getSopPreviewAsset(sop);
        const edit = async () => {
          setMessage(null);
          if (!supabase) return;
          setBusy(true);
          try {
            const detail = await loadSopDetail(supabase, sop.id);
            if (!detail) throw new Error('找不到该 SOP。');
            updateSops(sopsRef.current.map((entry) => entry.id === detail.id ? detail : entry));
            setSopDraft({ body: detail.body, category: detail.category, effectiveAt: detail.effective_at?.slice(0, 16) ?? '', id: detail.id, roles: detail.roles, storeIds: detail.storeIds, taskTemplateId: detail.taskTemplateId, title: detail.title });
          } catch (error) { setMessage(error instanceof Error ? error.message : 'SOP 详情加载失败。'); }
          finally { setBusy(false); }
        };
        const openPreview = () => navigate(`/app/sops/${sop.id}`);
        const batchEligible = !sopBatchAction || sop.status === sopBatchLifecycleCopy[sopBatchAction].eligibleStatus;
        const toggleSelectedSop = () => { if (batchEligible) setSelectedSopIds((current) => current.includes(sop.id) ? current.filter((id) => id !== sop.id) : [...current, sop.id]); };
        return <article aria-label={`${sopSelectionMode ? '选择' : '预览'} SOP ${sop.title}`} className={`ui-card p-3 transition ${sopSelectionMode ? batchEligible ? 'cursor-pointer' : 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-brand-200 hover:shadow-md'} ${selectedSopIds.includes(sop.id) ? 'border-brand-400 ring-2 ring-brand-100' : ''}`} key={sop.id} onClick={(event) => { if ((event.target as HTMLElement).closest('button,a,input,select,textarea')) return; if (sopSelectionMode) toggleSelectedSop(); else openPreview(); }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (sopSelectionMode) toggleSelectedSop(); else openPreview(); } }} role={sopSelectionMode ? undefined : 'link'} tabIndex={batchEligible ? 0 : -1}>
          {sopSelectionMode ? <label className="mb-3 flex min-h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand-50 px-3 text-sm font-bold text-brand-900" onClick={(event) => event.stopPropagation()}><input aria-label={`选择${sopExportMode ? '导出' : sopBatchLifecycleCopy[sopBatchAction!].success} ${sop.title}`} checked={selectedSopIds.includes(sop.id)} disabled={!batchEligible} onChange={toggleSelectedSop} type="checkbox" />{batchEligible ? '选择此 SOP' : `当前状态不可${sopBatchLifecycleCopy[sopBatchAction!].success}`}</label> : null}
          <div className="flex gap-3">
            {preview?.signedUrl ? <img alt={`${sop.title} 产品预览`} className="h-20 w-20 shrink-0 rounded-xl bg-slate-100 object-cover" src={preview.signedUrl} /> : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><ImageIcon className="h-7 w-7" /></div>}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-xs font-bold text-brand-700">{sop.category}</p><div className="shrink-0 text-right text-[11px] leading-4 text-slate-500"><p className="font-bold text-slate-700">{sopStatus[sop.status]}</p><p>{sop.effective_at ? `${new Date(sop.effective_at).toLocaleDateString('zh-CN')} 生效` : '尚未设置生效时间'}</p></div></div>
              <h2 className="mt-1 truncate text-base font-bold text-slate-900">{sop.title}</h2>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{sop.storeIds.map(storeName).join('、')} · {sop.roles.map((role) => role === 'staff' ? '员工' : '店长').join('、')}</p>
              <p className="mt-1 text-xs text-slate-500">步骤 {sop.stepCount ?? sop.assetUrls.filter((asset) => asset.asset_kind === 'step').length} · 附件 {sop.attachmentCount ?? sop.assetUrls.filter((asset) => asset.asset_kind === 'attachment').length}</p>
            </div>
          </div>
          {!sopSelectionMode ? <div className="mt-3 grid grid-cols-3 gap-2">
            <button className="ui-button-secondary min-h-10 px-2 text-sm" disabled={busy} onClick={() => void edit()} type="button">编辑</button>
            {sop.status === 'draft' ? <button className="ui-button-primary min-h-10 px-2 text-sm" disabled={busy} onClick={() => navigate(`/app/sops/${sop.id}`)} type="button"><Rocket className="h-4 w-4" />发布</button> : <button className="ui-button-secondary min-h-10 px-1 text-sm text-amber-800" disabled={busy} onClick={() => { if (window.confirm(`确定撤销发布 SOP“${sop.title}”吗？撤销后员工将无法查看，并恢复为待发布草稿。`)) void run(() => retractSop(supabase!, sop.id), 'SOP 已撤销发布并恢复为待发布草稿。'); }} type="button"><Undo2 className="h-4 w-4" />撤销发布</button>}
            <button className={`min-h-10 rounded-lg border px-2 text-sm font-bold ${sop.status === 'published' ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400' : 'border-slate-200 bg-white text-slate-700'}`} disabled={busy || sop.status === 'published'} onClick={() => { if (window.confirm(`确定归档 SOP“${sop.title}”吗？归档后请到“已归档”中管理。`)) void run(() => archiveSop(supabase!, sop.id), 'SOP 已归档。'); }} type="button"><span className="inline-flex items-center justify-center gap-1"><Archive className="h-4 w-4" />归档</span></button>
          </div> : null}
        </article>;
      })}
      {sops.length < sopTotal ? <><div className="h-px" ref={sopLoadMoreRef} /><button className="ui-button-secondary w-full" disabled={loadingMoreSops} onClick={() => void loadMoreSops()} type="button">{loadingMoreSops ? '正在预加载更多 SOP' : `加载更多（已显示 ${sops.length}/${sopTotal}）`}</button></> : null}
    </section> : null}
    {noticeDraft ? <NoticeEditor busy={busy} draft={noticeDraft} onCancel={() => setNoticeDraft(null)} onChange={setNoticeDraft} onPublish={() => void saveNoticeDraft(true)} onSave={() => void saveNoticeDraft()} onUpload={uploadNotice} recipients={recipientProfiles} stores={auth.availableStores} /> : null}
    {sopDraft ? <SopEditor busy={busy} categories={sopCategories.map((entry) => entry.name)} draft={sopDraft} errorMessage={message} existingAssets={sops.find((sop) => sop.id === sopDraft.id)?.assetUrls ?? []} onCancel={() => updateSopDraft(null)} onChange={updateSopDraft} onDeleteAsset={removeSopAsset} onPublish={saveAndPreviewSop} onReorderImages={reorderSopImages} onReplaceImage={replaceSopImage} onSave={saveSopDraft} onUploadCover={uploadSopCover} onUploadImage={uploadSopImage} status={sops.find((sop) => sop.id === sopDraft.id)?.status ?? 'new'} /> : null}
    {showSopBatchOperations ? <SopBatchOperationsMenu onAction={startSopBatchAction} onClose={() => setShowSopBatchOperations(false)} onImport={() => { setShowSopBatchOperations(false); setShowSopBatchImport(true); }} /> : null}
    {showSopBatchImport ? <SopBatchImporter busy={busy} errorMessage={message} onCancel={() => setShowSopBatchImport(false)} onImport={runSopBatchImport} /> : null}
    {showSopCategoryManager ? <SopCategoryManager busy={busy} categories={sopCategories} errorMessage={message} newCategoryName={newCategoryName} onChangeName={setNewCategoryName} onClose={() => { setMessage(null); setShowSopCategoryManager(false); }} onCreate={addSopCategory} onDelete={removeSopCategory} onRename={renameCategory} sops={sops} /> : null}
    {showSopArchiveManager ? <SopArchiveManager busy={busy} loadingMore={loadingMoreArchivedSops} onClose={() => { setMessage(null); setShowSopArchiveManager(false); }} onDelete={removeArchivedSop} onLoadMore={() => loadArchivedSopPage(false)} onRestore={restoreArchivedSop} sops={archivedSops} total={archivedSopTotal} /> : null}
    {showNoticeArchiveManager ? <NoticeArchiveManager busy={busy} notices={archivedNotices} onClose={() => { setMessage(null); setShowNoticeArchiveManager(false); }} onDelete={removeArchivedNotice} /> : null}
    <ActionFeedbackDialog message={message ?? ''} onClose={() => setMessage(null)} open={status !== 'error' && Boolean(message)} title={message?.includes('请') || message?.includes('仍有') ? '请完善操作信息' : '操作未完成'} tone={message?.includes('请') || message?.includes('仍有') ? 'warning' : 'danger'} />
    <SuccessToast message={success} onClose={() => setSuccess(null)} />
  </PageShell>;
}

export function AdminAnnouncementsPage() {
  return <AdminContentPage section="notices" />;
}

export function AdminSopsPage() {
  return <AdminContentPage section="sops" />;
}

function StorePicker({ selected, stores, onChange }: { selected: string[]; stores: Array<{ id: string; name: string }>; onChange: (ids: string[]) => void }) {
  return <fieldset><legend className="text-sm font-semibold">适用门店</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{stores.map((store) => <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm" key={store.id}><input checked={selected.includes(store.id)} onChange={() => onChange(selected.includes(store.id) ? selected.filter((id) => id !== store.id) : [...selected, store.id])} type="checkbox" />{store.name}</label>)}</div></fieldset>;
}

export function SopCategoryManager({ busy, categories, errorMessage, newCategoryName, onChangeName, onClose, onCreate, onDelete, onRename, sops }: {
  busy: boolean;
  categories: SopCategoryRow[];
  errorMessage: string | null;
  newCategoryName: string;
  onChangeName: (value: string) => void;
  onClose: () => void;
  onCreate: () => Promise<void>;
  onDelete: (category: SopCategoryRow) => Promise<void>;
  onRename: (category: SopCategoryRow, newName: string) => Promise<boolean>;
  sops: SopListItem[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const saveRename = async (category: SopCategoryRow, usageCount: number) => {
    const newName = editingName.trim();
    if (!newName || newName === category.name) { setEditingId(null); return; }
    const impact = usageCount > 0 ? `\n此操作会同步修改该分类下 ${usageCount} 个 SOP。` : '';
    if (!window.confirm(`确定将分类“${category.name}”修改为“${newName}”吗？${impact}`)) return;
    if (await onRename(category, newName)) { setEditingId(null); setEditingName(''); }
  };
  return <div aria-labelledby="sop-category-title" aria-modal="true" className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog">
    <div className="mx-auto max-w-2xl space-y-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5">
        <div><p className="text-xs font-bold text-brand-700">SOP 管理 · 分类管理</p><h2 className="text-xl font-bold" id="sop-category-title">制作分类</h2></div>
        <button aria-label="关闭 SOP 分类管理" className="ui-icon-button" onClick={onClose} type="button"><X className="h-5 w-5" /></button>
      </header>
      {errorMessage ? <FeedbackBanner title="分类操作未完成" tone="danger">{errorMessage}</FeedbackBanner> : null}
      <section className="ui-card p-4">
        <h3 className="font-bold text-slate-900">新建分类</h3>
        <div className="mt-3 flex gap-2"><label className="min-w-0 flex-1"><span className="sr-only">新分类名称</span><input className="ui-input" onChange={(event) => onChangeName(event.target.value)} placeholder="例如：果茶制作" value={newCategoryName} /></label><button className="ui-button-primary shrink-0 px-4" disabled={busy} onClick={() => void onCreate()} type="button">创建</button></div>
      </section>
      <section className="ui-card p-4">
        <div className="flex items-center justify-between gap-2"><h3 className="font-bold text-slate-900">已有分类</h3><span className="text-xs text-slate-500">{categories.length} 个</span></div>
        <div className="mt-3 divide-y divide-slate-100">{categories.map((category) => {
          const usageCount = sops.filter((sop) => sop.category === category.name).length;
          return <div className="py-2" key={category.id}>{editingId === category.id ? <div className="rounded-lg bg-brand-50 p-3"><label className="block text-xs font-bold text-brand-800">修改分类名称<input aria-label={`修改分类 ${category.name}`} autoFocus className="ui-input mt-1.5" onChange={(event) => setEditingName(event.target.value)} value={editingName} /></label><p className="mt-1 text-xs text-brand-700">保存后会同步更新该分类下的 {usageCount} 个 SOP。</p><div className="mt-2 grid grid-cols-2 gap-2"><button className="ui-button-secondary" disabled={busy} onClick={() => { setEditingId(null); setEditingName(''); }} type="button">取消</button><button className="ui-button-primary" disabled={busy} onClick={() => void saveRename(category, usageCount)} type="button">保存修改</button></div></div> : <div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><FolderPlus className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{category.name}</p><p className="text-xs text-slate-500">{usageCount} 个 SOP 正在使用</p></div><button aria-label={`修改分类 ${category.name}`} className="ui-icon-button h-10 w-10 border-transparent bg-brand-50 text-brand-700" disabled={busy} onClick={() => { setEditingId(category.id); setEditingName(category.name); }} type="button"><Pencil className="h-4 w-4" /></button><button aria-label={`删除分类 ${category.name}`} className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" disabled={busy || usageCount > 0} onClick={() => void onDelete(category)} title={usageCount > 0 ? '请先修改该分类下的 SOP' : '删除分类'} type="button"><Trash2 className="h-4 w-4" /></button></div>}</div>;
        })}</div>
        {!categories.length ? <p className="mt-3 rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">还没有 SOP 分类。</p> : null}
        <p className="mt-3 text-xs leading-5 text-slate-500">正在被 SOP 使用的分类不能直接删除，请先编辑对应 SOP 并更换分类。</p>
      </section>
    </div>
  </div>;
}

export function SopArchiveManager({ busy, loadingMore, onClose, onDelete, onLoadMore, onRestore, sops, total }: {
  busy: boolean;
  loadingMore: boolean;
  onClose: () => void;
  onDelete: (sop: SopListItem) => Promise<void>;
  onLoadMore: () => Promise<boolean>;
  onRestore: (sop: SopListItem) => Promise<void>;
  sops: SopListItem[];
  total: number;
}) {
  return <div aria-labelledby="sop-archive-title" aria-modal="true" className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog">
    <div className="mx-auto max-w-2xl space-y-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5">
        <div><p className="text-xs font-bold text-brand-700">SOP 管理 · 独立归档区</p><h2 className="text-xl font-bold" id="sop-archive-title">已归档 SOP</h2></div>
        <button aria-label="关闭已归档 SOP" className="ui-icon-button" onClick={onClose} type="button"><X className="h-5 w-5" /></button>
      </header>
      {sops.length ? <section className="space-y-2">{sops.map((sop) => {
        const preview = getSopPreviewAsset(sop);
        return <article className="ui-card flex items-center gap-3 p-3" key={sop.id}>
          {preview?.signedUrl ? <img alt={`${sop.title} 归档预览`} className="h-16 w-16 shrink-0 rounded-lg bg-slate-100 object-cover" src={preview.signedUrl} /> : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400"><ImageIcon className="h-6 w-6" /></div>}
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-brand-700">{sop.category}</p><h3 className="mt-1 truncate font-bold text-slate-900">{sop.title}</h3><p className="mt-1 text-xs text-slate-500">已归档 · 步骤 {sop.stepCount ?? sop.assetUrls.filter((asset) => asset.asset_kind === 'step').length}</p></div>
          <div className="grid shrink-0 gap-1.5">
            <button aria-label={`取消归档 ${sop.title}`} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-brand-50 px-2 text-xs font-bold text-brand-800" disabled={busy} onClick={() => void onRestore(sop)} type="button"><ArchiveRestore className="h-3.5 w-3.5" />取消归档</button>
            <button aria-label={`永久删除 ${sop.title}`} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-red-50 px-2 text-xs font-bold text-red-700" disabled={busy} onClick={() => void onDelete(sop)} type="button"><Trash2 className="h-3.5 w-3.5" />删除</button>
          </div>
        </article>;
      })}</section> : <p className="ui-card p-6 text-center text-sm text-slate-500">暂无已归档 SOP。</p>}
      {sops.length < total ? <button className="ui-button-secondary w-full" disabled={loadingMore} onClick={() => void onLoadMore()} type="button">{loadingMore ? '正在加载' : `加载更多（已显示 ${sops.length}/${total}）`}</button> : null}
      <p className="px-2 text-xs leading-5 text-slate-500">取消归档会恢复为待发布草稿，不会自动通知员工；永久删除会同时清理产品图、制作步骤图片和附件，且无法恢复。</p>
    </div>
  </div>;
}

function NoticeArchiveManager({ busy, notices, onClose, onDelete }: {
  busy: boolean;
  notices: NoticeListItem[];
  onClose: () => void;
  onDelete: (notice: NoticeListItem) => Promise<void>;
}) {
  return <div aria-labelledby="notice-archive-title" aria-modal="true" className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog">
    <div className="mx-auto max-w-2xl space-y-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5">
        <div><p className="text-xs font-bold text-brand-700">公告管理 · 独立归档区</p><h2 className="text-xl font-bold" id="notice-archive-title">已归档公告</h2></div>
        <button aria-label="关闭已归档公告" className="ui-icon-button" onClick={onClose} type="button"><X className="h-5 w-5" /></button>
      </header>
      {notices.length ? <section className="space-y-2">{notices.map((notice) => <article className="ui-card flex items-center gap-3 p-3" key={notice.id}>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Archive className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1"><h3 className="truncate font-bold text-slate-900">{notice.title}</h3><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{notice.body || '暂无正文内容。'}</p></div>
        <button aria-label={`永久删除 ${notice.title}`} className="ui-icon-button h-10 w-10 shrink-0 border-transparent bg-red-50 text-red-700" disabled={busy} onClick={() => void onDelete(notice)} type="button"><Trash2 className="h-4 w-4" /></button>
      </article>)}</section> : <p className="ui-card p-6 text-center text-sm text-slate-500">暂无已归档公告。</p>}
      <p className="px-2 text-xs leading-5 text-slate-500">永久删除会同时清理公告附件、接收和阅读记录，删除后无法恢复。</p>
    </div>
  </div>;
}

export function NoticeEditor({ busy, draft, onCancel, onChange, onPublish, onSave, onUpload, recipients, stores }: { busy: boolean; draft: NoticeDraft; onCancel: () => void; onChange: (value: NoticeDraft) => void; onPublish: () => void; onSave: () => void; onUpload: (file: File | undefined) => Promise<void>; recipients: ContentRecipient[]; stores: Array<{ id: string; name: string }> }) {
  const [roleFilter, setRoleFilter] = useState<'all' | 'staff' | 'manager'>('all');
  const visibleRecipients = recipients.filter((recipient) => draft.storeIds.includes(recipient.store_id) && (roleFilter === 'all' || recipient.role === roleFilter));
  const selectAll = () => onChange({ ...draft, recipientIds: visibleRecipients.map((recipient) => recipient.id) });
  return <div className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog" aria-modal="true" aria-labelledby="notice-editor-title">
    <div className="mx-auto max-w-3xl space-y-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
      <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5"><div><p className="text-xs font-bold text-brand-700">公告编辑</p><h2 className="text-xl font-bold" id="notice-editor-title">{draft.id ? '编辑公告' : '新建公告'}</h2></div><button aria-label="关闭公告编辑" className="ui-icon-button" onClick={onCancel} type="button"><X className="h-5 w-5" /></button></header>
      <section className="ui-card space-y-4 p-4">
        <label className="block text-sm font-semibold text-slate-700">公告标题<input className="ui-input mt-1.5" onChange={(event) => onChange({ ...draft, title: event.target.value })} value={draft.title} /></label>
        <label className="block text-sm font-semibold text-slate-700">公告正文<textarea className="ui-input mt-1.5 min-h-40 py-3 leading-7" onChange={(event) => onChange({ ...draft, body: event.target.value })} value={draft.body} /></label>
        <label className="block text-sm font-semibold text-slate-700">失效时间（可选）<input className="ui-input mt-1.5" onChange={(event) => onChange({ ...draft, expiresAt: event.target.value })} type="datetime-local" value={draft.expiresAt} /></label>
        <div className="grid gap-2 sm:grid-cols-2"><label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold"><input checked={draft.isPinned} onChange={(event) => onChange({ ...draft, isPinned: event.target.checked })} type="checkbox" />置顶显示</label><label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold"><input checked={draft.requiresAcknowledgment} onChange={(event) => onChange({ ...draft, requiresAcknowledgment: event.target.checked })} type="checkbox" />要求接收人确认（计入待办）</label></div>
        <StorePicker onChange={(storeIds) => onChange({ ...draft, recipientIds: draft.recipientIds.filter((id) => recipients.some((recipient) => recipient.id === id && storeIds.includes(recipient.store_id))), storeIds })} selected={draft.storeIds} stores={stores} />
        <div><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">接收人员（已选 {draft.recipientIds.length} 人）</p><button className="ui-button-secondary px-3" onClick={selectAll} type="button">全选当前结果</button></div><div className="mt-2 grid grid-cols-3 gap-2"><button className={`min-h-11 rounded-lg border px-2 text-sm ${roleFilter === 'all' ? 'border-brand-600 bg-brand-50 font-bold text-brand-700' : 'border-slate-200'}`} onClick={() => setRoleFilter('all')} type="button">全部</button><button className={`min-h-11 rounded-lg border px-2 text-sm ${roleFilter === 'staff' ? 'border-brand-600 bg-brand-50 font-bold text-brand-700' : 'border-slate-200'}`} onClick={() => setRoleFilter('staff')} type="button">员工</button><button className={`min-h-11 rounded-lg border px-2 text-sm ${roleFilter === 'manager' ? 'border-brand-600 bg-brand-50 font-bold text-brand-700' : 'border-slate-200'}`} onClick={() => setRoleFilter('manager')} type="button">店长</button></div><div className="mt-2 grid gap-2 sm:grid-cols-2">{visibleRecipients.map((recipient) => <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm" key={recipient.id}><input checked={draft.recipientIds.includes(recipient.id)} onChange={() => onChange({ ...draft, recipientIds: draft.recipientIds.includes(recipient.id) ? draft.recipientIds.filter((id) => id !== recipient.id) : [...draft.recipientIds, recipient.id] })} type="checkbox" />{recipient.display_name} · {recipient.role === 'staff' ? '员工' : '店长'}</label>)}</div></div>
        {draft.id ? <label className="ui-button-secondary w-fit cursor-pointer"><FileUp className="h-4 w-4" />上传图片或 PDF<input accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={busy} onChange={(event) => { void onUpload(event.target.files?.[0]); event.currentTarget.value = ''; }} type="file" /></label> : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">保存草稿后即可上传图片或 PDF 附件。</p>}
      </section>
    </div>
    <EditorActions busy={busy} onCancel={onCancel} onPublish={onPublish} onSave={onSave} publishLabel="发布公告" />
  </div>;
}

type PendingSopAsset = { assetKind: 'attachment' | 'cover' | 'step'; file: File | null; key: string; previewUrl: string | null; sortOrder: number; stepText: string };
type ExistingSopStep = OrderedSopStep;
type SopAsset = SopListItem['assetUrls'][number];
type SopEditorChanges = {
  deletedAssets: SopAsset[];
  existingSteps: ExistingSopStep[];
  pendingAssets: Array<{ assetKind: 'attachment' | 'cover' | 'step'; file: File | null; sortOrder: number; stepText: string }>;
  removedImageAssets: SopAsset[];
  replacements: Array<{ asset: SopAsset; file: File; sortOrder: number; stepText: string }>;
};

export function SopEditor({ busy, categories, draft, errorMessage, existingAssets, onCancel, onChange, onPublish, onSave, status }: {
  busy: boolean;
  categories: string[];
  draft: SopDraft;
  errorMessage: string | null;
  existingAssets: SopListItem['assetUrls'];
  onCancel: () => void;
  onChange: (value: SopDraft) => void;
  onDeleteAsset: (asset: SopListItem['assetUrls'][number]) => Promise<void>;
  onPublish: (changes: SopEditorChanges) => Promise<boolean>;
  onReorderImages: (orderedAssetIds: string[]) => Promise<void>;
  onReplaceImage: (asset: SopListItem['assetUrls'][number], file: File, stepText: string, onProgress: (progress: number) => void) => Promise<void>;
  onSave: (changes: SopEditorChanges) => Promise<boolean>;
  onUploadCover: (file: File, onProgress: (progress: number) => void) => Promise<void>;
  onUploadImage: (file: File, insertAt: number, onProgress: (progress: number) => void) => Promise<void>;
  status: SopListItem['status'] | 'new';
}) {
  const [pendingAssets, setPendingAssets] = useState<PendingSopAsset[]>([]);
  const [existingSteps, setExistingSteps] = useState<ExistingSopStep[]>(() => normalizeSopSteps(existingAssets.filter((asset) => asset.asset_kind === 'step').map((asset) => ({ id: asset.id, sortOrder: asset.sort_order, stepText: asset.step_text }))));
  const [activeImage, setActiveImage] = useState<{ alt: string; url: string } | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [validationDialog, setValidationDialog] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<SopImageUploadStatus>({ hasErrors: false, isUploading: false });
  const [replacementPreviews, setReplacementPreviews] = useState<Record<string, { file: File; url: string }>>({});
  const [deletedAssetIds, setDeletedAssetIds] = useState<string[]>([]);
  const [removedImageAssetIds, setRemovedImageAssetIds] = useState<string[]>([]);
  const [deleteStepChoice, setDeleteStepChoice] = useState<{ kind: 'existing' | 'pending'; key: string; label: string } | null>(null);
  const previewUrls = useRef<string[]>([]);
  const replacementUrls = useRef<string[]>([]);

  useEffect(() => () => previewUrls.current.forEach(revokeLocalUrl), []);
  useEffect(() => () => replacementUrls.current.forEach(revokeLocalUrl), []);
  useEffect(() => {
    setExistingSteps((current) => normalizeSopSteps(existingAssets.filter((asset) => asset.asset_kind === 'step').map((asset) => current.find((entry) => entry.id === asset.id) ?? { id: asset.id, sortOrder: asset.sort_order, stepText: asset.step_text })));
  }, [existingAssets]);

  const addAttachments = (files: FileList | null) => {
    if (!files?.length) return;
    setPendingAssets((current) => {
      const additions = Array.from(files).map((file, index): PendingSopAsset => ({
        assetKind: 'attachment', file, key: `attachment-${file.name}-${file.size}-${file.lastModified}-${index}`, previewUrl: null, sortOrder: 0, stepText: '',
      }));
      return [...current, ...additions];
    });
  };

  const stageStepImage = async (file: File, insertAt: number, onProgress: (progress: number) => void) => {
    onProgress(10);
    const previewUrl = URL.createObjectURL(file);
    previewUrls.current.push(previewUrl);
    const target = Math.max(0, Math.min(insertAt, existingSteps.length + pendingAssets.filter((asset) => asset.assetKind === 'step').length));
    setExistingSteps((current) => current.map((step) => step.sortOrder >= target ? { ...step, sortOrder: step.sortOrder + 1 } : step));
    const key = `step-${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${Math.random()}`;
    setPendingAssets((current) => {
      const steps = current.filter((asset) => asset.assetKind === 'step').map((asset) => asset.sortOrder >= target ? { ...asset, sortOrder: asset.sortOrder + 1 } : asset);
      steps.push({ assetKind: 'step', file, key, previewUrl, sortOrder: target, stepText: '' });
      return [...current.filter((asset) => asset.assetKind !== 'step'), ...steps];
    });
    onProgress(100);
  };

  const stageTextStep = () => {
    const key = `text-step-${Date.now()}-${Math.random()}`;
    setPendingAssets((current) => {
      const steps = current.filter((asset) => asset.assetKind === 'step').sort((left, right) => left.sortOrder - right.sortOrder);
      steps.push({ assetKind: 'step', file: null, key, previewUrl: null, sortOrder: existingSteps.length + steps.length, stepText: '' });
      return [...current.filter((asset) => asset.assetKind !== 'step'), ...steps];
    });
    setValidationMessage(null);
  };

  const stageCover = async (file: File, onProgress: (progress: number) => void) => {
    onProgress(10);
    const previewUrl = URL.createObjectURL(file);
    previewUrls.current.push(previewUrl);
    setPendingAssets((current) => {
      current.filter((asset) => asset.assetKind === 'cover' && asset.previewUrl).forEach((asset) => {
        revokeLocalUrl(asset.previewUrl!);
        previewUrls.current = previewUrls.current.filter((url) => url !== asset.previewUrl);
      });
      return [...current.filter((asset) => asset.assetKind !== 'cover'), { assetKind: 'cover', file, key: `cover-${file.name}-${file.lastModified}-${Date.now()}`, previewUrl, sortOrder: 0, stepText: '' }];
    });
    onProgress(100);
  };

  const removePending = (key: string) => {
    const removedStep = pendingAssets.find((asset) => asset.key === key && asset.assetKind === 'step');
    if (removedStep) {
      setExistingSteps((current) => current.map((step) => step.sortOrder > removedStep.sortOrder ? { ...step, sortOrder: step.sortOrder - 1 } : step));
    }
    setPendingAssets((current) => {
      const target = current.find((asset) => asset.key === key);
      if (target?.previewUrl) {
        revokeLocalUrl(target.previewUrl);
        previewUrls.current = previewUrls.current.filter((url) => url !== target.previewUrl);
      }
      return current
        .filter((asset) => asset.key !== key)
        .map((asset) => removedStep && asset.assetKind === 'step' && asset.sortOrder > removedStep.sortOrder ? { ...asset, sortOrder: asset.sortOrder - 1 } : asset);
    });
  };

  const submit = async (action: (changes: SopEditorChanges) => Promise<boolean>, publish: boolean) => {
    const stop = (text: string) => { setValidationMessage(text); setValidationDialog(text); };
    if (!draft.title.trim()) { stop('请填写产品或流程名称。'); return; }
    if (!draft.category.trim()) { stop('请选择制作分类。'); return; }
    if (!draft.storeIds.length) { stop('请至少选择一个适用门店。'); return; }
    if (!draft.roles.length) { stop('请至少选择一个适用角色。'); return; }
    if (uploadStatus.isUploading) { stop('图片仍在上传，请等待上传完成后再保存或发布。'); return; }
    if (uploadStatus.hasErrors) { stop('仍有图片上传失败，请重试或移除失败图片后再继续。'); return; }
    if (publish && existingSteps.length + pendingSteps.length === 0) { stop('发布 SOP 前请至少添加一个制作步骤。'); return; }
    const orderedStepRefs = [
      ...existingSteps.map((step) => ({ key: step.id, kind: 'existing' as const, sortOrder: step.sortOrder })),
      ...pendingAssets.filter((asset) => asset.assetKind === 'step').map((asset) => ({ key: asset.key, kind: 'pending' as const, sortOrder: asset.sortOrder })),
    ].sort((left, right) => left.sortOrder - right.sortOrder);
    const normalizedOrder = new Map(orderedStepRefs.map((entry, index) => [`${entry.kind}:${entry.key}`, index]));
    const normalizedSteps = existingSteps.map((step) => ({ ...step, sortOrder: normalizedOrder.get(`existing:${step.id}`) ?? step.sortOrder }));
    const invalidExistingStep = normalizedSteps.some((step) => {
      const asset = existingAssets.find((entry) => entry.id === step.id);
      const hasImage = Boolean(replacementPreviews[step.id] || (asset?.object_path && !removedImageAssetIds.includes(step.id)));
      return !hasImage && !step.stepText.trim();
    });
    const invalidPendingStep = pendingSteps.some((step) => !step.file && !step.stepText.trim());
    if (invalidExistingStep || invalidPendingStep) { stop('每个制作步骤至少需要图片或文字说明中的一项。'); return; }
    setValidationMessage(null);
    const succeeded = await action({
      deletedAssets: existingAssets.filter((asset) => deletedAssetIds.includes(asset.id) || (asset.asset_kind === 'cover' && pendingAssets.some((pending) => pending.assetKind === 'cover'))),
      existingSteps: normalizedSteps,
      pendingAssets: pendingAssets.map((asset) => ({ assetKind: asset.assetKind, file: asset.file, sortOrder: asset.assetKind === 'step' ? normalizedOrder.get(`pending:${asset.key}`) ?? asset.sortOrder : asset.sortOrder, stepText: asset.stepText })),
      removedImageAssets: normalizedSteps.flatMap((step) => {
        const asset = existingAssets.find((entry) => entry.id === step.id);
        return asset && removedImageAssetIds.includes(step.id) ? [{ ...asset, step_text: step.stepText }] : [];
      }),
      replacements: normalizedSteps.flatMap((step) => {
        const asset = existingAssets.find((entry) => entry.id === step.id);
        const replacement = replacementPreviews[step.id];
        return asset && replacement ? [{ asset, file: replacement.file, sortOrder: step.sortOrder, stepText: step.stepText }] : [];
      }),
    });
    if (!succeeded) return;
    pendingAssets.forEach((asset) => { if (asset.previewUrl) revokeLocalUrl(asset.previewUrl); });
    Object.values(replacementPreviews).forEach((replacement) => revokeLocalUrl(replacement.url));
    previewUrls.current = [];
    replacementUrls.current = [];
    setPendingAssets([]);
    setReplacementPreviews({});
    setDeletedAssetIds([]);
    setRemovedImageAssetIds([]);
  };

  const stepOrder = new Map(existingSteps.map((step) => [step.id, step.sortOrder]));
  const existingImages = existingAssets.filter((asset) => asset.asset_kind === 'step' && !deletedAssetIds.includes(asset.id)).sort((left, right) => (stepOrder.get(left.id) ?? left.sort_order) - (stepOrder.get(right.id) ?? right.sort_order));
  const existingCovers = existingAssets.filter((asset) => asset.asset_kind === 'cover' && !deletedAssetIds.includes(asset.id)).sort((left, right) => right.created_at.localeCompare(left.created_at));
  const existingCover = existingCovers[0] ?? null;
  const pendingCover = pendingAssets.find((asset) => asset.assetKind === 'cover') ?? null;
  const pendingSteps = pendingAssets.filter((asset) => asset.assetKind === 'step').sort((left, right) => left.sortOrder - right.sortOrder);
  const existingDocuments = existingAssets.filter((asset) => asset.asset_kind === 'attachment' && !deletedAssetIds.includes(asset.id));
  const pendingDocuments = pendingAssets.filter((asset): asset is PendingSopAsset & { file: File } => asset.assetKind === 'attachment' && Boolean(asset.file));

  const changeStepPosition = (kind: 'existing' | 'pending', key: string, targetIndex: number) => {
    const ordered = [
      ...existingSteps.map((step) => ({ key: step.id, kind: 'existing' as const, sortOrder: step.sortOrder })),
      ...pendingAssets.filter((asset) => asset.assetKind === 'step').map((asset) => ({ key: asset.key, kind: 'pending' as const, sortOrder: asset.sortOrder })),
    ].sort((left, right) => left.sortOrder - right.sortOrder);
    const currentIndex = ordered.findIndex((entry) => entry.kind === kind && entry.key === key);
    if (currentIndex < 0) return;
    const [moved] = ordered.splice(currentIndex, 1);
    ordered.splice(Math.max(0, Math.min(targetIndex, ordered.length)), 0, moved);
    const nextOrder = new Map(ordered.map((entry, index) => [`${entry.kind}:${entry.key}`, index]));
    setExistingSteps((current) => current.map((step) => ({ ...step, sortOrder: nextOrder.get(`existing:${step.id}`) ?? step.sortOrder })));
    setPendingAssets((current) => current.map((asset) => asset.assetKind === 'step' ? { ...asset, sortOrder: nextOrder.get(`pending:${asset.key}`) ?? asset.sortOrder } : asset));
    setValidationMessage(null);
  };

  const removePendingImageOnly = (key: string) => {
    setPendingAssets((current) => current.map((asset) => {
      if (asset.key !== key) return asset;
      if (asset.previewUrl) {
        revokeLocalUrl(asset.previewUrl);
        previewUrls.current = previewUrls.current.filter((url) => url !== asset.previewUrl);
      }
      return { ...asset, file: null, previewUrl: null };
    }));
    setDeleteStepChoice(null);
  };

  const deleteExistingStep = (assetId: string) => {
    const removedStep = existingSteps.find((step) => step.id === assetId);
    setDeletedAssetIds((current) => current.includes(assetId) ? current : [...current, assetId]);
    setExistingSteps((current) => current
      .filter((step) => step.id !== assetId)
      .map((step) => removedStep && step.sortOrder > removedStep.sortOrder ? { ...step, sortOrder: step.sortOrder - 1 } : step));
    if (removedStep) {
      setPendingAssets((current) => current.map((asset) => asset.assetKind === 'step' && asset.sortOrder > removedStep.sortOrder ? { ...asset, sortOrder: asset.sortOrder - 1 } : asset));
    }
    const replacement = replacementPreviews[assetId];
    if (replacement) {
      revokeLocalUrl(replacement.url);
      replacementUrls.current = replacementUrls.current.filter((url) => url !== replacement.url);
      setReplacementPreviews((current) => {
        const next = { ...current };
        delete next[assetId];
        return next;
      });
    }
    setDeleteStepChoice(null);
  };

  const removeExistingImageOnly = (assetId: string) => {
    setRemovedImageAssetIds((current) => current.includes(assetId) ? current : [...current, assetId]);
    const replacement = replacementPreviews[assetId];
    if (replacement) {
      revokeLocalUrl(replacement.url);
      replacementUrls.current = replacementUrls.current.filter((url) => url !== replacement.url);
      setReplacementPreviews((current) => {
        const next = { ...current };
        delete next[assetId];
        return next;
      });
    }
    setDeleteStepChoice(null);
  };

  const requestExistingStepDelete = (asset: SopAsset, stepText: string, index: number) => {
    const hasImage = Boolean((replacementPreviews[asset.id] || asset.object_path) && !removedImageAssetIds.includes(asset.id));
    if (hasImage && stepText.trim()) {
      setDeleteStepChoice({ kind: 'existing', key: asset.id, label: `第 ${index + 1} 步` });
      return;
    }
    if (window.confirm(`确定删除第 ${index + 1} 个制作步骤吗？`)) deleteExistingStep(asset.id);
  };

  const requestPendingStepDelete = (asset: PendingSopAsset, index: number) => {
    if (asset.file && asset.stepText.trim()) {
      setDeleteStepChoice({ kind: 'pending', key: asset.key, label: `第 ${index + 1} 步` });
      return;
    }
    if (window.confirm(`确定删除第 ${index + 1} 个制作步骤吗？`)) removePending(asset.key);
  };

  const replacePendingImage = (key: string, file: File) => {
    const previewUrl = URL.createObjectURL(file);
    previewUrls.current.push(previewUrl);
    setPendingAssets((current) => current.map((asset) => {
      if (asset.key !== key) return asset;
      if (asset.previewUrl) {
        revokeLocalUrl(asset.previewUrl);
        previewUrls.current = previewUrls.current.filter((url) => url !== asset.previewUrl);
      }
      return { ...asset, file, previewUrl };
    }));
  };

  const replaceImage = (asset: SopListItem['assetUrls'][number], file: File) => {
    const url = URL.createObjectURL(file);
    replacementUrls.current.push(url);
    const previous = replacementPreviews[asset.id];
    if (previous) {
      revokeLocalUrl(previous.url);
      replacementUrls.current = replacementUrls.current.filter((entry) => entry !== previous.url);
    }
    setReplacementPreviews((current) => ({ ...current, [asset.id]: { file, url } }));
    setRemovedImageAssetIds((current) => current.filter((id) => id !== asset.id));
    setValidationMessage(null);
  };

  return <div className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog" aria-modal="true" aria-labelledby="sop-editor-title">
    <div className="mx-auto max-w-3xl space-y-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
      <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5">
        <div className="min-w-0"><p className="text-xs font-bold text-brand-700">食品制作 SOP</p><h2 className="truncate text-xl font-bold" id="sop-editor-title">{draft.id ? '编辑制作流程' : '新建制作流程'}</h2></div>
        <button aria-label="关闭 SOP 编辑" className="ui-icon-button" onClick={onCancel} type="button"><X className="h-5 w-5" /></button>
      </header>

      {errorMessage || validationMessage ? <FeedbackBanner title="SOP 操作未完成" tone="danger">{errorMessage ?? validationMessage}</FeedbackBanner> : null}

      <section className="ui-card grid gap-3 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><p className="text-xs font-bold text-brand-700">01 · 基本信息</p><h3 className="mt-1 font-bold text-slate-900">这份 SOP 制作什么？</h3></div>
        <label className="text-sm font-semibold text-slate-700">产品或流程名称<input className="ui-input mt-1.5" onChange={(event) => onChange({ ...draft, title: event.target.value })} placeholder="例如：芒果酸奶碗（标准版）" value={draft.title} /></label>
        <label className="text-sm font-semibold text-slate-700">制作分类<select className="ui-input mt-1.5" onChange={(event) => onChange({ ...draft, category: event.target.value })} value={draft.category}><option value="">请选择分类</option>{!categories.includes(draft.category) && draft.category ? <option value={draft.category}>{draft.category}</option> : null}{categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
          <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-800">产品预览图（选填）</p><p className="mt-1 text-xs leading-5 text-slate-500">用于管理员 SOP 列表的小图预览；未上传时自动使用最后一个制作步骤图片。更改将在保存后生效。</p></div><TaskTemplateReferenceImageUpload disabled={busy} multiple={false} onUpload={stageCover} /></div>
          {pendingCover?.previewUrl && pendingCover.file ? <div className="mt-3 flex items-center gap-3 rounded-lg bg-white p-2"><button aria-label="放大查看待上传 SOP 产品图" className="shrink-0" onClick={() => setActiveImage({ alt: pendingCover.file!.name, url: pendingCover.previewUrl! })} type="button"><img alt={`${draft.title || 'SOP'} 待上传产品图`} className="h-20 w-20 rounded-lg object-cover" src={pendingCover.previewUrl} /></button><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{pendingCover.file.name}</p><p className="mt-1 text-xs text-brand-700">将在保存时上传</p></div><button aria-label="移除待上传 SOP 产品图" className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" disabled={busy} onClick={() => removePending(pendingCover.key)} type="button"><Trash2 className="h-4 w-4" /></button></div> : existingCover?.signedUrl ? <div className="mt-3 flex items-center gap-3 rounded-lg bg-white p-2"><button aria-label="放大查看 SOP 产品图" className="shrink-0" onClick={() => setActiveImage({ alt: existingCover.file_name ?? 'SOP 产品图', url: existingCover.signedUrl! })} type="button"><img alt={`${draft.title || 'SOP'} 产品图`} className="h-20 w-20 rounded-lg object-cover" src={existingCover.signedUrl} /></button><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{existingCover.file_name}</p><p className="mt-1 text-xs text-brand-700">当前列表预览图</p></div><button aria-label="删除 SOP 产品图" className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" disabled={busy} onClick={() => { if (window.confirm('确定删除当前产品预览图吗？保存后将自动使用最后一个步骤图。')) setDeletedAssetIds((current) => [...current, existingCover.id]); }} type="button"><Trash2 className="h-4 w-4" /></button></div> : null}
        </div>
      </section>

      <section className="ui-card p-4">
        <div><p className="text-xs font-bold text-brand-700">02 · 制作步骤</p><h3 className="mt-1 font-bold text-slate-900">图片与文字可按实际需要组合</h3><p className="mt-1 text-sm leading-6 text-slate-500">每个步骤至少需要图片或文字说明中的一项：可以是纯文字、纯图片，也可以图文同时展示。员工端会按序号连续排列全部步骤。</p></div>
        {!draft.id ? <p className="mt-3 rounded-lg bg-brand-50 p-3 text-sm leading-6 text-brand-800">可以先选择制作图片并填写步骤说明；图片会保留在当前页面，保存草稿或进入发布预览时再统一检查必填项并上传。</p> : null}
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5"><SopImageUpload disabled={busy} onStatusChange={setUploadStatus} onUpload={stageStepImage} stepCount={existingImages.length + pendingSteps.length} /><div className="mt-2 flex justify-end"><button className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700" disabled={busy} onClick={stageTextStep} type="button"><FileText className="h-3.5 w-3.5" />添加纯文字步骤</button></div></div>
        {existingImages.length + pendingSteps.length ? <div className="mt-3 grid grid-cols-2 gap-2" data-testid="sop-step-grid">
          {existingImages.map((asset, index) => {
            const step = existingSteps.find((entry) => entry.id === asset.id) ?? { id: asset.id, sortOrder: index, stepText: asset.step_text };
            const replacement = replacementPreviews[asset.id];
            const visibleImageUrl = replacement?.url ?? (removedImageAssetIds.includes(asset.id) ? null : asset.signedUrl);
            const displayIndex = step.sortOrder;
            return <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white" key={asset.id} style={{ order: displayIndex }}>
              <label className="block p-2 text-xs font-semibold">步骤说明（可选）<textarea className="ui-input mt-1 min-h-20 px-2 py-2 text-sm leading-5" onChange={(event) => setExistingSteps((current) => current.map((entry) => entry.id === asset.id ? { ...entry, stepText: event.target.value } : entry))} placeholder="无图片时必须填写；有图片时可留空" value={step.stepText} /></label>
              {visibleImageUrl ? <button aria-label={`放大查看制作图片 ${index + 1}`} className="relative block w-full" onClick={() => setActiveImage({ alt: asset.file_name ?? `步骤 ${index + 1}`, url: visibleImageUrl })} type="button"><img alt={replacement ? `${asset.file_name ?? '步骤图片'} 替换预览` : asset.file_name ?? `步骤 ${index + 1}`} className="aspect-[4/3] w-full bg-slate-50 object-cover" src={visibleImageUrl} />{replacement ? <span className="absolute inset-x-2 bottom-2 rounded-md bg-black/70 px-2 py-1 text-[10px] font-bold text-white">保存后替换</span> : null}</button> : <div className="flex aspect-[4/3] flex-col items-center justify-center bg-brand-50 px-3 text-center text-brand-800"><FileText className="h-5 w-5" /><span className="mt-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold">纯文字步骤</span></div>}
              <div className="space-y-1.5 p-2">
                <select aria-label={`调整 ${asset.file_name} 的步骤序号`} className="ui-input min-h-8 w-full px-2 py-1 text-xs font-semibold" disabled={busy} onChange={(event) => changeStepPosition('existing', asset.id, Number(event.target.value))} value={displayIndex}>{Array.from({ length: existingImages.length + pendingSteps.length }, (_, position) => <option key={position} value={position}>第 {position + 1} 步</option>)}</select>
                <div className="grid grid-cols-2 gap-1.5">
                  <label className={`ui-button-secondary min-h-8 cursor-pointer px-1.5 py-1 text-xs ${busy ? 'pointer-events-none opacity-50' : ''}`}><RefreshCw className="h-3.5 w-3.5" />{visibleImageUrl ? '替换' : '添加图片'}<input accept="image/jpeg,image/png,image/webp" aria-label={visibleImageUrl ? `替换 ${asset.file_name}` : `添加步骤 ${displayIndex + 1} 图片`} className="hidden" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) replaceImage(asset, file); event.currentTarget.value = ''; }} type="file" /></label>
                  <button aria-label={`删除 ${asset.file_name ?? `步骤 ${displayIndex + 1}`}`} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-lg bg-red-50 px-1.5 py-1 text-xs font-bold text-red-700" disabled={busy} onClick={() => requestExistingStepDelete(asset, step.stepText, displayIndex)} type="button"><Trash2 className="h-3.5 w-3.5" />删除</button>
                </div>
              </div>
            </div>;
          })}
          {pendingSteps.map((asset) => <div className="min-w-0 overflow-hidden rounded-xl border border-brand-200 bg-white" key={asset.key} style={{ order: asset.sortOrder }}>
            <label className="block p-2 text-xs font-semibold">步骤说明（可选）<textarea className="ui-input mt-1 min-h-20 px-2 py-2 text-sm leading-5" onChange={(event) => setPendingAssets((current) => current.map((entry) => entry.key === asset.key ? { ...entry, stepText: event.target.value } : entry))} placeholder="无图片时必须填写；有图片时可留空" value={asset.stepText} /></label>
            {asset.previewUrl && asset.file ? <button aria-label={`放大查看待上传制作图片 ${asset.sortOrder + 1}`} className="relative block w-full" onClick={() => setActiveImage({ alt: asset.file!.name, url: asset.previewUrl! })} type="button"><img alt={asset.file.name} className="aspect-[4/3] w-full bg-slate-50 object-cover" src={asset.previewUrl} /><span className="absolute inset-x-2 bottom-2 rounded-md bg-brand-700/90 px-2 py-1 text-xs font-bold text-white">将在保存时上传</span></button> : <div className="flex aspect-[4/3] flex-col items-center justify-center bg-brand-50 px-3 text-center text-brand-800"><FileText className="h-5 w-5" /><span className="mt-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold">纯文字步骤</span><span className="mt-1 text-[10px]">保存前请填写说明</span></div>}
            <div className="space-y-1.5 p-2">
              <select aria-label={`调整待保存步骤 ${asset.sortOrder + 1} 的步骤序号`} className="ui-input min-h-8 w-full px-2 py-1 text-xs font-semibold" disabled={busy} onChange={(event) => changeStepPosition('pending', asset.key, Number(event.target.value))} value={asset.sortOrder}>{Array.from({ length: existingImages.length + pendingSteps.length }, (_, position) => <option key={position} value={position}>第 {position + 1} 步</option>)}</select>
              <div className="grid grid-cols-2 gap-1.5">
                <label className={`ui-button-secondary min-h-8 cursor-pointer px-1.5 py-1 text-xs ${busy ? 'pointer-events-none opacity-50' : ''}`}><RefreshCw className="h-3.5 w-3.5" />{asset.file ? '替换' : '添加图片'}<input accept="image/jpeg,image/png,image/webp" aria-label={`${asset.file ? '替换' : '添加'}待保存步骤 ${asset.sortOrder + 1} 图片`} className="hidden" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) replacePendingImage(asset.key, file); event.currentTarget.value = ''; }} type="file" /></label>
                <button aria-label={`删除待保存步骤 ${asset.sortOrder + 1}`} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-lg bg-red-50 px-1.5 py-1 text-xs font-bold text-red-700" disabled={busy} onClick={() => requestPendingStepDelete(asset, asset.sortOrder)} type="button"><Trash2 className="h-3.5 w-3.5" />删除</button>
              </div>
            </div>
          </div>)}
        </div> : uploadStatus.isUploading || uploadStatus.hasErrors ? null : <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">尚未添加制作步骤。选择图片或添加纯文字步骤后会立即预览，点击保存后才写入 SOP。</p>}
      </section>

      <section className="ui-card p-4">
        <p className="text-xs font-bold text-brand-700">03 · 整体说明</p><label className="mt-1 block text-sm font-semibold text-slate-700">SOP 用途、适用范围或特别提醒（可选）<textarea className="ui-input mt-1.5 min-h-32 py-3 leading-7" onChange={(event) => onChange({ ...draft, body: event.target.value })} placeholder="例如：适用于标准版芒果酸奶碗；制作前需确认顾客过敏信息。" value={draft.body} /></label>
      </section>

      <section className="ui-card space-y-4 p-4">
        <div><p className="text-xs font-bold text-brand-700">04 · 附件</p><h3 className="mt-1 font-bold text-slate-900">补充资料（选填）</h3><p className="mt-1 text-sm text-slate-500">可上传配方表、培训资料等 PDF 附件。发布范围和高级设置将在详情预览页底部统一填写。</p></div>
        <label className="ui-button-secondary w-fit cursor-pointer"><FileUp className="h-4 w-4" />上传附件<input accept="application/pdf" className="hidden" disabled={busy} multiple onChange={(event) => { addAttachments(event.target.files); event.currentTarget.value = ''; }} type="file" /></label>
        {existingDocuments.length || pendingDocuments.length ? <div className="space-y-2">{existingDocuments.map((asset) => <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-2" key={asset.id}><FileText className="h-4 w-4 text-slate-500" /><span className="min-w-0 flex-1 truncate text-sm">{asset.file_name}</span><button aria-label={`删除 ${asset.file_name}`} className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" onClick={() => { if (window.confirm(`确定删除附件“${asset.file_name}”吗？保存后生效。`)) setDeletedAssetIds((current) => [...current, asset.id]); }} type="button"><Trash2 className="h-4 w-4" /></button></div>)}{pendingDocuments.map((asset) => <div className="flex items-center gap-2 rounded-lg bg-brand-50 p-2" key={asset.key}><FileText className="h-4 w-4 text-brand-700" /><span className="min-w-0 flex-1 truncate text-sm">{asset.file.name}（待上传）</span><button aria-label={`移除 ${asset.file.name}`} className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" onClick={() => removePending(asset.key)} type="button"><Trash2 className="h-4 w-4" /></button></div>)}</div> : null}
      </section>
    </div>
    <EditorActions busy={busy} onCancel={onCancel} onPublish={status === 'published' ? undefined : () => void submit(onPublish, true)} onSave={() => void submit(onSave, false)} publishLabel="保存并预览" saveLabel={status === 'published' ? '保存修改' : '保存草稿'} />
    {deleteStepChoice ? <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/45 p-5" role="dialog" aria-modal="true" aria-labelledby="sop-delete-step-title"><div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-red-600">删除操作</p><h3 className="mt-1 text-lg font-bold text-slate-900" id="sop-delete-step-title">请选择删除范围</h3></div><button aria-label="关闭步骤删除选项" className="ui-icon-button" onClick={() => setDeleteStepChoice(null)} type="button"><X className="h-4 w-4" /></button></div><p className="mt-3 text-sm leading-6 text-slate-600">{deleteStepChoice.label}同时包含图片和文字。只删除图片后，该步骤会保留为纯文字步骤；也可以删除整个步骤。</p><div className="mt-5 grid gap-2"><button className="ui-button-secondary w-full" onClick={() => deleteStepChoice.kind === 'existing' ? removeExistingImageOnly(deleteStepChoice.key) : removePendingImageOnly(deleteStepChoice.key)} type="button">只删除图片</button><button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 font-bold text-white" onClick={() => { if (deleteStepChoice.kind === 'existing') deleteExistingStep(deleteStepChoice.key); else { removePending(deleteStepChoice.key); setDeleteStepChoice(null); } }} type="button"><Trash2 className="h-4 w-4" />删除整个步骤</button><button className="ui-button-secondary w-full" onClick={() => setDeleteStepChoice(null)} type="button">取消</button></div></div></div> : null}
    {validationDialog ? <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-5" role="dialog" aria-modal="true" aria-labelledby="sop-validation-title"><div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"><h3 className="text-lg font-bold text-slate-900" id="sop-validation-title">请完善 SOP 信息</h3><p className="mt-3 text-sm leading-7 text-slate-600">{validationDialog}</p><button className="ui-button-primary mt-5 w-full" onClick={() => setValidationDialog(null)} type="button">我知道了</button></div></div> : null}
    {activeImage ? <div aria-label="SOP 图片全屏预览" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4" onClick={() => setActiveImage(null)} role="dialog"><button aria-label="关闭图片预览" className="absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white" onClick={() => setActiveImage(null)} type="button"><X className="h-6 w-6" /></button><img alt={activeImage.alt} className="max-h-full max-w-full object-contain" onClick={() => setActiveImage(null)} src={activeImage.url} /></div> : null}
  </div>;
}

export function SopBatchOperationsMenu({ onAction, onClose, onImport }: { onAction: (action: SopBatchLifecycleAction) => void; onClose: () => void; onImport: () => void }) {
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="sop-batch-operations-title">
    <section className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-brand-700">SOP 管理 · 批量操作</p><h2 className="mt-1 text-xl font-bold text-slate-900" id="sop-batch-operations-title">选择批量操作</h2><p className="mt-1 text-sm leading-6 text-slate-500">进入功能后，再勾选需要处理的 SOP。</p></div><button aria-label="关闭批量操作" className="ui-icon-button" onClick={onClose} type="button"><X className="h-5 w-5" /></button></div>
      <div className="mt-4 grid gap-2">
        <button className="ui-button-primary justify-start" onClick={onImport} type="button"><Upload className="h-4 w-4" />批量导入<span className="ml-auto text-xs font-normal opacity-80">Excel＋图片文件夹</span></button>
        <button className="ui-button-secondary justify-start" onClick={() => onAction('publish')} type="button"><Rocket className="h-4 w-4" />批量发布<span className="ml-auto text-xs font-normal text-slate-500">仅待发布草稿</span></button>
        <button className="ui-button-secondary justify-start" onClick={() => onAction('retract')} type="button"><Undo2 className="h-4 w-4" />批量撤回<span className="ml-auto text-xs font-normal text-slate-500">仅已发布 SOP</span></button>
        <button className="ui-button-secondary justify-start" onClick={() => onAction('archive')} type="button"><Archive className="h-4 w-4" />批量归档<span className="ml-auto text-xs font-normal text-slate-500">仅待发布草稿</span></button>
      </div>
    </section>
  </div>;
}

const directoryInputProps = { directory: '', webkitdirectory: '' } as Record<string, string>;

interface SopFileHandle {
  getFile: () => Promise<File>;
  kind: 'file';
  name: string;
}

interface SopDirectoryHandle {
  kind: 'directory';
  name: string;
  values: () => AsyncIterableIterator<SopDirectoryHandle | SopFileHandle>;
}

const isSupportedSopImageName = (name: string) => /\.(?:jpe?g|png|webp)$/i.test(name);

const collectReferencedDirectoryFiles = async (root: SopDirectoryHandle, referencedKeys: Set<string>) => {
  const files: File[] = [];
  let candidateImages = 0;
  const scan = async (directory: SopDirectoryHandle): Promise<void> => {
    for await (const entry of directory.values()) {
      if (entry.kind === 'directory') {
        await scan(entry);
        continue;
      }
      if (!isSupportedSopImageName(entry.name)) continue;
      candidateImages += 1;
      if (referencedKeys.has(entry.name.toLowerCase())) files.push(await entry.getFile());
    }
  };
  await scan(root);
  return { candidateImages, files };
};

export function SopBatchImporter({ busy, errorMessage, onCancel, onImport }: { busy: boolean; errorMessage: string | null; onCancel: () => void; onImport: (workbookFile: File, imageFiles: File[], onProgress: (progress: SopBatchImportProgress) => void) => Promise<SopBatchImportResult | null> }) {
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [directoryHandle, setDirectoryHandle] = useState<SopDirectoryHandle | null>(null);
  const [imageMatch, setImageMatch] = useState<{ matched: number; referenced: number; unused: number } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [progress, setProgress] = useState<SopBatchImportProgress | null>(null);
  const [report, setReport] = useState<SopBatchImportResult | null>(null);
  const fallbackDirectoryInputRef = useRef<HTMLInputElement>(null);
  const downloadTemplate = async () => {
    const { createSopBatchTemplate } = await import('../features/content/sopBatchImport');
    const url = URL.createObjectURL(new Blob([createSopBatchTemplate()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'SOP批量导入模板.xlsx'; anchor.click();
    revokeLocalUrl(url);
  };
  const submit = async () => {
    if (!workbookFile) { setLocalError('请先选择 SOP Excel 清单。'); return; }
    setLocalError(null);
    let referencedNames: string[];
    try {
      const { readSopBatchImageFileNames } = await import('../features/content/sopBatchImport');
      referencedNames = await readSopBatchImageFileNames(workbookFile);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '无法读取 Excel 中的图片文件名。');
      return;
    }
    const referencedKeys = new Set(referencedNames.map((name) => name.toLowerCase()));
    let matchedFiles: File[];
    let candidateImages: number;
    if (directoryHandle) {
      setProgress({ completed: 0, detail: `正在文件夹中查找 Excel 引用的 ${referencedNames.length} 张图片`, percent: 0, phase: 'validating', total: referencedNames.length });
      try {
        const matched = await collectReferencedDirectoryFiles(directoryHandle, referencedKeys);
        matchedFiles = matched.files;
        candidateImages = matched.candidateImages;
      } catch (error) {
        setLocalError(`读取所选图片文件夹失败：${error instanceof Error ? error.message : '请重新选择文件夹。'}`);
        return;
      }
    } else {
      matchedFiles = imageFiles.filter((file) => referencedKeys.has(file.name.toLowerCase()));
      candidateImages = imageFiles.length;
    }
    setImageMatch({ matched: matchedFiles.length, referenced: referencedNames.length, unused: Math.max(0, candidateImages - matchedFiles.length) });
    setProgress({ completed: 0, detail: `Excel 引用了 ${referencedNames.length} 张图片，正在匹配并准备上传`, percent: 0, phase: 'validating', total: referencedNames.length });
    const result = await onImport(workbookFile, matchedFiles, setProgress);
    if (result) setReport(result);
  };
  const selectDirectory = async () => {
    const picker = (window as Window & { showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<SopDirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      fallbackDirectoryInputRef.current?.click();
      return;
    }
    try {
      const handle = await picker.call(window, { mode: 'read' });
      setDirectoryHandle(handle);
      setImageFiles([]);
      setImageMatch(null);
      setLocalError(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setLocalError(error instanceof Error ? error.message : '无法选择图片文件夹。');
    }
  };
  return <div className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto bg-canvas px-3 pt-3" role="dialog" aria-modal="true" aria-labelledby="sop-batch-title">
    <div className="mx-auto max-w-2xl space-y-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
      <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-4">
        <div><p className="text-xs font-bold text-brand-700">SOP 批量操作 · 批量导入</p><h2 className="text-xl font-bold" id="sop-batch-title">Excel 清单＋可选图片文件夹</h2></div>
        <button aria-label="关闭 SOP 批量导入" className="ui-icon-button" disabled={busy} onClick={onCancel} type="button"><X className="h-5 w-5" /></button>
      </header>
      {localError || errorMessage ? <FeedbackBanner title="无法完成导入" tone="danger">{localError ?? errorMessage}</FeedbackBanner> : null}
      <section className="ui-card space-y-4 p-4">
        <p className="text-sm leading-7 text-slate-600">模板中每一行代表一个制作步骤。图片文件名和步骤说明至少填写一项，因此可以导入纯文字步骤、纯图片步骤或图文步骤。同一产品的多行会合并为一个 SOP；Excel 中不存在的分类会自动新建。单个 SOP 不合规范或保存失败时不会中断整批，完成后会统一报告失败原因。</p>
        <button className="ui-button-secondary w-full" disabled={busy} onClick={downloadTemplate} type="button"><Download className="h-4 w-4" />下载 Excel 模板</button>
        <label className="block text-sm font-semibold">1. 选择已填写的 Excel
          <input accept=".xlsx,.xls" className="ui-input mt-2 py-2" disabled={busy} onChange={(event) => { setWorkbookFile(event.target.files?.[0] ?? null); setImageMatch(null); }} type="file" />
        </label>
        {workbookFile ? <p className="rounded-lg bg-brand-50 p-3 text-sm text-brand-800">已选：{workbookFile.name}</p> : null}
        <div>
          <p className="text-sm font-semibold">2. 选择步骤图片所在文件夹（纯文字 SOP 可跳过）</p>
          <button className="ui-button-secondary mt-2 w-full" disabled={busy} onClick={() => void selectDirectory()} type="button"><FolderPlus className="h-4 w-4" />{directoryHandle ? '重新选择图片文件夹' : '选择图片文件夹'}</button>
          <input {...directoryInputProps} accept="image/jpeg,image/png,image/webp" aria-label="兼容模式选择步骤图片文件夹" className="hidden" disabled={busy} multiple onChange={(event) => {
            const files = Array.from(event.target.files ?? []).filter((file) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type));
            setImageFiles(files);
            setDirectoryHandle(null);
            setImageMatch(null);
            setLocalError(null);
          }} ref={fallbackDirectoryInputRef} type="file" />
        </div>
        {directoryHandle
          ? <p className="rounded-lg bg-brand-50 p-3 text-sm leading-6 text-brand-900">已选择文件夹“{directoryHandle.name}”。当前只保存本地读取授权，没有读取或上传其中的图片；点击开始导入后才会按 Excel 文件名读取对应图片。</p>
          : imageFiles.length
            ? <p className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900">当前浏览器使用兼容模式，已建立 {imageFiles.length} 张候选图片的本地索引。浏览器可能把授权读取文件写成“上传”，但系统仍只会在开始导入后上传 Excel 实际引用的图片。</p>
            : <p className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600">选择文件夹时只授予本地读取权限，不上传图片。点击开始导入后，系统才会按 Excel“步骤图片文件名”列查找并上传对应图片。</p>}
        {imageMatch ? <div className="grid grid-cols-3 gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-center text-sm text-brand-900">
          <div><p className="text-xl font-bold">{imageMatch.referenced}</p><p className="text-xs">Excel 引用</p></div>
          <div><p className="text-xl font-bold">{imageMatch.matched}</p><p className="text-xs">文件夹匹配</p></div>
          <div><p className="text-xl font-bold">{imageMatch.unused}</p><p className="text-xs">不会上传</p></div>
        </div> : null}
        {progress ? <div aria-label="SOP 批量导入进度" aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress.percent} className="rounded-xl border border-brand-200 bg-brand-50 p-3" role="progressbar">
          <div className="flex items-center justify-between gap-3 text-sm font-bold text-brand-900"><span>{progress.detail}</span><span>{progress.percent}%</span></div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-brand-600 transition-all duration-300" style={{ width: `${progress.percent}%` }} /></div>
          {progress.phase === 'uploading' ? <p className="mt-2 text-xs text-brand-800">已完成步骤 {progress.completed}/{progress.total}</p> : null}
        </div> : null}
      </section>
    </div>
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 px-3 pt-2.5"><div className="mx-auto grid max-w-2xl grid-cols-2 gap-2"><button className="ui-button-secondary" disabled={busy} onClick={onCancel} type="button">取消</button><button className="ui-button-primary" disabled={busy} onClick={() => void submit()} type="button"><Upload className="h-4 w-4" />{busy ? `正在导入 ${progress?.percent ?? 0}%` : '开始导入草稿'}</button></div></div>
    <BatchImportReportDialog failureCount={report?.failed ?? 0} failures={report?.failures ?? []} onClose={() => { setReport(null); onCancel(); }} open={Boolean(report)} successCount={report?.imported ?? 0} successDescription={`成功导入 ${report?.imported ?? 0} 个 SOP 草稿，共 ${report?.steps ?? 0} 个制作步骤。失败项目不会影响其他 SOP。`} title="SOP 批量上传完成" />
  </div>;
}

function EditorActions({ busy, onCancel, onPublish, onSave, publishLabel = '保存并发布', saveLabel = '保存草稿' }: { busy: boolean; onCancel: () => void; onPublish?: () => void; onSave: () => void; publishLabel?: string; saveLabel?: string }) {
  return <div className="safe-bottom fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 px-3 pt-2.5 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur"><div className={`mx-auto grid max-w-3xl gap-2 ${onPublish ? 'grid-cols-[3rem_1fr_1fr]' : 'grid-cols-[3rem_1fr]'}`}><button aria-label="取消编辑" className="ui-icon-button" onClick={onCancel} type="button"><X className="h-5 w-5" /></button><button className={onPublish ? 'ui-button-secondary px-2' : 'ui-button-primary px-2'} disabled={busy} onClick={onSave} type="button"><Save className="h-4 w-4" />{saveLabel}</button>{onPublish ? <button className="ui-button-primary px-2" disabled={busy} onClick={onPublish} type="button"><Rocket className="h-4 w-4" />{publishLabel}</button> : null}</div></div>;
}
