import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../types/database';
import type { TaskType } from '../../types/domain';
import { loadTaskWithItems } from '../tasks/taskService';

type Client = SupabaseClient<Database>;
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type TaskRow = Database['public']['Tables']['tasks']['Row'];

export interface HistoryTask {
  task: TaskRow;
  itemCount: number;
  storeName: string;
  storeShortName: string;
  submitterName: string;
  submitterUsername: string;
}

export const loadSubmittedTasks = async (
  client: Client,
  profile: ProfileRow,
  taskType?: TaskType | 'all',
  limit?: number,
): Promise<HistoryTask[]> => {
  let query = client
    .from('tasks')
    .select('*')
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false });

  if (profile.role === 'staff') {
    query = query.eq('created_by', profile.id);
  } else if (profile.role === 'manager') {
    query = query.eq('store_id', profile.store_id);
  }

  if (taskType && taskType !== 'all') {
    query = query.eq('task_type', taskType);
  }

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    return [];
  }

  const [counts, storesResult, profilesResult] = await Promise.all([
    Promise.all(data.map(async (task) => {
      const { count, error: countError } = await client
        .from('task_items')
        .select('id', { count: 'exact', head: true })
        .eq('task_id', task.id);

      if (countError) {
        throw new Error(countError.message);
      }

      return [task.id, count ?? 0] as const;
    })),
    client
      .from('stores')
      .select('*')
      .in('id', Array.from(new Set(data.map((task) => task.store_id)))),
    client
      .from('profiles')
      .select('*')
      .in('id', Array.from(new Set(data.map((task) => task.created_by)))),
  ]);

  if (storesResult.error) {
    throw new Error(storesResult.error.message);
  }
  if (profilesResult.error) {
    throw new Error(profilesResult.error.message);
  }

  const countByTaskId = new Map(counts);
  const storeById = new Map((storesResult.data ?? []).map((store) => [store.id, store]));
  const profileById = new Map((profilesResult.data ?? []).map((submitter) => [submitter.id, submitter]));

  return data.map((task) => ({
    task,
    itemCount: countByTaskId.get(task.id) ?? 0,
    storeName: storeById.get(task.store_id)?.name ?? '未知门店',
    storeShortName: storeById.get(task.store_id)?.short_name ?? '门店',
    submitterName: profileById.get(task.created_by)?.display_name ?? '未知提交人',
    submitterUsername: profileById.get(task.created_by)?.username ?? '',
  }));
};

export const loadUnreadSubmittedTasks = async (
  client: Client,
  profile: ProfileRow,
  limit?: number,
) => {
  const [{ data: reads, error: readsError }, submitted] = await Promise.all([
    client
      .from('admin_task_reads')
      .select('*')
      .eq('admin_profile_id', profile.id),
    loadSubmittedTasks(client, profile, 'all'),
  ]);

  if (readsError) {
    throw new Error(readsError.message);
  }

  return filterUnreadSubmittedTasks(submitted, (reads ?? []).map((read) => read.task_id), limit);
};

export const filterUnreadSubmittedTasks = (
  submitted: HistoryTask[],
  readTaskIds: string[],
  limit?: number,
) => {
  const readIds = new Set(readTaskIds);
  const unread = submitted.filter((item) => !readIds.has(item.task.id));
  return typeof limit === 'number' ? unread.slice(0, limit) : unread;
};

export const markSubmittedTasksRead = async (
  client: Client,
  profileId: string,
  taskIds: string[],
) => {
  if (taskIds.length === 0) {
    return;
  }

  const { error } = await client
    .from('admin_task_reads')
    .upsert(taskIds.map((taskId) => ({ admin_profile_id: profileId, task_id: taskId })), {
      onConflict: 'admin_profile_id,task_id',
    });

  if (error) {
    throw new Error(error.message);
  }
};

export const loadSubmittedTaskDetail = async (client: Client, taskId: string) => {
  const result = await loadTaskWithItems(client, taskId);
  if (result.task.status !== 'submitted') {
    throw new Error('只能查看已提交单据。');
  }
  return result;
};

export const loadSubmittedTaskForExport = loadSubmittedTaskDetail;
