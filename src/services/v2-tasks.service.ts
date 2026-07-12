import type { SupabaseClient } from '@supabase/supabase-js';

import { compressArrivalImage } from './arrival-images.service';
import { createUuid } from '../lib/uuid';
import type { Database, Json } from '../types/database';

type Client = SupabaseClient<Database>;
export type V2TaskRow = Database['public']['Tables']['v2_tasks']['Row'];
export type V2TaskAnswerRow = Database['public']['Tables']['v2_task_answers']['Row'];
export type V2TaskReviewRow = Database['public']['Tables']['v2_task_reviews']['Row'];
export interface TaskItemSnapshot { field_type: string; guidance?: string; id: string; image_requirement?: string; is_required?: boolean; label: string; options?: Json }
export interface V2TaskDetail { answers: V2TaskAnswerRow[]; images: Database['public']['Tables']['v2_task_images']['Row'][]; reviews: V2TaskReviewRow[]; task: V2TaskRow }

const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message); };
export const asTaskItemSnapshot = (value: Json): TaskItemSnapshot => value as unknown as TaskItemSnapshot;

export const loadV2Tasks = async (client: Client, storeId?: string) => {
  let query = client.from('v2_tasks').select('*').order('due_at', { ascending: true });
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
  return { answers: answers.data ?? [], images: images.data ?? [], reviews: reviews.data ?? [], task: task.data };
};
export const publishV2Tasks = async (client: Client, templateId: string, storeIds: string[], dueAt: string) => {
  const { data, error } = await client.rpc('publish_v2_tasks', { p_due_at: dueAt, p_store_ids: storeIds, p_template_id: templateId }); fail(error); return data ?? [];
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

export const uploadV2TaskImage = async (client: Client, task: V2TaskRow, itemId: string, profileId: string, file: File) => {
  const processed = await compressArrivalImage(file); const id = createUuid(); const ext = processed.mimeType === 'image/png' ? 'png' : processed.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${task.store_id}/${task.id}/${itemId}/${id}.${ext}`; const bucket = 'v2-task-images';
  const uploaded = await client.storage.from(bucket).upload(path, processed.blob, { contentType: processed.mimeType }); fail(uploaded.error);
  const metadata = await client.from('v2_task_images').insert({ file_name: file.name || `${id}.${ext}`, item_id: itemId, mime_type: processed.mimeType, object_path: path, size_bytes: processed.blob.size, store_id: task.store_id, task_id: task.id, uploaded_by: profileId }).select('*').single();
  if (metadata.error) { await client.storage.from(bucket).remove([path]); throw new Error(metadata.error.message); }
  return metadata.data;
};
