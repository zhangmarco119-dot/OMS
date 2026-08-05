import type { SupabaseClient } from '@supabase/supabase-js';

import { createUuid } from '../lib/uuid';
import type { Database, Json } from '../types/database';
import { selectSopPreviewAsset } from '../features/content/sopPreview';
import { invalidateSopImageUrl, loadSopImageUrl } from '../features/content/sopImageDelivery';
import { primeImageResource, storageImageCacheKey } from '../lib/imageResourceCache';
import { compressArrivalImage } from './arrival-images.service';

type Client = SupabaseClient<Database>;
export type NoticeRow = Database['public']['Tables']['v2_notices']['Row'];
export type SopRow = Database['public']['Tables']['v2_sops']['Row'];
export type SopAssetRow = Database['public']['Tables']['v2_sop_assets']['Row'];
export type SopCategoryRow = Database['public']['Tables']['v2_sop_categories']['Row'];
export type NoticeAssetRow = Database['public']['Tables']['v2_notice_assets']['Row'];

export interface ContentRecipient {
  display_name: string;
  id: string;
  role: 'staff' | 'manager';
  storeIds: string[];
}

type ContentRecipientProfile = Pick<Database['public']['Tables']['profiles']['Row'], 'display_name' | 'id' | 'role' | 'store_id'>;
type ContentRecipientStoreAccess = Pick<Database['public']['Tables']['profile_store_access']['Row'], 'profile_id' | 'store_id'>;

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
  attachmentCount?: number;
  assetUrls: Array<SopAssetRow & { signedUrl: string | null }>;
  roles: Array<'staff' | 'manager'>;
  stepCount?: number;
  storeIds: string[];
  taskTemplateId: string | null;
}

export type SopLibraryEntry = Pick<SopRow, 'category' | 'effective_at' | 'id' | 'status' | 'title' | 'version'> & { isFavorite: boolean; previewPath: string | null; previewUrl: string | null };
export interface SopPage { items: SopListItem[]; total: number }
export interface SopLibraryPage { items: SopLibraryEntry[]; total: number }

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

export const buildContentRecipients = (profiles: ContentRecipientProfile[], storeAccess: ContentRecipientStoreAccess[]): ContentRecipient[] => {
  const additionalStoreIds = new Map<string, Set<string>>();
  storeAccess.forEach((access) => {
    const storeIds = additionalStoreIds.get(access.profile_id) ?? new Set<string>();
    storeIds.add(access.store_id);
    additionalStoreIds.set(access.profile_id, storeIds);
  });
  return profiles.flatMap((profile) => profile.role === 'staff' || profile.role === 'manager'
    ? [{
        display_name: profile.display_name,
        id: profile.id,
        role: profile.role,
        storeIds: Array.from(new Set([profile.store_id, ...(additionalStoreIds.get(profile.id) ?? [])])),
      }]
    : []);
};

export const loadContentRecipients = async (client: Client): Promise<ContentRecipient[]> => {
  const [profiles, storeAccess] = await Promise.all([
    client.from('profiles').select('id,display_name,role,store_id').in('role', ['staff', 'manager']).eq('is_active', true).is('deleted_at', null).order('display_name'),
    client.from('profile_store_access').select('profile_id,store_id'),
  ]);
  throwIfError(profiles.error);
  throwIfError(storeAccess.error);
  return buildContentRecipients(profiles.data ?? [], storeAccess.data ?? []);
};

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

const escapePostgrestSearch = (value: string) => value.replace(/[,%()]/g, ' ').trim();

type SopCardRpcItem = SopRow & {
  attachmentCount: number;
  isFavorite: boolean;
  previewAsset: SopAssetRow | null;
  roles: Array<'staff' | 'manager'>;
  stepCount: number;
  storeIds: string[];
};

const parseSopCardPage = (data: Json | null) => {
  const root = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, Json | undefined> : {};
  return {
    items: (Array.isArray(root.items) ? root.items : []) as unknown as SopCardRpcItem[],
    total: typeof root.total === 'number' ? root.total : 0,
  };
};

const signSopPreviewAssets = async (client: Client, items: SopCardRpcItem[]) => {
  return Promise.all(items.map(async (item) => ({
    item,
    previewUrl: item.previewAsset?.object_path
      ? await loadSopImageUrl(client, item.previewAsset.object_path, 'thumbnail')
      : null,
  })));
};

export const loadSopPage = async (client: Client, options: { archived?: boolean; category?: string; limit?: number; offset?: number; search?: string; signal?: AbortSignal } = {}): Promise<SopPage> => {
  const limit = Math.min(Math.max(options.limit ?? 16, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);
  const search = escapePostgrestSearch(options.search ?? '');
  const request = client.rpc('list_v2_sop_cards', {
    p_archived: options.archived ?? false,
    p_category: options.category ?? 'all',
    p_favorites_only: false,
    p_limit: limit,
    p_offset: offset,
    p_search: search,
  });
  const response = await (options.signal ? request.abortSignal(options.signal) : request);
  throwIfError(response.error);
  const page = parseSopCardPage(response.data);
  const signed = await signSopPreviewAssets(client, page.items);
  return {
    total: page.total,
    items: signed.map(({ item, previewUrl }): SopListItem => ({
      ...item,
      assetUrls: item.previewAsset ? [{ ...item.previewAsset, signedUrl: previewUrl }] : [],
      attachmentCount: item.attachmentCount,
      stepCount: item.stepCount,
      taskTemplateId: item.task_template_id,
    })),
  };
};

export const loadSopArchiveCount = async (client: Client) => {
  const result = await client.from('v2_sops').select('id', { count: 'exact', head: true }).eq('status', 'archived');
  throwIfError(result.error);
  return result.count ?? 0;
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
    if (!preview?.object_path) return { ...sop, isFavorite: false, previewPath: null, previewUrl: null };
    return { ...sop, isFavorite: false, previewPath: preview.object_path, previewUrl: null };
  }));
};

export const loadSopLibraryPage = async (client: Client, options: { category?: string; favoritesOnly?: boolean; limit?: number; offset?: number; search?: string; signal?: AbortSignal } = {}): Promise<SopLibraryPage> => {
  const limit = Math.min(Math.max(options.limit ?? 16, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);
  const search = escapePostgrestSearch(options.search ?? '');
  const request = client.rpc('list_v2_sop_cards', {
    p_archived: false,
    p_category: options.category ?? 'all',
    p_favorites_only: options.favoritesOnly ?? false,
    p_limit: limit,
    p_offset: offset,
    p_search: search,
  });
  const response = await (options.signal ? request.abortSignal(options.signal) : request);
  throwIfError(response.error);
  const page = parseSopCardPage(response.data);
  return {
    total: page.total,
    items: page.items.map((item) => ({ category: item.category, effective_at: item.effective_at, id: item.id, isFavorite: item.isFavorite, previewPath: item.previewAsset?.object_path ?? null, previewUrl: null, status: item.status, title: item.title, version: item.version })),
  };
};

export const setSopFavorite = async (client: Client, sopId: string, favorite: boolean) => {
  const user = await client.auth.getUser();
  const profileId = user.data.user?.id;
  if (!profileId) throw new Error('登录状态已失效，请重新登录。');
  const result = favorite
    ? await client.from('v2_sop_favorites').insert({ profile_id: profileId, sop_id: sopId })
    : await client.from('v2_sop_favorites').delete().eq('profile_id', profileId).eq('sop_id', sopId);
  throwIfError(result.error);
};

type SopDetailRpcItem = SopRow & { assets: SopAssetRow[]; roles: Array<'staff' | 'manager'>; storeIds: string[] };

const sopDetailCache = new WeakMap<Client, Map<string, { expiresAt: number; value: SopListItem | null }>>();
const sopDetailPending = new WeakMap<Client, Map<string, Promise<SopListItem | null>>>();

const loadSopDetailMetadata = async (client: Client, sopId: string): Promise<SopListItem | null> => {
  const response = await client.rpc('get_v2_sop_detail', { p_sop_id: sopId });
  throwIfError(response.error);
  if (!response.data) return null;
  const detail = response.data as unknown as SopDetailRpcItem;
  return {
    ...detail,
    assetUrls: (detail.assets ?? []).map((asset) => ({ ...asset, signedUrl: null })),
    roles: detail.roles ?? [],
    storeIds: detail.storeIds ?? [],
    taskTemplateId: detail.task_template_id,
  };
};

export const loadSopDetail = async (
  client: Client,
  sopId: string,
  options: { cacheMetadata?: boolean; signAssets?: boolean } = {},
): Promise<SopListItem | null> => {
  const signAssets = options.signAssets ?? true;
  let detail: SopListItem | null;
  if (options.cacheMetadata && !signAssets) {
    const cache = sopDetailCache.get(client) ?? new Map<string, { expiresAt: number; value: SopListItem | null }>();
    sopDetailCache.set(client, cache);
    const cached = cache.get(sopId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const pending = sopDetailPending.get(client) ?? new Map<string, Promise<SopListItem | null>>();
    sopDetailPending.set(client, pending);
    const activeRequest = pending.get(sopId);
    if (activeRequest) return activeRequest;
    const request = loadSopDetailMetadata(client, sopId);
    pending.set(sopId, request);
    try {
      detail = await request;
      cache.set(sopId, { expiresAt: Date.now() + 30_000, value: detail });
    } finally {
      pending.delete(sopId);
    }
  } else {
    detail = await loadSopDetailMetadata(client, sopId);
  }
  if (!detail || !signAssets) return detail;
  return {
    ...detail,
    assetUrls: await Promise.all(detail.assetUrls.map(async (asset) => {
      if (!asset.object_path) return { ...asset, signedUrl: null };
      if (asset.mime_type?.startsWith('image/')) {
        return { ...asset, signedUrl: await loadSopImageUrl(client, asset.object_path, 'detail') };
      }
      const signed = await client.storage.from('v2-sop-assets').createSignedUrl(asset.object_path, 3600);
      throwIfError(signed.error);
      return { ...asset, signedUrl: signed.data?.signedUrl ?? null };
    })),
  };
};

export const prefetchSopDetail = (client: Client, sopId: string) => loadSopDetail(client, sopId, { cacheMetadata: true, signAssets: false });

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
  const previewUrl = mimeType.startsWith('image/')
    ? await primeImageResource(
      storageImageCacheKey('v2-sop-assets', objectPath, { variant: 'detail' }),
      body,
      'device',
    ) ?? signed.data.signedUrl
    : signed.data.signedUrl;
  onProgress?.(100);
  return { ...data, signedUrl: previewUrl };
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

export const removeSopStepImage = async (client: Client, asset: SopAssetRow) => {
  if (asset.asset_kind !== 'step') throw new Error('只能移除 SOP 步骤图片。');
  if (!asset.step_text.trim()) throw new Error('删除图片前请先填写步骤说明，确保该步骤可以转为纯文字步骤。');
  const { error } = await client.from('v2_sop_assets').update({
    file_name: null,
    mime_type: null,
    object_path: null,
    size_bytes: 0,
  }).eq('id', asset.id);
  throwIfError(error);
  if (!asset.object_path) return { storageCleanupFailed: false };
  const cleanup = await client.storage.from('v2-sop-assets').remove([asset.object_path]);
  invalidateSopImageUrl(asset.object_path);
  return { storageCleanupFailed: Boolean(cleanup.error) };
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
  invalidateSopImageUrl(asset.object_path);
  return { storageCleanupFailed: Boolean(storage.error) };
};
