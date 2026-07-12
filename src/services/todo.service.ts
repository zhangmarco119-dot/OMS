import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../types/database';

type Client = SupabaseClient<Database>;

export interface TodoSummary {
  count: number;
  noticeAcknowledgements: number;
  productFeedback: number;
  tasks: number;
}

export const loadTodoSummary = async (client: Client, input: { isAdmin: boolean; profileId: string; storeId?: string }): Promise<TodoSummary> => {
  if (input.isAdmin) {
    const [tasks, feedback] = await Promise.all([
      client.from('v2_tasks').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'resubmitted']),
      client.from('product_feedback').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    ]);
    if (tasks.error) throw new Error(tasks.error.message);
    if (feedback.error) throw new Error(feedback.error.message);
    const taskCount = tasks.count ?? 0; const feedbackCount = feedback.count ?? 0;
    return { count: taskCount + feedbackCount, noticeAcknowledgements: 0, productFeedback: feedbackCount, tasks: taskCount };
  }
  if (!input.storeId) return { count: 0, noticeAcknowledgements: 0, productFeedback: 0, tasks: 0 };
  const [tasks, acknowledgements] = await Promise.all([
    client.from('v2_tasks').select('id', { count: 'exact', head: true }).eq('store_id', input.storeId).in('status', ['pending', 'in_progress', 'rejected', 'overdue']),
    client.from('v2_notice_recipients').select('notice_id, v2_notices!inner(requires_acknowledgment,status,expires_at)', { count: 'exact' }).eq('profile_id', input.profileId).is('acknowledged_at', null).eq('v2_notices.requires_acknowledgment', true).eq('v2_notices.status', 'published'),
  ]);
  if (tasks.error) throw new Error(tasks.error.message);
  if (acknowledgements.error) throw new Error(acknowledgements.error.message);
  const taskCount = tasks.count ?? 0;
  const acknowledgementCount = (acknowledgements.data ?? []).filter((row) => {
    const notice = row.v2_notices as unknown as { expires_at: string | null } | null;
    return !notice?.expires_at || new Date(notice.expires_at).getTime() > Date.now();
  }).length;
  return { count: taskCount + acknowledgementCount, noticeAcknowledgements: acknowledgementCount, productFeedback: 0, tasks: taskCount };
};
