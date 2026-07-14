import type { SupabaseClient } from '@supabase/supabase-js';

import { createUuid } from '../lib/uuid';
import type { Database, Json } from '../types/database';
import { selectSopPreviewAsset } from '../features/content/sopPreview';
import { compressArrivalImage } from './arrival-images.service';

type Client = SupabaseClient<Database>;
export type NoticeRow = Database['public']['Tables']['v2_notices']['Row'];
export type SopRow = Database['public']['Tables']['v2_sops']['Row'];
export type SopAssetRow = Database['public']['Tables']['v2_sop_assets']['Row'];
export type SopCategoryRow = Database['public']['Tables']['v2_sop_categories']['Row'];
export type NoticeAssetRow = Database['public']['Tables']['v2_notice_assets']['Row'];

export interface NoticeListItem extends NoticeRow {
  isRead: boolean;
  readCount: number;
  recipientCount: number;
  recipientIds: string[];
  recipients: Array<{ acknowledgedAt: string | null; firstReadAt: string | null; profileId: string; role: 'staff' | 'manager'; storeId: string }>;
  storeIds: string[];
  assetUrls: Array<NoticeAssetRow & { signedUrl: string }>;
  publisherName: string;
}

export interface SopListItem extends SopRow {
  assetUrls: Array<SopAssetRow & { signedUrl: string | null }>;
  roles: Array<'staff' | 'manager'>;
  storeIds: string[];
  taskTemplateId: string | null;
}

export type SopLibraryEntry = Pick<SopRow, 'category' | 'effective_at' | 'id' | 'status' | 'title' | 'version'> & { previewUrl: string | null };

export interface NoticeDraft {
  body: string;
  id: string | null;
  isPinned: boolean;
  recipientIds: string[];
  requiresAcknowledgment: boolean;
  expiresAt: string;
  storeIds: string[];
  title: string;
}

export interface SopDraft {
  body: string;
  category: string;
  effectiveAt: string;
  id: string | null;
  roles: Array<'staff' | 'manager'>;
  storeIds: string[];
  taskTemplateId: string | null;
  title: string;
}

const throwIfError = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export const createEmptyNoticeDraft = (storeIds: string[] = []): NoticeDraft => ({ body: '', expiresAt: '', id: null, isPinned: false, recipientIds: [], requiresAcknowledgment: false, storeIds, title: '' });
export const createEmptySopDraft = (storeIds: string[] = []): SopDraft => ({ body: '', category: '通用', effectiveAt: '', id: null, roles: ['staff', 'manager'], storeIds, taskTemplateId: null, title: '' });

export const loadNotices = async (client: Client): Promise<NoticeListItem[]> => {
  const [notices, assignments, recipients, assets, profiles, userResult] = await Promise.all([
    client.from('v2_notices').select('*').order('is_pinned', { ascending: false }).order('published_at', { ascending: false }).order('updated_at', { ascending: false }),
    client.from('v2_notice_stores').select('*'),
    client.from('v2_notice_recipients').select('*'),
    client.from('v2_notice_assets').select('*').order('created_at'),
    client.from('profiles').select('id,display_name'),
    client.auth.getUser(),
  ]);
  throwIfError(notices.error);
  throwIfError(assignments.error);
  throwIfError(recipients.error);
  throwIfError(assets.error);
  throwIfError(profiles.error);
  const profileId = userResult.data.user?.id;
  const stores = new Map<string, string[]>();
  (assignments.data ?? []).forEach((item) => stores.set(item.notice_id, [...(stores.get(item.notice_id) ?? []), item.store_id]));
  const byNotice = new Map<string, typeof recipients.data>();
  (recipients.data ?? []).forEach((item) => byNotice.set(item.notice_id, [...(byNotice.get(item.notice_id) ?? []), item]));
  const assetMap = new Map<string, NoticeAssetRow[]>();
  (assets.data ?? []).forEach((item) => assetMap.set(item.notice_id, [...(assetMap.get(item.notice_id) ?? []), item]));
  return Promise.all((notices.data ?? []).map(async (notice) => {
    const rows = byNotice.get(notice.id) ?? [];
    const assetUrls = await Promise.all((assetMap.get(notice.id) ?? []).map(async (asset) => {
      const signed = await client.storage.from('v2-notice-assets').createSignedUrl(asset.object_path, 3600);
      throwIfError(signed.error);
      if (!signed.data) throw new Error('无法生成公告附件访问链接。');
      return { ...asset, signedUrl: signed.data.signedUrl };
    }));
    return { ...notice, assetUrls, isRead: rows.some((item) => item.profile_id === profileId && item.first_read_at !== null), publisherName: (profiles.data ?? []).find((profile) => profile.id === notice.created_by)?.display_name ?? '系统管理员', readCount: rows.filter((item) => item.first_read_at !== null).length, recipientCount: rows.length, recipientIds: rows.map((item) => item.profile_id), recipients: rows.map((item) => ({ acknowledgedAt: item.acknowledged_at, firstReadAt: item.first_read_at, profileId: item.profile_id, role: item.role_snapshot, storeId: item.store_id })), storeIds: stores.get(notice.id) ?? [] };
  }));
};

export const saveNotice = async (client: Client, draft: NoticeDraft) => {
  if (!draft.title.trim()) throw new Error('请填写公告标题。');
  if (!draft.storeIds.length) throw new Error('请至少选择一个发布门店。');
  const { data, error } = await client.rpc('save_v2_notice', {
    p_fields: { body: draft.body, expires_at: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null, is_pinned: draft.isPinned, recipient_ids: draft.recipientIds, requires_acknowledgment: draft.requiresAcknowledgment, title: draft.title.trim() } as Json,
    p_notice_id: draft.id,
    p_store_ids: draft.storeIds,
  });
  throwIfError(error);
  return data as unknown as NoticeRow;
};

export const publishNotice = async (client: Client, noticeId: string) => {
  const { data, error } = await client.rpc('publish_v2_notice', { p_notice_id: noticeId });
  throwIfError(error);
  return data;
};

export const retractNotice = async (client: Client, noticeId: string) => {
  const { data, error } = await client.rpc('retract_v2_notice', { p_notice_id: noticeId });
  throwIfError(error);
  return data;
};

export const deleteNotice = async (client: Client, notice: Pick<NoticeListItem, 'assetUrls' | 'id'>) => {
  const objectPaths = notice.assetUrls.map((asset) => asset.object_path);
  if (objectPaths.length) {
    const { error } = await client.storage.from('v2-notice-assets').remove(objectPaths);
    throwIfError(error);
  }
  const { data, error } = await client.rpc('delete_v2_notice', { p_notice_id: notice.id });
  throwIfError(error);
  return data;
};

export const markNoticeRead = async (client: Client, noticeId: string) => {
  const { error } = await client.rpc('mark_v2_notice_read', { p_notice_id: noticeId });
  throwIfError(error);
};

export const acknowledgeNotice = async (client: Client, noticeId: string) => {
  const { error } = await client.rpc('acknowledge_v2_notice', { p_notice_id: noticeId });
  throwIfError(error);
};

export const uploadNoticeAsset = async (client: Client, input: { file: File; noticeId: string; profileId: string }) => {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  if (!allowed.has(input.file.type)) throw new Error('仅支持 JPG、PNG、WEBP 图片或 PDF 文件。');
  if (input.file.size <= 0 || input.file.size > 10 * 1024 * 1024) throw new Error('附件大小必须在 10 MB 以内。');
  const extension = input.file.name.split('.').pop()?.toLowerCase() || 'file';
  const objectPath = `${input.noticeId}/${createUuid()}.${extension}`;
  const upload = await client.storage.from('v2-notice-assets').upload(objectPath, input.file, { contentType: input.file.type, upsert: false });
  throwIfError(upload.error);
  const { data, error } = await client.from('v2_notice_assets').insert({ file_name: input.file.name, mime_type: input.file.type as NoticeAssetRow['mime_type'], notice_id: input.noticeId, object_path: objectPath, size_bytes: input.file.size, uploaded_by: input.profileId }).select('*').single();
  if (error) { await client.storage.from('v2-notice-assets').remove([objectPath]); throw new Error(error.message); }
  return data;
};

export const loadSops = async (client: Client): Promise<SopListItem[]> => {
  const [sops, assignments, roles, assets] = await Promise.all([
    client.from('v2_sops').select('*').order('category').order('effective_at', { ascending: false }).order('updated_at', { ascending: false }),
    client.from('v2_sop_stores').select('*'),
    client.from('v2_sop_roles').select('*'),
    client.from('v2_sop_assets').select('*').order('sort_order').order('created_at'),
  ]);
  throwIfError(sops.error);
  throwIfError(assignments.error);
  throwIfError(roles.error);
  throwIfError(assets.error);
  const stores = new Map<string, string[]>();
  (assignments.data ?? []).forEach((item) => stores.set(item.sop_id, [...(stores.get(item.sop_id) ?? []), item.store_id]));
  const roleMap = new Map<string, Array<'staff' | 'manager'>>();
  (roles.data ?? []).forEach((item) => roleMap.set(item.sop_id, [...(roleMap.get(item.sop_id) ?? []), item.role]));
  const assetMap = new Map<string, SopAssetRow[]>();
  (assets.data ?? []).forEach((item) => assetMap.set(item.sop_id, [...(assetMap.get(item.sop_id) ?? []), item]));
  return Promise.all((sops.data ?? []).map(async (sop) => ({
    ...sop,
    assetUrls: await Promise.all((assetMap.get(sop.id) ?? []).map(async (asset) => {
      if (!asset.object_path) return { ...asset, signedUrl: null };
      const signed = await client.storage.from('v2-sop-assets').createSignedUrl(asset.object_path, 3600);
      throwIfError(signed.error);
      if (!signed.data) throw new Error('无法生成 SOP 附件访问链接。');
      return { ...asset, signedUrl: signed.data.signedUrl };
    })),
    roles: roleMap.get(sop.id) ?? [],
    storeIds: stores.get(sop.id) ?? [],
    taskTemplateId: sop.task_template_id,
  })));
};

export const archiveNotice = async (client: Client, noticeId: string) => {
  const { data, error } = await client.rpc('archive_v2_notice', { p_notice_id: noticeId });
  throwIfError(error);
  return data;
};

export const loadSopLibraryEntries = async (client: Client): Promise<SopLibraryEntry[]> => {
  const sops = await client.from('v2_sops').select('id,title,category,status,effective_at,version').eq('status', 'published').order('category').order('title');
  throwIfError(sops.error);
  if (!sops.data?.length) return [];
  const assets = await client.from('v2_sop_assets').select('*').in('sop_id', sops.data.map((sop) => sop.id)).in('asset_kind', ['cover', 'step']).order('sort_order').order('created_at');
  throwIfError(assets.error);
  const bySop = new Map<string, SopAssetRow[]>();
  (assets.data ?? []).forEach((asset) => bySop.set(asset.sop_id, [...(bySop.get(asset.sop_id) ?? []), asset]));
  return Promise.all(sops.data.map(async (sop) => {
    const candidates = bySop.get(sop.id) ?? [];
    const preview = selectSopPreviewAsset(candidates);
    if (!preview) return { ...sop, previewUrl: null };
    if (!preview.object_path) return { ...sop, previewUrl: null };
    const signed = await client.storage.from('v2-sop-assets').createSignedUrl(preview.object_path, 3600);
    throwIfError(signed.error);
    return { ...sop, previewUrl: signed.data?.signedUrl ?? null };
  }));
};

export const loadSopDetail = async (client: Client, sopId: string): Promise<SopListItem | null> => {
  const [sop, assignments, roles, assets] = await Promise.all([
    client.from('v2_sops').select('*').eq('id', sopId).maybeSingle(),
    client.from('v2_sop_stores').select('*').eq('sop_id', sopId),
    client.from('v2_sop_roles').select('*').eq('sop_id', sopId),
    client.from('v2_sop_assets').select('*').eq('sop_id', sopId).order('sort_order').order('created_at'),
  ]);
  throwIfError(sop.error);
  throwIfError(assignments.error);
  throwIfError(roles.error);
  throwIfError(assets.error);
  if (!sop.data) return null;
  const assetUrls = await Promise.all((assets.data ?? []).map(async (asset) => {
    if (!asset.object_path) return { ...asset, signedUrl: null };
    const signed = await client.storage.from('v2-sop-assets').createSignedUrl(asset.object_path, 3600);
    throwIfError(signed.error);
    if (!signed.data) throw new Error('无法生成 SOP 附件访问链接。');
    return { ...asset, signedUrl: signed.data.signedUrl };
  }));
  return {
    ...sop.data,
    assetUrls,
    roles: (roles.data ?? []).map((entry) => entry.role),
    storeIds: (assignments.data ?? []).map((entry) => entry.store_id),
    taskTemplateId: sop.data.task_template_id,
  };
};

export const loadSopCategories = async (client: Client): Promise<SopCategoryRow[]> => {
  const { data, error } = await client.from('v2_sop_categories').select('*').eq('is_active', true).order('sort_order').order('name');
  throwIfError(error);
  return data ?? [];
};

export const createSopCategory = async (client: Client, input: { name: string; profileId: string }) => {
  const name = input.name.trim();
  if (!name) throw new Error('请填写 SOP 分类名称。');
  const { data, error } = await client.from('v2_sop_categories').upsert({ created_by: input.profileId, name }, { ignoreDuplicates: true, onConflict: 'name' }).select('*');
  throwIfError(error);
  return data?.[0] ?? null;
};

export const deleteSopCategory = async (client: Client, categoryId: string) => {
  const { data, error } = await client.rpc('delete_v2_sop_category', { p_category_id: categoryId });
  if (error?.message.includes('SOP_CATEGORY_IN_USE')) {
    throw new Error('该分类仍被 SOP 使用，请先把这些 SOP 调整到其他分类后再删除。');
  }
  throwIfError(error);
  return data;
};

export const renameSopCategory = async (client: Client, input: { categoryId: string; newName: string }) => {
  const newName = input.newName.trim();
  if (!newName) throw new Error('请填写新的 SOP 分类名称。');
  const { data, error } = await client.rpc('rename_v2_sop_category', {
    p_category_id: input.categoryId,
    p_new_name: newName,
  });
  if (error?.message.includes('SOP_CATEGORY_NAME_EXISTS')) {
    throw new Error('该分类名称已存在，请使用其他名称。');
  }
  throwIfError(error);
  return data;
};

export const saveSop = async (client: Client, draft: SopDraft) => {
  if (!draft.title.trim() || !draft.category.trim()) throw new Error('请填写 SOP 标题和分类。');
  if (!draft.storeIds.length || !draft.roles.length) throw new Error('请至少选择一个适用门店和角色。');
  const { data, error } = await client.rpc('save_v2_sop', {
    p_fields: { body: draft.body, category: draft.category.trim(), effective_at: draft.effectiveAt ? new Date(draft.effectiveAt).toISOString() : null, task_template_id: draft.taskTemplateId, title: draft.title.trim() } as Json,
    p_roles: draft.roles,
    p_sop_id: draft.id,
    p_store_ids: draft.storeIds,
  });
  throwIfError(error);
  return data as unknown as SopRow;
};

export const publishSop = async (client: Client, sopId: string, options: { silent?: boolean } = {}) => {
  const { data, error } = await client.rpc('publish_v2_sop_with_options', { p_silent: options.silent ?? false, p_sop_id: sopId });
  throwIfError(error);
  return data;
};

export const retractSop = async (client: Client, sopId: string) => {
  const { data, error } = await client.rpc('retract_v2_sop', { p_sop_id: sopId });
  throwIfError(error);
  return data;
};

export const archiveSop = async (client: Client, sopId: string) => {
  const { data, error } = await client.rpc('archive_v2_sop', { p_sop_id: sopId });
  throwIfError(error);
  return data;
};

export const unarchiveSop = async (client: Client, sopId: string) => {
  const { data, error } = await client.rpc('unarchive_v2_sop', { p_sop_id: sopId });
  throwIfError(error);
  return data;
};

export const uploadSopAsset = async (
  client: Client,
  input: { assetKind?: SopAssetRow['asset_kind']; file: File; profileId: string; sopId: string; sortOrder?: number; stepText?: string },
  onProgress?: (progress: number) => void,
) => {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  if (!allowed.has(input.file.type)) throw new Error('仅支持 JPG、PNG、WEBP 图片或 PDF 文件。');
  if (input.file.size <= 0) throw new Error('所选文件为空，请重新选择。');
  onProgress?.(5);
  let body: Blob = input.file;
  let mimeType = input.file.type as Exclude<SopAssetRow['mime_type'], null>;
  if (input.file.type.startsWith('image/')) {
    try {
      const processed = await compressArrivalImage(input.file);
      body = processed.blob;
      mimeType = processed.mimeType;
    } catch (error) {
      throw new Error(`图片处理失败：${error instanceof Error ? error.message : '无法读取所选图片。'}`);
    }
  } else if (input.file.size > 10 * 1024 * 1024) {
    throw new Error('PDF 文件大小必须在 10 MB 以内。');
  }
  onProgress?.(35);
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/jpeg' ? 'jpg' : 'pdf';
  const objectPath = `${input.sopId}/${createUuid()}.${extension}`;
  const bucket = client.storage.from('v2-sop-assets');
  const upload = await bucket.upload(objectPath, body, { cacheControl: '3600', contentType: mimeType, upsert: false });
  throwIfError(upload.error);
  onProgress?.(70);
  const { data, error } = await client.from('v2_sop_assets').insert({
    asset_kind: input.assetKind ?? (mimeType === 'application/pdf' ? 'attachment' : 'step'),
    file_name: input.file.name,
    mime_type: mimeType,
    object_path: objectPath,
    size_bytes: body.size,
    sop_id: input.sopId,
    sort_order: input.sortOrder ?? 0,
    step_text: input.stepText?.trim() ?? '',
    uploaded_by: input.profileId,
  }).select('*').single();
  if (error) {
    await bucket.remove([objectPath]);
    throw new Error(error.message);
  }
  onProgress?.(85);
  const signed = await bucket.createSignedUrl(objectPath, 3600);
  if (signed.error || !signed.data) {
    await client.from('v2_sop_assets').delete().eq('id', data.id);
    await bucket.remove([objectPath]);
    throw new Error(`预览生成失败：${signed.error?.message ?? '无法生成 SOP 图片访问地址。'}`);
  }
  onProgress?.(100);
  return { ...data, signedUrl: signed.data.signedUrl };
};

export const createSopTextStep = async (client: Client, input: { sopId: string; sortOrder: number; stepText: string }) => {
  const stepText = input.stepText.trim();
  if (!stepText) throw new Error('纯文字步骤必须填写步骤说明。');
  const { data, error } = await client.rpc('create_v2_sop_text_step', {
    p_sop_id: input.sopId,
    p_sort_order: input.sortOrder,
    p_step_text: stepText,
  });
  throwIfError(error);
  return { ...(data as unknown as SopAssetRow), signedUrl: null };
};

export const deleteArchivedSop = async (client: Client, sop: Pick<SopListItem, 'assetUrls' | 'id'>) => {
  const objectPaths = sop.assetUrls.map((asset) => asset.object_path).filter((path): path is string => Boolean(path));
  if (objectPaths.length) {
    const storage = await client.storage.from('v2-sop-assets').remove(objectPaths);
    throwIfError(storage.error);
  }
  const { data, error } = await client.rpc('delete_archived_v2_sop', { p_sop_id: sop.id });
  throwIfError(error);
  return data;
};

export const updateSopAssetSteps = async (client: Client, steps: Array<{ id: string; sortOrder: number; stepText: string }>) => {
  for (const step of steps) {
    const { error } = await client.from('v2_sop_assets').update({ sort_order: step.sortOrder, step_text: step.stepText.trim() }).eq('id', step.id);
    throwIfError(error);
  }
};

export const reorderSopAssets = async (client: Client, sopId: string, orderedAssetIds: string[]) => {
  const { data, error } = await client.rpc('reorder_v2_sop_assets', { p_asset_ids: orderedAssetIds, p_sop_id: sopId });
  throwIfError(error);
  return data;
};

export const deleteSopAsset = async (client: Client, asset: Pick<SopAssetRow, 'id' | 'object_path'>) => {
  const { error } = await client.from('v2_sop_assets').delete().eq('id', asset.id);
  throwIfError(error);
  if (!asset.object_path) return { storageCleanupFailed: false };
  const storage = await client.storage.from('v2-sop-assets').remove([asset.object_path]);
  return { storageCleanupFailed: Boolean(storage.error) };
};
