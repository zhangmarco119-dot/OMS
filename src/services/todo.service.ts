import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../types/database';

type Client = SupabaseClient<Database>;

const payrollPayslipTodoQuery = (client: Client, profileId: string, isManager: boolean, countOnly = false) => {
  const query = client.from('payroll_payslips').select(countOnly ? 'id' : '*', countOnly ? { count: 'exact', head: true } : undefined).eq('status', 'issued');
  if (isManager) return query.or(`and(confirmation_target.eq.employee,profile_id.eq.${profileId}),and(confirmation_target.eq.manager,confirmation_assignee_id.eq.${profileId})`);
  return query.eq('confirmation_target', 'employee').eq('profile_id', profileId);
};

export interface TodoSummary {
  count: number;
  managerPenalties: number;
  payrollConfirmations: number;
  noticeAcknowledgements: number;
  productCreationRequests: number;
  productFeedback: number;
  tasks: number;
  overtime: number;
  attendanceCorrections: number;
  arrivalCorrections: number;
  payrollPayslips: number;
}

export const loadTodoSummary = async (client: Client, input: { isAdmin: boolean; isManager?: boolean; profileId: string; storeId?: string; storeIds?: string[] }): Promise<TodoSummary> => {
  if (input.isAdmin) {
    const [tasks, feedback, productCreationRequests, overtime, arrivalCorrections, payrollConfirmations, managerPenalties] = await Promise.all([
      client.from('v2_tasks').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'resubmitted']),
      client.from('product_feedback').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      client.from('product_creation_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      client.rpc('payroll_overtime_todo_count'),
      client.from('arrival_report_correction_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      client.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_user_id', input.profileId).eq('type', 'payroll_payslip_confirmed').eq('is_read', false),
      client.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_role', 'admin').eq('type', 'manager_penalty_created').eq('is_read', false),
    ]);
    if (tasks.error) throw new Error(tasks.error.message);
    if (feedback.error) throw new Error(feedback.error.message);
    if (productCreationRequests.error) throw new Error(productCreationRequests.error.message);
    if (overtime.error) throw new Error(overtime.error.message);
    if (arrivalCorrections.error) throw new Error(arrivalCorrections.error.message);
    if (payrollConfirmations.error) throw new Error(payrollConfirmations.error.message);
    if (managerPenalties.error) throw new Error(managerPenalties.error.message);
    const taskCount = tasks.count ?? 0; const feedbackCount = feedback.count ?? 0; const creationRequestCount = productCreationRequests.count ?? 0; const overtimeCount = overtime.data ?? 0; const arrivalCorrectionCount = arrivalCorrections.count ?? 0; const payrollConfirmationCount = payrollConfirmations.count ?? 0; const managerPenaltyCount = managerPenalties.count ?? 0;
    return { count: taskCount + feedbackCount + creationRequestCount + overtimeCount + arrivalCorrectionCount + payrollConfirmationCount + managerPenaltyCount, managerPenalties: managerPenaltyCount, payrollConfirmations: payrollConfirmationCount, noticeAcknowledgements: 0, productCreationRequests: creationRequestCount, productFeedback: feedbackCount, tasks: taskCount, overtime: overtimeCount, attendanceCorrections: 0, arrivalCorrections: arrivalCorrectionCount, payrollPayslips: 0 };
  }
  const [tasks, managerReviews, acknowledgements, productCreationRequests, overtime, corrections, payslips, arrivalCorrections] = await Promise.all([
    input.storeId ? client.from('v2_tasks').select('id', { count: 'exact', head: true }).eq('store_id', input.storeId).in('status', ['pending', 'in_progress', 'rejected', 'overdue']).or(`reviewed_by.is.null,reviewed_by.neq.${input.profileId}`) : Promise.resolve({ count: 0, error: null }),
    input.isManager ? client.from('v2_tasks').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'resubmitted']).eq('manager_review_enabled', true).eq('submitted_by_role', 'staff') : Promise.resolve({ count: 0, error: null }),
    client.from('v2_notice_recipients').select('notice_id, v2_notices!inner(requires_acknowledgment,status,expires_at)', { count: 'exact' }).eq('profile_id', input.profileId).is('acknowledged_at', null).eq('v2_notices.requires_acknowledgment', true).eq('v2_notices.status', 'published'),
    input.isManager ? client.from('product_creation_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending') : Promise.resolve({ count: 0, error: null }),
    input.isManager ? client.rpc('payroll_overtime_todo_count') : Promise.resolve({ data: 0, error: null }),
    client.from('attendance_missing_punch_todos').select('id', { count: 'exact', head: true }).eq('profile_id', input.profileId).eq('status', 'pending'),
    payrollPayslipTodoQuery(client, input.profileId, Boolean(input.isManager), true),
    input.isManager ? client.from('arrival_report_correction_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending') : Promise.resolve({ count: 0, error: null }),
  ]);
  if (tasks.error) throw new Error(tasks.error.message);
  if (managerReviews.error) throw new Error(managerReviews.error.message);
  if (acknowledgements.error) throw new Error(acknowledgements.error.message);
  if (productCreationRequests.error) throw new Error(productCreationRequests.error.message);
  if (overtime.error) throw new Error(overtime.error.message);
  if (corrections.error) throw new Error(corrections.error.message);
  if (payslips.error) throw new Error(payslips.error.message);
  if (arrivalCorrections.error) throw new Error(arrivalCorrections.error.message);
  const taskCount = (tasks.count ?? 0) + (managerReviews.count ?? 0);
  const acknowledgementCount = (acknowledgements.data ?? []).filter((row) => {
    const notice = row.v2_notices as unknown as { expires_at: string | null } | null;
    return !notice?.expires_at || new Date(notice.expires_at).getTime() > Date.now();
  }).length;
  const overtimeCount = overtime.data ?? 0;
  const creationRequestCount = productCreationRequests.count ?? 0;
  const correctionCount = corrections.count ?? 0;
  const payslipCount = payslips.count ?? 0;
  const arrivalCorrectionCount = arrivalCorrections.count ?? 0;
  return { count: taskCount + acknowledgementCount + creationRequestCount + overtimeCount + correctionCount + payslipCount + arrivalCorrectionCount, managerPenalties: 0, payrollConfirmations: 0, noticeAcknowledgements: acknowledgementCount, productCreationRequests: creationRequestCount, productFeedback: 0, tasks: taskCount, overtime: overtimeCount, attendanceCorrections: correctionCount, arrivalCorrections: arrivalCorrectionCount, payrollPayslips: payslipCount };
};

export const loadAdminManagerPenaltyTodos = async (client: Client) => {
  const { data, error } = await client.from('notifications').select('*')
    .eq('recipient_role', 'admin')
    .eq('type', 'manager_penalty_created')
    .eq('is_read', false)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message || '暂时无法加载店长罚单提醒。');
  return data ?? [];
};

export const completeAdminManagerPenaltyTodo = async (client: Client, id: string) => {
  const { error } = await client.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id).eq('type', 'manager_penalty_created').eq('is_read', false);
  if (error) throw new Error(error.message || '店长罚单提醒暂时无法标记为已读。');
};

export const loadAdminPayrollConfirmationTodos = async (client: Client, profileId: string) => {
  const { data, error } = await client.from('notifications').select('*')
    .eq('recipient_user_id', profileId)
    .eq('type', 'payroll_payslip_confirmed')
    .eq('is_read', false)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message || '暂时无法加载工资单确认提醒。');
  return data ?? [];
};

export const completeAdminPayrollConfirmationTodo = async (client: Client, id: string) => {
  const { error } = await client.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id).eq('is_read', false);
  if (error) throw new Error(error.message || '工资单确认提醒暂时无法标记为已读。');
};

export const loadMyPayrollPayslipTodos = async (client: Client, profileId: string, isManager = false) => {
  const { data, error } = await payrollPayslipTodoQuery(client, profileId, isManager).order('payroll_month', { ascending: false });
  if (error) throw new Error(error.message || '暂时无法加载工资单确认待办。');
  return (data ?? []) as Database['public']['Tables']['payroll_payslips']['Row'][];
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
