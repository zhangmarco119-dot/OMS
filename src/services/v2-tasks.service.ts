import type { SupabaseClient } from '@supabase/supabase-js';

import { compressArrivalImage } from './arrival-images.service';
import {
  invalidateStorageImage,
  loadSignedImageResource,
  loadStorageImageResource,
  primeImageResource,
  storageImageCacheKey,
} from '../lib/imageResourceCache';
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
  managerReviewEnabled: boolean;
  nextPublishAt: string;
  publishTime: string;
  scheduleType: V2TaskReleaseType;
  weekdays: number[];
}
export interface V2TaskScheduleContent { name: string; snapshot: Json }
export type TaskAudience = 'staff' | 'manager' | 'part_time';
export type V2TaskCompletionMode = 'shared' | 'single' | 'individual';
export type V2TaskRelatedContentType = 'sop' | 'notice';
export interface V2TaskRelatedContentSelection {
  id: string;
  type: V2TaskRelatedContentType;
}
export interface V2TaskRelatedContentOption extends V2TaskRelatedContentSelection {
  publishedAt: string;
  roles: ('staff' | 'manager')[];
  storeIds: string[];
  subtitle: string;
  title: string;
}
export type V2TaskRecipient = Pick<Database['public']['Tables']['profiles']['Row'], 'display_name' | 'employment_type' | 'id' | 'role' | 'store_id' | 'username'>;
export interface TaskItemSnapshot { field_type: string; guidance?: string; id: string; image_requirement?: string; is_required?: boolean; label: string; minimum_image_count?: number | null; options?: Json; reference_image_path?: string | null; reference_image_paths?: string[]; sort_order?: number }
export interface V2TaskDetail { answers: V2TaskAnswerRow[]; images: V2TaskImageRow[]; reviews: V2TaskReviewRow[]; submitterName?: string | null; task: V2TaskRow }
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
  let submitterName: string | null = null;
  const submitterId = task.data.submitted_by ?? task.data.started_by;
  if (submitterId) {
    const submitter = await client.from('profiles').select('display_name').eq('id', submitterId).maybeSingle();
    fail(submitter.error);
    submitterName = submitter.data?.display_name ?? null;
  }
  return { answers: orderV2TaskAnswers(task.data.snapshot, answers.data ?? []), images: images.data ?? [], reviews: reviews.data ?? [], submitterName, task: task.data };
};
export const canReviewV2Task = async (client: Client, taskId: string) => {
  const { data, error } = await client.rpc('can_review_v2_task', { p_task_id: taskId });
  fail(error);
  return Boolean(data);
};
export const publishV2Tasks = async (client: Client, templateId: string, storeIds: string[], dueAt: string, publishAt: string, profileIds: string[] = [], targetAudiences: TaskAudience[] = ['staff', 'manager'], managerReviewEnabled = false, relatedContent: V2TaskRelatedContentSelection | null = null) => {
  const { data, error } = await client.rpc('publish_v2_tasks_v3', {
    p_due_at: dueAt,
    p_manager_review_enabled: managerReviewEnabled,
    p_profile_ids: profileIds,
    p_publish_at: publishAt,
    p_related_notice_id: relatedContent?.type === 'notice' ? relatedContent.id : null,
    p_related_sop_id: relatedContent?.type === 'sop' ? relatedContent.id : null,
    p_store_ids: storeIds,
    p_target_audiences: targetAudiences,
    p_template_id: templateId,
  }); fail(error); return data ?? [];
};
export const loadV2TaskRecipients = async (client: Client): Promise<V2TaskRecipient[]> => {
  const { data, error } = await client.from('profiles').select('id,username,display_name,employment_type,role,store_id').in('role', ['staff', 'manager']).eq('is_active', true).is('deleted_at', null).order('display_name');
  fail(error);
  return data ?? [];
};
export const loadV2TaskRelatedContentOptions = async (client: Client): Promise<V2TaskRelatedContentOption[]> => {
  const now = new Date().toISOString();
  const [sops, sopStores, sopRoles, notices, noticeStores] = await Promise.all([
    client.from('v2_sops').select('id,title,category,effective_at,published_at').eq('status', 'published').lte('effective_at', now).order('published_at', { ascending: false }),
    client.from('v2_sop_stores').select('sop_id,store_id'),
    client.from('v2_sop_roles').select('sop_id,role'),
    client.from('v2_notices').select('id,title,expires_at,published_at').eq('status', 'published').or(`expires_at.is.null,expires_at.gt.${now}`).order('published_at', { ascending: false }),
    client.from('v2_notice_stores').select('notice_id,store_id'),
  ]);
  [sops.error, sopStores.error, sopRoles.error, notices.error, noticeStores.error].forEach(fail);
  const sopStoreMap = new Map<string, string[]>();
  const sopRoleMap = new Map<string, ('staff' | 'manager')[]>();
  const noticeStoreMap = new Map<string, string[]>();
  (sopStores.data ?? []).forEach((row) => sopStoreMap.set(row.sop_id, [...(sopStoreMap.get(row.sop_id) ?? []), row.store_id]));
  (sopRoles.data ?? []).forEach((row) => sopRoleMap.set(row.sop_id, [...(sopRoleMap.get(row.sop_id) ?? []), row.role]));
  (noticeStores.data ?? []).forEach((row) => noticeStoreMap.set(row.notice_id, [...(noticeStoreMap.get(row.notice_id) ?? []), row.store_id]));
  return [
    ...(sops.data ?? []).map((row) => ({
      id: row.id,
      publishedAt: row.published_at ?? row.effective_at ?? '',
      roles: sopRoleMap.get(row.id) ?? [],
      storeIds: sopStoreMap.get(row.id) ?? [],
      subtitle: row.category || '标准作业流程',
      title: row.title,
      type: 'sop' as const,
    })),
    ...(notices.data ?? []).map((row) => ({
      id: row.id,
      publishedAt: row.published_at ?? '',
      roles: ['staff', 'manager'] as ('staff' | 'manager')[],
      storeIds: noticeStoreMap.get(row.id) ?? [],
      subtitle: '公告',
      title: row.title,
      type: 'notice' as const,
    })),
  ];
};
export const loadV2TaskSchedules = async (client: Client) => {
  const { data, error } = await client.from('v2_task_schedules').select('*').is('withdrawn_at', null).order('next_due_at'); fail(error); return data ?? [];
};
export const createV2TaskSchedule = async (client: Client, input: V2TaskScheduleFields & { profileIds?: string[]; publishImmediately?: boolean; relatedContent?: V2TaskRelatedContentSelection | null; storeIds: string[]; targetAudiences?: TaskAudience[]; templateId: string }) => {
  const { data, error } = await client.rpc('create_v2_task_schedule_v3', {
    p_fields: {
      acceptanceIntervalDays: input.acceptanceIntervalDays,
      acceptanceMonthDay: input.acceptanceMonthDay,
      acceptanceTime: input.acceptanceTime,
      acceptanceType: input.acceptanceType,
      acceptanceWeekday: input.acceptanceWeekday,
      intervalDays: input.intervalDays,
      managerReviewEnabled: input.managerReviewEnabled,
      monthDay: input.monthDay,
      nextPublishAt: input.nextPublishAt,
      publishImmediately: input.publishImmediately ?? false,
      publishTime: input.publishTime,
      scheduleType: input.scheduleType,
      targetAudiences: input.targetAudiences ?? ['staff', 'manager'],
      weekdays: input.weekdays,
    },
    p_profile_ids: input.profileIds ?? [],
    p_related_notice_id: input.relatedContent?.type === 'notice' ? input.relatedContent.id : null,
    p_related_sop_id: input.relatedContent?.type === 'sop' ? input.relatedContent.id : null,
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
export const loadV2TaskScheduleContent = async (client: Client, scheduleId: string): Promise<V2TaskScheduleContent> => {
  const { data, error } = await client.rpc('get_v2_task_schedule_content', { p_schedule_id: scheduleId });
  fail(error);
  const value = data as unknown as { name?: unknown; snapshot?: unknown } | null;
  if (!value || typeof value.name !== 'string' || value.snapshot === undefined) throw new Error('周期任务内容加载失败。');
  return { name: value.name, snapshot: value.snapshot as Json };
};
export const updateV2TaskContent = async (client: Client, taskId: string, name: string, snapshot: Json, dueAt: string, managerReviewEnabled = false, relatedContent: V2TaskRelatedContentSelection | null = null) => {
  const { data, error } = await client.rpc('update_v2_task_content_v3', {
    p_due_at: dueAt,
    p_manager_review_enabled: managerReviewEnabled,
    p_name: name,
    p_related_notice_id: relatedContent?.type === 'notice' ? relatedContent.id : null,
    p_related_sop_id: relatedContent?.type === 'sop' ? relatedContent.id : null,
    p_snapshot: snapshot,
    p_task_id: taskId,
  });
  fail(error);
  return data;
};
export const updateV2TaskRecipients = async (client: Client, taskId: string, mode: V2TaskCompletionMode, profileIds: string[], targetAudiences: TaskAudience[]) => {
  const { data, error } = await client.rpc('update_v2_task_recipients', {
    p_mode: mode,
    p_profile_ids: profileIds,
    p_target_audiences: targetAudiences,
    p_task_id: taskId,
  });
  fail(error);
  return data ?? [];
};
export const updateV2TaskScheduleAll = async (client: Client, scheduleId: string, fields: V2TaskScheduleFields, name: string, snapshot: Json, relatedContent: V2TaskRelatedContentSelection | null = null) => {
  const { data, error } = await client.rpc('update_v2_task_schedule_all_v2', {
    p_fields: fields as unknown as Json,
    p_name: name,
    p_related_notice_id: relatedContent?.type === 'notice' ? relatedContent.id : null,
    p_related_sop_id: relatedContent?.type === 'sop' ? relatedContent.id : null,
    p_schedule_id: scheduleId,
    p_snapshot: snapshot,
  });
  fail(error);
  return data;
};
export const withdrawV2TaskScheduleCurrent = async (client: Client, scheduleId: string) => {
  const { data, error } = await client.rpc('withdraw_v2_task_schedule_current', { p_schedule_id: scheduleId });
  fail(error);
  return data;
};
export const withdrawV2TaskSchedule = async (client: Client, scheduleId: string) => {
  const { data, error } = await client.rpc('withdraw_v2_task_schedule', { p_schedule_id: scheduleId });
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
    try {
      const url = await loadStorageImageResource(client, image.bucket, image.object_path, {
        scope: 'session',
        variant: 'task-submission',
      });
      return [image.id, url] as const;
    } catch {
      return null;
    }
  }));
  return Object.fromEntries(results.filter((entry): entry is readonly [string, string] => entry !== null));
};
export const loadV2TaskReferenceImageUrls = async (client: Client, answers: V2TaskAnswerRow[]) => {
  const taskId = answers[0]?.task_id;
  if (!taskId) return {};
  const { data, error } = await client.functions.invoke('task-template-images', { body: { action: 'task-references', taskId } });
  if (error || !data || typeof data !== 'object' || !('urls' in data) || typeof data.urls !== 'object' || data.urls === null) return {};
  const entries = await Promise.all(Object.entries(data.urls).map(async ([itemId, urls]) => {
    const sourceUrls = Array.isArray(urls)
      ? urls.filter((url): url is string => typeof url === 'string')
      : typeof urls === 'string' ? [urls] : [];
    const cachedUrls = await Promise.all(sourceUrls.map((url) => loadSignedImageResource(url, {
      scope: 'session',
      variant: 'task-reference',
    }).catch(() => url)));
    return [itemId, cachedUrls] as const;
  }));
  return Object.fromEntries(entries.filter((entry) => entry[1].length > 0)) as Record<string, string[]>;
};

export const loadV2TaskContentReferenceImageUrls = async (client: Client, snapshot: Json) => {
  const root = asRecord(snapshot);
  const groups = Array.isArray(root?.groups) ? root.groups : [];
  const entries = groups.flatMap((groupValue) => {
    const group = asRecord(groupValue);
    const items = Array.isArray(group?.items) ? group.items : [];
    return items.flatMap((itemValue) => {
      const item = asRecord(itemValue);
      const itemId = typeof item?.id === 'string' ? item.id : '';
      const plural = Array.isArray(item?.reference_image_paths) ? item.reference_image_paths.filter((path): path is string => typeof path === 'string') : [];
      const legacy = typeof item?.reference_image_path === 'string' ? [item.reference_image_path] : [];
      return itemId ? [[itemId, [...new Set([...plural, ...legacy])]] as const] : [];
    });
  });
  const result = await Promise.all(entries.map(async ([itemId, paths]) => {
    const urls = (await Promise.all(paths.map(async (path) => {
      try {
        return await loadStorageImageResource(client, 'v2-task-template-reference-images', path, {
          scope: 'session',
          variant: 'task-reference',
        });
      } catch {
        return null;
      }
    }))).filter((url): url is string => Boolean(url));
    return [itemId, urls] as const;
  }));
  return Object.fromEntries(result);
};

export const uploadV2TaskReferenceImage = async (client: Client, assetOwnerId: string, itemId: string, file: File, onProgress?: (progress: number) => void) => {
  onProgress?.(5);
  const processed = await compressArrivalImage(file);
  onProgress?.(35);
  const objectId = createUuid();
  const extension = processed.mimeType === 'image/png' ? 'png' : processed.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${assetOwnerId}/${itemId}/${objectId}.${extension}`;
  const bucket = client.storage.from('v2-task-template-reference-images');
  const { error: uploadError } = await bucket.upload(path, processed.blob, { cacheControl: '3600', contentType: processed.mimeType, upsert: false });
  fail(uploadError);
  onProgress?.(75);
  const { data, error: signError } = await bucket.createSignedUrl(path, 60 * 60);
  if (signError || !data?.signedUrl) {
    await bucket.remove([path]);
    throw new Error(signError?.message ?? '参考图片预览生成失败。');
  }
  const previewUrl = await primeImageResource(
    storageImageCacheKey('v2-task-template-reference-images', path, { variant: 'task-reference' }),
    processed.blob,
  ) ?? data.signedUrl;
  onProgress?.(100);
  return { path, previewUrl };
};

export const deleteV2TaskReferenceImages = async (client: Client, paths: string[]) => {
  const uniquePaths = [...new Set(paths)].filter(Boolean);
  if (!uniquePaths.length) return;
  const { error } = await client.storage.from('v2-task-template-reference-images').remove(uniquePaths);
  fail(error);
  uniquePaths.forEach((path) => invalidateStorageImage('v2-task-template-reference-images', path, [
    { variant: 'task-reference' },
    { variant: 'original' },
  ]));
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

export const uploadV2TaskImage = async (client: Client, task: V2TaskRow, itemId: string, profileId: string, file: File, onProgress?: (progress: number) => void) => {
  onProgress?.(5);
  const processed = await compressArrivalImage(file); onProgress?.(35); const id = createUuid(); const ext = processed.mimeType === 'image/png' ? 'png' : processed.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${task.store_id}/${task.id}/${itemId}/${id}.${ext}`; const bucket = 'v2-task-images';
  const uploaded = await client.storage.from(bucket).upload(path, processed.blob, { contentType: processed.mimeType }); fail(uploaded.error);
  onProgress?.(75);
  const metadata = await client.from('v2_task_images').insert({ file_name: file.name || `${id}.${ext}`, item_id: itemId, mime_type: processed.mimeType, object_path: path, size_bytes: processed.blob.size, store_id: task.store_id, task_id: task.id, uploaded_by: profileId }).select('*').single();
  if (metadata.error) { await client.storage.from(bucket).remove([path]); throw new Error(metadata.error.message); }
  if (!metadata.data) { await client.storage.from(bucket).remove([path]); throw new Error('图片记录保存失败'); }
  await primeImageResource(
    storageImageCacheKey(bucket, path, { variant: 'task-submission' }),
    processed.blob,
  );
  onProgress?.(100);
  return metadata.data;
};

export const deleteV2TaskImage = async (client: Client, image: V2TaskImageRow) => {
  const metadata = await client.from('v2_task_images').delete().eq('id', image.id);
  fail(metadata.error);
  const storage = await client.storage.from(image.bucket).remove([image.object_path]);
  invalidateStorageImage(image.bucket, image.object_path, [
    { variant: 'task-submission' },
    { variant: 'original' },
  ]);
  return { storageCleanupFailed: Boolean(storage.error) };
};
