import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../types/database';

type Client = SupabaseClient<Database>;

export interface TodoSummary {
  count: number;
  noticeAcknowledgements: number;
  productFeedback: number;
  tasks: number;
  overtime: number;
  attendanceCorrections: number;
  payrollPayslips: number;
}

export const loadTodoSummary = async (client: Client, input: { isAdmin: boolean; isManager?: boolean; profileId: string; storeId?: string; storeIds?: string[] }): Promise<TodoSummary> => {
  if (input.isAdmin) {
    const [tasks, feedback, overtime] = await Promise.all([
      client.from('v2_tasks').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'resubmitted']),
      client.from('product_feedback').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      client.rpc('payroll_overtime_todo_count'),
    ]);
    if (tasks.error) throw new Error(tasks.error.message);
    if (feedback.error) throw new Error(feedback.error.message);
    if (overtime.error) throw new Error(overtime.error.message);
    const taskCount = tasks.count ?? 0; const feedbackCount = feedback.count ?? 0; const overtimeCount = overtime.data ?? 0;
    return { count: taskCount + feedbackCount + overtimeCount, noticeAcknowledgements: 0, productFeedback: feedbackCount, tasks: taskCount, overtime: overtimeCount, attendanceCorrections: 0, payrollPayslips: 0 };
  }
  const [tasks, managerReviews, acknowledgements, overtime, corrections, payslips] = await Promise.all([
    input.storeId ? client.from('v2_tasks').select('id', { count: 'exact', head: true }).eq('store_id', input.storeId).in('status', ['pending', 'in_progress', 'rejected', 'overdue']) : Promise.resolve({ count: 0, error: null }),
    input.isManager ? client.from('v2_tasks').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'resubmitted']).eq('manager_review_enabled', true).eq('submitted_by_role', 'staff') : Promise.resolve({ count: 0, error: null }),
    client.from('v2_notice_recipients').select('notice_id, v2_notices!inner(requires_acknowledgment,status,expires_at)', { count: 'exact' }).eq('profile_id', input.profileId).is('acknowledged_at', null).eq('v2_notices.requires_acknowledgment', true).eq('v2_notices.status', 'published'),
    input.isManager ? client.rpc('payroll_overtime_todo_count') : Promise.resolve({ data: 0, error: null }),
    client.from('attendance_missing_punch_todos').select('id', { count: 'exact', head: true }).eq('profile_id', input.profileId).eq('status', 'pending'),
    client.from('payroll_payslips').select('id', { count: 'exact', head: true }).eq('profile_id', input.profileId).eq('status', 'issued'),
  ]);
  if (tasks.error) throw new Error(tasks.error.message);
  if (managerReviews.error) throw new Error(managerReviews.error.message);
  if (acknowledgements.error) throw new Error(acknowledgements.error.message);
  if (overtime.error) throw new Error(overtime.error.message);
  if (corrections.error) throw new Error(corrections.error.message);
  if (payslips.error) throw new Error(payslips.error.message);
  const taskCount = (tasks.count ?? 0) + (managerReviews.count ?? 0);
  const acknowledgementCount = (acknowledgements.data ?? []).filter((row) => {
    const notice = row.v2_notices as unknown as { expires_at: string | null } | null;
    return !notice?.expires_at || new Date(notice.expires_at).getTime() > Date.now();
  }).length;
  const overtimeCount = overtime.data ?? 0;
  const correctionCount = corrections.count ?? 0;
  const payslipCount = payslips.count ?? 0;
  return { count: taskCount + acknowledgementCount + overtimeCount + correctionCount + payslipCount, noticeAcknowledgements: acknowledgementCount, productFeedback: 0, tasks: taskCount, overtime: overtimeCount, attendanceCorrections: correctionCount, payrollPayslips: payslipCount };
};

export const loadMyPayrollPayslipTodos = async (client: Client, profileId: string) => {
  const { data, error } = await client.from('payroll_payslips').select('*').eq('profile_id', profileId).eq('status', 'issued').order('payroll_month', { ascending: false });
  if (error) throw new Error(error.message || '暂时无法加载工资单确认待办。');
  return data ?? [];
};

export const loadMyAttendanceCorrectionTodos = async (client: Client, profileId: string) => {
  const { data, error } = await client.from('attendance_missing_punch_todos').select('*').eq('profile_id', profileId).eq('status', 'pending').order('attendance_date');
  if (error) throw new Error(error.message || '暂时无法加载补卡提醒。');
  return data ?? [];
};

export const completeAttendanceCorrectionTodo = async (client: Client, id: string) => {
  const { error } = await client.rpc('complete_attendance_missing_punch_todo', { p_todo_id: id });
  if (error) throw new Error(error.message || '补卡提醒暂时无法完成。');
};
