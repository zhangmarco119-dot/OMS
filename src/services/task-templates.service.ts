import type { SupabaseClient } from '@supabase/supabase-js';

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

const getReferenceImageUrl = async (client: Client, templateId: string, path: string | null) => {
  if (!path) return null;
  const { data, error } = await client.functions.invoke('task-template-images', { body: { action: 'sign', path, scope: 'template', templateId } });
  if (error || !data || typeof data !== 'object' || !('signedUrl' in data) || typeof data.signedUrl !== 'string') return null;
  return data.signedUrl;
};

const referencePaths = (item: TaskTemplateItemRow) => item.reference_image_paths.length > 0
  ? item.reference_image_paths
  : item.reference_image_path ? [item.reference_image_path] : [];

const groupsToDraft = async (client: Client, groups: TaskTemplateGroupRow[], items: TaskTemplateItemRow[]): Promise<TaskTemplateGroupDraft[]> =>
  Promise.all(groups.map(async (group) => ({
    description: group.description,
    id: group.id,
    items: await Promise.all(items.filter((item) => item.group_id === group.id).map(async (item) => {
      const paths = referencePaths(item);
      const urls = await Promise.all(paths.map((path) => getReferenceImageUrl(client, item.template_id, path)));
      return {
        fieldType: item.field_type,
        guidance: item.guidance,
        id: item.id,
        imageRequirement: item.image_requirement,
        isRequired: item.is_required,
        label: item.label,
        optionsText: Array.isArray(item.options) ? item.options.filter((entry): entry is string => typeof entry === 'string').join('\n') : '',
        referenceImagePath: paths[0] ?? null,
        referenceImageUrl: urls[0] ?? null,
        referenceImagePaths: paths,
        referenceImageUrls: urls.filter((url): url is string => url !== null),
      };
    })),
    title: group.title,
  })));

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
    dueTime: template.due_time?.slice(0, 5) ?? '',
    groups: await groupsToDraft(client, groups.data ?? [], items.data ?? []),
    id: template.id,
    name: template.name,
    recurrence: template.recurrence,
    recurrenceDay: template.recurrence_day,
    requiresReview: template.requires_review,
    storeIds: template.storeIds,
  };
};

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
    options: item.optionsText.split('\n').map((option) => option.trim()).filter(Boolean),
    reference_image_path: item.referenceImagePaths[0] ?? item.referenceImagePath,
    reference_image_paths: item.referenceImagePaths,
    sort_order: itemIndex,
  })),
  sort_order: groupIndex,
  title: group.title,
}));

export const saveTaskTemplate = async (client: Client, input: TaskTemplateDraft): Promise<SavedTaskTemplate> => {
  const draft = validateTaskTemplateDraft(input);
  const rpcInput = {
    p_fields: {
      allow_overdue: draft.allowOverdue,
      category: draft.category,
      description: draft.description,
      due_time: draft.dueTime || null,
      name: draft.name,
      recurrence: draft.recurrence,
      recurrence_day: draft.recurrenceDay,
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
  return data as unknown as SavedTaskTemplate;
};

export const publishTaskTemplate = async (client: Client, templateId: string) => {
  const { data, error } = await client.rpc('publish_v2_task_template', { p_template_id: templateId });
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

export const uploadTaskTemplateReferenceImage = async (client: Client, templateId: string, itemId: string, file: File) => {
  const processed = await compressArrivalImage(file);
  const body = new FormData();
  body.append('action', 'upload');
  body.append('templateId', templateId);
  body.append('itemId', itemId);
  body.append('file', processed.blob, file.name || `${createUuid()}.jpg`);
  const { data, error } = await client.functions.invoke('task-template-images', { body });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || !('path' in data) || !('signedUrl' in data) || typeof data.path !== 'string' || typeof data.signedUrl !== 'string') throw new Error('参考图片上传返回内容无效。');
  return { path: data.path, previewUrl: data.signedUrl };
};

export const deleteTaskTemplateReferenceImage = async (client: Client, templateId: string, itemId: string, path: string) => {
  const { data, error } = await client.functions.invoke('task-template-images', { body: { action: 'delete', itemId, path, templateId } });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || !('paths' in data) || !Array.isArray(data.paths) || !data.paths.every((entry: unknown) => typeof entry === 'string')) throw new Error('参考图片删除返回内容无效。');
  return data.paths;
};
