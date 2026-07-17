import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../types/database';

type Client = SupabaseClient<Database>;

export interface TodoSummary {
  count: number;
  noticeAcknowledgements: number;
  productFeedback: number;
  tasks: number;
  overtime: number;
}

export const loadTodoSummary = async (client: Client, input: { isAdmin: boolean; isManager?: boolean; profileId: string; storeId?: string; storeIds?: string[] }): Promise<TodoSummary> => {
  if (input.isAdmin) {
    const [tasks, feedback] = await Promise.all([
      client.from('v2_tasks').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'resubmitted']),
      client.from('product_feedback').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    ]);
    if (tasks.error) throw new Error(tasks.error.message);
    if (feedback.error) throw new Error(feedback.error.message);
    const taskCount = tasks.count ?? 0; const feedbackCount = feedback.count ?? 0;
    return { count: taskCount + feedbackCount, noticeAcknowledgements: 0, productFeedback: feedbackCount, tasks: taskCount, overtime: 0 };
  }
  if (!input.storeId) return { count: 0, noticeAcknowledgements: 0, productFeedback: 0, tasks: 0, overtime: 0 };
  const [tasks, acknowledgements, overtime] = await Promise.all([
    client.from('v2_tasks').select('id', { count: 'exact', head: true }).eq('store_id', input.storeId).in('status', ['pending', 'in_progress', 'rejected', 'overdue']),
    client.from('v2_notice_recipients').select('notice_id, v2_notices!inner(requires_acknowledgment,status,expires_at)', { count: 'exact' }).eq('profile_id', input.profileId).is('acknowledged_at', null).eq('v2_notices.requires_acknowledgment', true).eq('v2_notices.status', 'published'),
    input.isManager && input.storeIds?.length ? client.from('payroll_overtime_requests').select('id', { count: 'exact', head: true }).in('store_id', input.storeIds).eq('status', 'pending').neq('profile_id', input.profileId) : Promise.resolve({ count: 0, error: null }),
  ]);
  if (tasks.error) throw new Error(tasks.error.message);
  if (acknowledgements.error) throw new Error(acknowledgements.error.message);
  if (overtime.error) throw new Error(overtime.error.message);
  const taskCount = tasks.count ?? 0;
  const acknowledgementCount = (acknowledgements.data ?? []).filter((row) => {
    const notice = row.v2_notices as unknown as { expires_at: string | null } | null;
    return !notice?.expires_at || new Date(notice.expires_at).getTime() > Date.now();
  }).length;
  const overtimeCount = overtime.count ?? 0;
  return { count: taskCount + acknowledgementCount + overtimeCount, noticeAcknowledgements: acknowledgementCount, productFeedback: 0, tasks: taskCount, overtime: overtimeCount };
};
