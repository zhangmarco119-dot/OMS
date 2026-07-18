import type { SupabaseClient } from '@supabase/supabase-js';

import { compressArrivalImage } from './arrival-images.service';
import { createUuid } from '../lib/uuid';
import type { Database, Json } from '../types/database';

type Client = SupabaseClient<Database>;
export type V2TaskRow = Database['public']['Tables']['v2_tasks']['Row'];
export type V2TaskAnswerRow = Database['public']['Tables']['v2_task_answers']['Row'];
export type V2TaskReviewRow = Database['public']['Tables']['v2_task_reviews']['Row'];
export type V2TaskImageRow = Database['public']['Tables']['v2_task_images']['Row'];
export type V2TaskScheduleRow = Database['public']['Tables']['v2_task_schedules']['Row'];
export type V2TaskReleaseType = 'interval_days' | 'weekly' | 'monthly';
export type V2TaskAcceptanceType = 'daily' | 'weekly' | 'monthly';
export interface V2TaskScheduleFields {
  acceptanceIntervalDays: number | null;
  acceptanceMonthDay: number | null;
  acceptanceTime: string;
  acceptanceType: V2TaskAcceptanceType;
  acceptanceWeekday: number | null;
  intervalDays: number | null;
  monthDay: number | null;
  publishTime: string;
  scheduleType: V2TaskReleaseType;
  weekdays: number[];
}
export type V2TaskRecipient = Pick<Database['public']['Tables']['profiles']['Row'], 'display_name' | 'id' | 'role' | 'store_id' | 'username'>;
export interface TaskItemSnapshot { field_type: string; guidance?: string; id: string; image_requirement?: string; is_required?: boolean; label: string; options?: Json; reference_image_path?: string | null; reference_image_paths?: string[]; sort_order?: number }
export interface V2TaskDetail { answers: V2TaskAnswerRow[]; images: V2TaskImageRow[]; reviews: V2TaskReviewRow[]; task: V2TaskRow }
export interface UploadedV2TaskImage { image: V2TaskImageRow; previewUrl: string }
export interface V2TaskAnswerPosition { groupNumber: number; groupTitle: string; itemNumber: number; number: string }
export type V2TaskItemDecision = { decision: 'approved' | 'rejected'; itemId: string };

const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message); };
export const asTaskItemSnapshot = (value: Json): TaskItemSnapshot => value as unknown as TaskItemSnapshot;

const asRecord = (value: Json): Record<string, Json | undefined> | null => value !== null && !Array.isArray(value) && typeof value === 'object'
  ? value as Record<string, Json | undefined>
  : null;

export const getV2TaskAnswerPositions = (snapshot: Json): Record<string, V2TaskAnswerPosition> => {
  const root = asRecord(snapshot);
  const groups = Array.isArray(root?.groups) ? root.groups : [];
  const orderedGroups = groups
    .map((value, index) => ({ index, value: asRecord(value) }))
    .filter((entry): entry is { index: number; value: Record<string, Json | undefined> } => entry.value !== null)
    .sort((left, right) => Number(left.value.sort_order ?? left.index) - Number(right.value.sort_order ?? right.index));
  const positions: Record<string, V2TaskAnswerPosition> = {};
  orderedGroups.forEach((groupEntry, groupIndex) => {
    const items = Array.isArray(groupEntry.value.items) ? groupEntry.value.items : [];
    const orderedItems = items
      .map((value, index) => ({ index, value: asRecord(value) }))
      .filter((entry): entry is { index: number; value: Record<string, Json | undefined> } => entry.value !== null)
      .sort((left, right) => Number(left.value.sort_order ?? left.index) - Number(right.value.sort_order ?? right.index));
    orderedItems.forEach((itemEntry, itemIndex) => {
      const itemId = typeof itemEntry.value.id === 'string' ? itemEntry.value.id : '';
      if (!itemId) return;
      positions[itemId] = {
        groupNumber: groupIndex + 1,
        groupTitle: typeof groupEntry.value.title === 'string' ? groupEntry.value.title : `分组 ${groupIndex + 1}`,
        itemNumber: itemIndex + 1,
        number: `${groupIndex + 1}.${itemIndex + 1}`,
      };
    });
  });
  return positions;
};

export const orderV2TaskAnswers = (snapshot: Json, answers: V2TaskAnswerRow[]) => {
  const positions = getV2TaskAnswerPositions(snapshot);
  return [...answers].sort((left, right) => {
    const leftPosition = positions[left.item_id];
    const rightPosition = positions[right.item_id];
    if (!leftPosition && !rightPosition) return left.id.localeCompare(right.id);
    if (!leftPosition) return 1;
    if (!rightPosition) return -1;
    return leftPosition.groupNumber - rightPosition.groupNumber || leftPosition.itemNumber - rightPosition.itemNumber;
  });
};

export const loadV2Tasks = async (client: Client, storeId?: string) => {
  let query = client.from('v2_tasks').select('*').neq('status', 'cancelled').order('due_at', { ascending: true });
  if (storeId) query = query.eq('store_id', storeId);
  const { data, error } = await query; fail(error); return data ?? [];
};
export const loadV2TaskDetail = async (client: Client, taskId: string): Promise<V2TaskDetail> => {
  const [task, answers, images, reviews] = await Promise.all([
    client.from('v2_tasks').select('*').eq('id', taskId).single(),
    client.from('v2_task_answers').select('*').eq('task_id', taskId).order('id'),
    client.from('v2_task_images').select('*').eq('task_id', taskId).order('created_at'),
    client.from('v2_task_reviews').select('*').eq('task_id', taskId).order('created_at'),
  ]); fail(task.error); fail(answers.error); fail(images.error); fail(reviews.error);
  if (!task.data) throw new Error('任务不存在或无权查看。');
  return { answers: orderV2TaskAnswers(task.data.snapshot, answers.data ?? []), images: images.data ?? [], reviews: reviews.data ?? [], task: task.data };
};
export const publishV2Tasks = async (client: Client, templateId: string, storeIds: string[], dueAt: string | null, profileIds: string[] = []) => {
  const { data, error } = await client.rpc('publish_v2_tasks', { p_due_at: dueAt, p_profile_ids: profileIds, p_store_ids: storeIds, p_template_id: templateId }); fail(error); return data ?? [];
};
export const loadV2TaskRecipients = async (client: Client): Promise<V2TaskRecipient[]> => {
  const { data, error } = await client.from('profiles').select('id,username,display_name,role,store_id').in('role', ['staff', 'manager']).eq('is_active', true).is('deleted_at', null).order('display_name');
  fail(error);
  return data ?? [];
};
export const loadV2TaskSchedules = async (client: Client) => {
  const { data, error } = await client.from('v2_task_schedules').select('*').order('next_due_at'); fail(error); return data ?? [];
};
export const createV2TaskSchedule = async (client: Client, input: V2TaskScheduleFields & { profileIds?: string[]; storeIds: string[]; templateId: string }) => {
  const { data, error } = await client.rpc('create_v2_task_schedule_v2', {
    p_fields: {
      acceptanceIntervalDays: input.acceptanceIntervalDays,
      acceptanceMonthDay: input.acceptanceMonthDay,
      acceptanceTime: input.acceptanceTime,
      acceptanceType: input.acceptanceType,
      acceptanceWeekday: input.acceptanceWeekday,
      intervalDays: input.intervalDays,
      monthDay: input.monthDay,
      publishTime: input.publishTime,
      scheduleType: input.scheduleType,
      weekdays: input.weekdays,
    },
    p_profile_ids: input.profileIds ?? [],
    p_store_ids: input.storeIds,
    p_template_id: input.templateId,
  });
  fail(error);
  return data ?? [];
};
export const updateV2TaskSchedule = async (client: Client, scheduleId: string, fields: V2TaskScheduleFields) => {
  const { data, error } = await client.rpc('update_v2_task_schedule_v2', { p_fields: fields as unknown as Json, p_schedule_id: scheduleId });
  fail(error);
  return data;
};
export const withdrawV2TaskScheduleCurrent = async (client: Client, scheduleId: string) => {
  const { data, error } = await client.rpc('withdraw_v2_task_schedule_current', { p_schedule_id: scheduleId });
  fail(error);
  return data;
};
export const pauseV2TaskSchedule = async (client: Client, scheduleId: string) => {
  const { data, error } = await client.rpc('pause_v2_task_schedule', { p_schedule_id: scheduleId }); fail(error); return data;
};
export const resumeV2TaskSchedule = async (client: Client, scheduleId: string) => {
  const { data, error } = await client.rpc('resume_v2_task_schedule', { p_schedule_id: scheduleId }); fail(error); return data;
};
export const loadV2TaskImageUrls = async (client: Client, images: V2TaskImageRow[]) => {
  const results = await Promise.all(images.map(async (image) => {
    const { data, error } = await client.storage.from(image.bucket).createSignedUrl(image.object_path, 60 * 60);
    return error || !data?.signedUrl ? null : [image.id, data.signedUrl] as const;
  }));
  return Object.fromEntries(results.filter((entry): entry is readonly [string, string] => entry !== null));
};
export const loadV2TaskReferenceImageUrls = async (client: Client, answers: V2TaskAnswerRow[]) => {
  const taskId = answers[0]?.task_id;
  if (!taskId) return {};
  const { data, error } = await client.functions.invoke('task-template-images', { body: { action: 'task-references', taskId } });
  if (error || !data || typeof data !== 'object' || !('urls' in data) || typeof data.urls !== 'object' || data.urls === null) return {};
  return Object.fromEntries(Object.entries(data.urls)
    .map(([itemId, urls]) => [itemId, Array.isArray(urls) ? urls.filter((url): url is string => typeof url === 'string') : typeof urls === 'string' ? [urls] : []] as const)
    .filter((entry) => entry[1].length > 0)) as Record<string, string[]>;
};
export const saveV2TaskProgress = async (client: Client, taskId: string, version: number, answers: V2TaskAnswerRow[]) => {
  const { data, error } = await client.rpc('save_v2_task_progress', { p_answers: answers.map((a) => ({ answer: a.answer, is_issue: a.is_issue, item_id: a.item_id, note: a.note })), p_expected_version: version, p_task_id: taskId }); fail(error); return data as unknown as V2TaskRow;
};
export const submitV2Task = async (client: Client, taskId: string, version: number) => {
  const { data, error } = await client.rpc('submit_v2_task', { p_expected_version: version, p_key: createUuid(), p_task_id: taskId }); fail(error); return data;
};
export const reviewV2Task = async (client: Client, taskId: string, action: 'approved' | 'rejected', note: string, correctionIds: string[]) => {
  const { data, error } = await client.rpc('review_v2_task', { p_action: action, p_correction_item_ids: correctionIds, p_note: note, p_task_id: taskId }); fail(error); return data;
};
export const reviewV2TaskItems = async (client: Client, taskId: string, decisions: V2TaskItemDecision[], note: string) => {
  const { data, error } = await client.rpc('review_v2_task_items', {
    p_decisions: decisions.map((decision) => ({ decision: decision.decision, item_id: decision.itemId })),
    p_note: note,
    p_task_id: taskId,
  });
  fail(error);
  return data;
};
export const withdrawV2Task = async (client: Client, taskId: string) => {
  const { data, error } = await client.rpc('withdraw_v2_task', { p_task_id: taskId }); fail(error); return data;
};

export const uploadV2TaskImage = async (client: Client, task: V2TaskRow, itemId: string, profileId: string, file: File) => {
  const processed = await compressArrivalImage(file); const id = createUuid(); const ext = processed.mimeType === 'image/png' ? 'png' : processed.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${task.store_id}/${task.id}/${itemId}/${id}.${ext}`; const bucket = 'v2-task-images';
  const uploaded = await client.storage.from(bucket).upload(path, processed.blob, { contentType: processed.mimeType }); fail(uploaded.error);
  const metadata = await client.from('v2_task_images').insert({ file_name: file.name || `${id}.${ext}`, item_id: itemId, mime_type: processed.mimeType, object_path: path, size_bytes: processed.blob.size, store_id: task.store_id, task_id: task.id, uploaded_by: profileId }).select('*').single();
  if (metadata.error) { await client.storage.from(bucket).remove([path]); throw new Error(metadata.error.message); }
  if (!metadata.data) { await client.storage.from(bucket).remove([path]); throw new Error('图片记录保存失败'); }
  return metadata.data;
};

export const deleteV2TaskImage = async (client: Client, image: V2TaskImageRow) => {
  const metadata = await client.from('v2_task_images').delete().eq('id', image.id);
  fail(metadata.error);
  const storage = await client.storage.from(image.bucket).remove([image.object_path]);
  return { storageCleanupFailed: Boolean(storage.error) };
};
