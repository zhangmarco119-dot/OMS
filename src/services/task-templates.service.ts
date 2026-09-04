import type { SupabaseClient } from '@supabase/supabase-js';

import { loadStorageImageResource } from '../lib/imageResourceCache';
import { createUuid } from '../lib/uuid';
import {
  validateTaskTemplateDraft,
  type TaskTemplateDraft,
  type TaskTemplateGroupDraft,
} from '../features/task-templates/templateForm';
import type { Database, Json } from '../types/database';
import { compressArrivalImage } from './arrival-images.service';

type Client = SupabaseClient<Database>;
export type TaskTemplateRow = Database['public']['Tables']['v2_task_templates']['Row'];
type TaskTemplateGroupRow = Database['public']['Tables']['v2_task_template_groups']['Row'];
type TaskTemplateItemRow = Database['public']['Tables']['v2_task_template_items']['Row'];

export interface TaskTemplateListItem extends TaskTemplateRow {
  storeIds: string[];
}
export interface SavedTaskTemplate { id: string; status: TaskTemplateRow['status']; }
export type TaskCategoryRow = Database['public']['Tables']['v2_task_categories']['Row'];

const throwIfError = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export const loadTaskTemplates = async (client: Client): Promise<TaskTemplateListItem[]> => {
  const [templates, stores] = await Promise.all([
    client.from('v2_task_templates').select('*').order('updated_at', { ascending: false }),
    client.from('v2_task_template_stores').select('*'),
  ]);
  throwIfError(templates.error);
  throwIfError(stores.error);
  const storesByTemplate = new Map<string, string[]>();
  (stores.data ?? []).forEach((assignment) => {
    storesByTemplate.set(assignment.template_id, [...(storesByTemplate.get(assignment.template_id) ?? []), assignment.store_id]);
  });
  return (templates.data ?? []).map((template) => ({ ...template, storeIds: storesByTemplate.get(template.id) ?? [] }));
};

export const loadPublishableTaskTemplates = async (client: Client): Promise<TaskTemplateListItem[]> => {
  const { data, error } = await client.rpc('list_publishable_v2_task_templates');
  throwIfError(error);
  if (!Array.isArray(data)) throw new Error('已发布任务模板加载失败。');
  return data as unknown as TaskTemplateListItem[];
};

export const loadTaskCategories = async (client: Client): Promise<TaskCategoryRow[]> => {
  const { data, error } = await client.from('v2_task_categories').select('*').order('is_system', { ascending: false }).order('created_at');
  throwIfError(error);
  return data ?? [];
};

export const createTaskCategory = async (client: Client, label: string) => {
  const { data, error } = await client.rpc('create_v2_task_category', { p_label: label });
  throwIfError(error);
  return data;
};

export const deleteTaskCategory = async (client: Client, code: string) => {
  const { data, error } = await client.rpc('delete_v2_task_category', { p_code: code });
  throwIfError(error);
  return data;
};

const getReferenceImageUrl = async (client: Client, templateId: string, path: string | null) => {
  if (!path) return null;
  try {
    return await loadStorageImageResource(client, 'v2-task-template-reference-images', path, {
      scope: 'session',
      variant: 'task-reference',
    });
  } catch {
    // Continue to the legacy signing fallback for older WebViews.
  }
  const { data, error } = await client.storage.from('v2-task-template-reference-images').createSignedUrl(path, 60 * 60);
  if (!error && data?.signedUrl) return data.signedUrl;

  // Signing is a JSON-only Edge Function operation and is safe as a fallback on
  // WebViews where the direct Storage signing request occasionally loses auth.
  const fallback = await client.functions.invoke('task-template-images', {
    body: { action: 'sign', path, scope: 'template', templateId },
  });
  if (!fallback.error && fallback.data && typeof fallback.data === 'object'
    && 'signedUrl' in fallback.data && typeof fallback.data.signedUrl === 'string') {
    return fallback.data.signedUrl;
  }
  throw new Error(`参考图片预览地址生成失败：${error?.message ?? fallback.error?.message ?? '未知错误'}`);
};

const referencePaths = (item: TaskTemplateItemRow) => item.reference_image_paths.length > 0
  ? item.reference_image_paths
  : item.reference_image_path ? [item.reference_image_path] : [];

const groupsToDraft = (groups: TaskTemplateGroupRow[], items: TaskTemplateItemRow[]): TaskTemplateGroupDraft[] =>
  groups.map((group) => ({
    description: group.description,
    id: group.id,
    items: items.filter((item) => item.group_id === group.id).map((item) => {
      const paths = referencePaths(item);
      return {
        fieldType: item.field_type,
        guidance: item.guidance,
        id: item.id,
        imageRequirement: item.image_requirement,
        isRequired: item.is_required,
        label: item.label,
        minimumImageCount: item.minimum_image_count ?? 2,
        optionsText: Array.isArray(item.options) ? item.options.filter((entry): entry is string => typeof entry === 'string').join('\n') : '',
        referenceImagePath: paths[0] ?? null,
        referenceImageUrl: null,
        referenceImagePaths: paths,
        referenceImageUrls: [],
      };
    }),
    title: group.title,
  }));

export const loadTaskTemplateDraft = async (client: Client, template: TaskTemplateListItem): Promise<TaskTemplateDraft> => {
  const [groups, items] = await Promise.all([
    client.from('v2_task_template_groups').select('*').eq('template_id', template.id).order('sort_order'),
    client.from('v2_task_template_items').select('*').eq('template_id', template.id).order('sort_order'),
  ]);
  throwIfError(groups.error);
  throwIfError(items.error);
  return {
    allowOverdue: template.allow_overdue,
    category: template.category,
    description: template.description,
    dueTime: '',
    groups: groupsToDraft(groups.data ?? [], items.data ?? []),
    id: template.id,
    name: template.name,
    recurrence: 'none',
    recurrenceDay: null,
    requiresReview: template.requires_review,
    storeIds: template.storeIds,
  };
};

export const loadTaskTemplateDraftImageUrls = async (
  client: Client,
  draft: TaskTemplateDraft,
): Promise<TaskTemplateDraft> => ({
  ...draft,
  groups: await Promise.all(draft.groups.map(async (group) => ({
    ...group,
    items: await Promise.all(group.items.map(async (item) => {
      const urls = await Promise.all(item.referenceImagePaths.map(async (path) => {
        try { return await getReferenceImageUrl(client, draft.id ?? '', path); }
        catch { return null; }
      }));
      return { ...item, referenceImageUrl: urls[0] || null, referenceImageUrls: urls.map((url) => url ?? '') };
    })),
  }))),
});

const serializeGroups = (groups: TaskTemplateGroupDraft[]): Json => groups.map((group, groupIndex) => ({
  description: group.description,
  id: group.id,
  items: group.items.map((item, itemIndex) => ({
    field_type: item.fieldType,
    guidance: item.guidance,
    id: item.id,
    image_requirement: item.imageRequirement,
    is_required: item.isRequired,
    label: item.label,
    minimum_image_count: item.imageRequirement === 'multiple' ? item.minimumImageCount : null,
    options: item.optionsText.split('\n').map((option) => option.trim()).filter(Boolean),
    reference_image_path: item.referenceImagePaths[0] ?? item.referenceImagePath,
    reference_image_paths: item.referenceImagePaths,
    sort_order: itemIndex,
  })),
  sort_order: groupIndex,
  title: group.title,
}));

const mergePersistedReferenceImages = async (client: Client, input: TaskTemplateDraft): Promise<TaskTemplateDraft> => {
  if (!input.id) return input;
  const itemIds = input.groups.flatMap((group) => group.items.map((item) => item.id));
  if (itemIds.length === 0) return input;
  const { data, error } = await client
    .from('v2_task_template_items')
    .select('id,reference_image_path,reference_image_paths')
    .eq('template_id', input.id)
    .in('id', itemIds);
  throwIfError(error);
  const pathsByItem = new Map((data ?? []).map((item) => [item.id, item.reference_image_paths.length > 0
    ? item.reference_image_paths
    : item.reference_image_path ? [item.reference_image_path] : []]));
  return {
    ...input,
    groups: input.groups.map((group) => ({
      ...group,
      items: group.items.map((item) => {
        const localPaths = item.referenceImagePaths.length > 0
          ? item.referenceImagePaths
          : item.referenceImagePath ? [item.referenceImagePath] : [];
        // Existing server items are authoritative. Upload and deletion both update
        // their image links immediately, while a restored local draft may be stale.
        const paths = pathsByItem.has(item.id) ? (pathsByItem.get(item.id) ?? []) : localPaths;
        return {
          ...item,
          referenceImagePath: paths[0] ?? null,
          referenceImagePaths: paths,
        };
      }),
    })),
  };
};

export const saveTaskTemplate = async (client: Client, input: TaskTemplateDraft): Promise<SavedTaskTemplate> => {
  // A mobile photo picker may briefly suspend the page. Preserve any image link
  // that already reached the server even if a restored browser draft is stale.
  // Explicit image removal updates the server immediately, so it is not restored.
  const draft = validateTaskTemplateDraft(await mergePersistedReferenceImages(client, input));
  const rpcInput = {
    p_fields: {
      allow_overdue: draft.allowOverdue,
      category: draft.category,
      description: draft.description,
      due_time: null,
      name: draft.name,
      recurrence: 'none',
      recurrence_day: null,
      requires_review: draft.requiresReview,
    },
    p_groups: serializeGroups(draft.groups),
    p_store_ids: draft.storeIds,
    p_template_id: draft.id,
  };
  let { data, error } = await client.rpc('save_v2_task_template', rpcInput);
  if (error && !draft.id && error.message.includes('v2_task_template_groups_pkey')) {
    const groupIds = draft.groups.map((group) => group.id);
    const recovered = await client.from('v2_task_template_groups').select('template_id').in('id', groupIds);
    throwIfError(recovered.error);
    const templateIds = [...new Set((recovered.data ?? []).map((group) => group.template_id))];
    if (templateIds.length === 1) {
      ({ data, error } = await client.rpc('save_v2_task_template', { ...rpcInput, p_template_id: templateIds[0] }));
    }
  }
  throwIfError(error);
  const saved = data as unknown as SavedTaskTemplate;
  const minimumImageCounts = draft.groups.flatMap((group) => group.items
    .filter((item) => item.imageRequirement === 'multiple')
    .map((item) => ({ item_id: item.id, minimum_image_count: item.minimumImageCount })));
  const countsResult = await client.rpc('set_v2_task_template_minimum_image_counts', {
    p_counts: minimumImageCounts,
    p_template_id: saved.id,
  });
  throwIfError(countsResult.error);
  return saved;
};

export const publishTaskTemplate = async (client: Client, templateId: string) => {
  const { data, error } = await client.rpc('publish_v2_task_template', { p_template_id: templateId });
  throwIfError(error);
  return data;
};

export const retractTaskTemplate = async (client: Client, templateId: string) => {
  const { data, error } = await client.rpc('retract_v2_task_template', { p_template_id: templateId });
  throwIfError(error);
  return data;
};

export const renameTaskTemplate = async (client: Client, templateId: string, name: string) => {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('请填写模板名称。');
  const { data, error } = await client.rpc('rename_v2_task_template', {
    p_name: trimmedName,
    p_template_id: templateId,
  });
  throwIfError(error);
  return data;
};

export const archiveTaskTemplate = async (client: Client, templateId: string) => {
  const { data, error } = await client.rpc('archive_v2_task_template', { p_template_id: templateId });
  throwIfError(error);
  return data;
};

export const deleteArchivedTaskTemplate = async (client: Client, templateId: string) => {
  const { data: items, error: itemsError } = await client
    .from('v2_task_template_items')
    .select('reference_image_path,reference_image_paths')
    .eq('template_id', templateId);
  throwIfError(itemsError);
  const paths = [...new Set((items ?? []).flatMap((item) => item.reference_image_paths.length > 0 ? item.reference_image_paths : item.reference_image_path ? [item.reference_image_path] : []))];
  if (paths.length > 0) {
    const { error } = await client.storage.from('v2-task-template-reference-images').remove(paths);
    throwIfError(error);
  }
  const { data, error } = await client.rpc('delete_archived_v2_task_template', { p_template_id: templateId });
  throwIfError(error);
  return data;
};

export const uploadTaskTemplateReferenceImage = async (client: Client, templateId: string, itemId: string, file: File, onProgress?: (progress: number) => void) => {
  onProgress?.(5);
  let processed: Awaited<ReturnType<typeof compressArrivalImage>>;
  try {
    processed = await compressArrivalImage(file);
  } catch (error) {
    throw new Error(`图片处理失败：${error instanceof Error ? error.message : '无法读取所选图片。'}`);
  }
  onProgress?.(35);
  const objectId = createUuid();
  const extension = processed.mimeType === 'image/png' ? 'png' : processed.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${templateId}/${itemId}/${objectId}.${extension}`;
  const bucket = client.storage.from('v2-task-template-reference-images');
  const { error: uploadError } = await bucket.upload(path, processed.blob, {
    cacheControl: '3600',
    contentType: processed.mimeType,
    upsert: false,
  });
  if (uploadError) throw new Error(`Storage 上传失败：${uploadError.message}`);
  onProgress?.(70);

  const { error: attachError } = await client.rpc('attach_v2_task_template_reference_image', {
    p_item_id: itemId,
    p_path: path,
    p_template_id: templateId,
  });
  if (attachError) {
    await bucket.remove([path]);
    throw new Error(`模板项目关联失败：${attachError.message}`);
  }
  onProgress?.(85);

  const previewUrl = await getReferenceImageUrl(client, templateId, path);
  if (!previewUrl) throw new Error('预览生成失败：参考图片已上传，但无法生成预览地址。');
  onProgress?.(100);
  return { path, previewUrl };
};

export const deleteTaskTemplateReferenceImage = async (client: Client, templateId: string, itemId: string, path: string) => {
  const { data, error } = await client.functions.invoke('task-template-images', { body: { action: 'delete', itemId, path, templateId } });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || !('paths' in data) || !Array.isArray(data.paths) || !data.paths.every((entry: unknown) => typeof entry === 'string')) throw new Error('参考图片删除返回内容无效。');
  return data.paths;
};
