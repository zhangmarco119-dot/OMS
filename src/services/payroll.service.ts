import type { SupabaseClient } from '@supabase/supabase-js';

import type { AdminPayrollSummary, PayrollEstimate } from '../features/payroll/model';
import type { Database, Json } from '../types/database';

type Client = SupabaseClient<Database>;
type RuleRow = Database['public']['Tables']['payroll_employee_rules']['Row'];
type PerformanceRuleRow = Database['public']['Tables']['payroll_performance_rules']['Row'];
type RevenueRow = Database['public']['Tables']['payroll_store_revenues']['Row'];
type PenaltyRow = Database['public']['Tables']['payroll_penalties']['Row'];

const objectAt = (value: Json | null | undefined): Record<string, Json | undefined> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const numberAt = (value: Json | undefined) => typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : 0;
const nullableNumberAt = (value: Json | undefined) => value == null || value === '' ? null : numberAt(value);
const textAt = (value: Json | undefined, fallback = '') => typeof value === 'string' ? value : fallback;
const nullableTextAt = (value: Json | undefined) => typeof value === 'string' ? value : null;
const boolAt = (value: Json | undefined) => value === true;

export const parsePayrollEstimate = (value: Json): PayrollEstimate => {
  const item = objectAt(value);
  return {
    profileId: textAt(item.profileId), displayName: textAt(item.displayName, '未命名员工'), username: textAt(item.username),
    primaryStoreId: textAt(item.primaryStoreId), asOf: textAt(item.asOf), monthStart: textAt(item.monthStart), monthEnd: textAt(item.monthEnd),
    fullAttendanceDays: numberAt(item.fullAttendanceDays), attendanceDays: numberAt(item.attendanceDays), ruleId: nullableTextAt(item.ruleId),
    ruleConfirmed: boolAt(item.ruleConfirmed), monthlyBaseSalary: nullableNumberAt(item.monthlyBaseSalary),
    monthlyHousingAllowance: nullableNumberAt(item.monthlyHousingAllowance), fullPerformanceAmount: nullableNumberAt(item.fullPerformanceAmount),
    commissionRate: nullableNumberAt(item.commissionRate), housingEnabled: boolAt(item.housingEnabled), performanceEnabled: boolAt(item.performanceEnabled),
    commissionEnabled: boolAt(item.commissionEnabled), accruedBaseSalary: numberAt(item.accruedBaseSalary),
    accruedHousingAllowance: numberAt(item.accruedHousingAllowance), accruedPerformance: nullableNumberAt(item.accruedPerformance),
    accruedCommission: nullableNumberAt(item.accruedCommission), lateCount: numberAt(item.lateCount), lateMinutes: numberAt(item.lateMinutes),
    lateFine: numberAt(item.lateFine), otherFine: numberAt(item.otherFine), fineTotal: numberAt(item.fineTotal),
    taskDueCount: numberAt(item.taskDueCount), taskCompletedCount: numberAt(item.taskCompletedCount), taskScore: nullableNumberAt(item.taskScore),
    attendanceScore: numberAt(item.attendanceScore), disciplineScore: numberAt(item.disciplineScore), performanceScore: nullableNumberAt(item.performanceScore),
    performanceGrade: nullableTextAt(item.performanceGrade), revenueTotal: numberAt(item.revenueTotal), performanceReady: boolAt(item.performanceReady),
    commissionReady: boolAt(item.commissionReady), dataComplete: boolAt(item.dataComplete), incomeSubtotalKnown: numberAt(item.incomeSubtotalKnown),
    knownEstimatedPayable: numberAt(item.knownEstimatedPayable), estimatedPayable: nullableNumberAt(item.estimatedPayable),
    attendanceUpdatedAt: nullableTextAt(item.attendanceUpdatedAt), tasksUpdatedAt: nullableTextAt(item.tasksUpdatedAt),
    revenueUpdatedAt: nullableTextAt(item.revenueUpdatedAt), penaltiesUpdatedAt: nullableTextAt(item.penaltiesUpdatedAt),
    dataIssues: Array.isArray(item.dataIssues) ? item.dataIssues.filter((entry): entry is string => typeof entry === 'string') : [],
  };
};

export async function loadMyPayrollEstimate(client: Client, profileId: string, asOf: string) {
  const { data, error } = await client.rpc('get_payroll_estimate', { p_profile_id: profileId, p_as_of: asOf });
  if (error) throw new Error(error.message || '暂时无法计算预估工资。');
  return parsePayrollEstimate(data);
}

export async function loadAdminPayrollEstimates(client: Client, options: { asOf: string; storeId?: string; search?: string }): Promise<AdminPayrollSummary> {
  const { data, error } = await client.rpc('admin_payroll_estimates', { p_as_of: options.asOf, p_store_id: options.storeId || null, p_search: options.search?.trim() ?? '' });
  if (error) throw new Error(error.message || '暂时无法加载实时工资列表。');
  const root = objectAt(data);
  return {
    items: Array.isArray(root.items) ? root.items.map((item) => parsePayrollEstimate(item)) : [],
    employeeCount: numberAt(root.employeeCount), completeCount: numberAt(root.completeCount), incompleteCount: numberAt(root.incompleteCount),
    knownEstimatedTotal: numberAt(root.knownEstimatedTotal), completeEstimatedTotal: numberAt(root.completeEstimatedTotal),
  };
}

export async function loadPayrollAdminSetup(client: Client, monthStart: string) {
  const [profiles, rules, commissionStores, performanceRules, revenues, penalties] = await Promise.all([
    client.from('profiles').select('*').in('role', ['staff', 'manager']).is('deleted_at', null).order('display_name'),
    client.from('payroll_employee_rules').select('*').order('effective_from', { ascending: false }),
    client.from('payroll_employee_commission_stores').select('*'),
    client.from('payroll_performance_rules').select('*').order('effective_from', { ascending: false }),
    client.from('payroll_store_revenues').select('*').gte('revenue_date', monthStart).order('revenue_date', { ascending: false }),
    client.from('payroll_penalties').select('*').gte('event_date', monthStart).order('event_date', { ascending: false }),
  ]);
  const error = profiles.error ?? rules.error ?? commissionStores.error ?? performanceRules.error ?? revenues.error ?? penalties.error;
  if (error) throw new Error(error.message || '暂时无法加载工资设置。');
  return { profiles: profiles.data ?? [], rules: rules.data ?? [], commissionStores: commissionStores.data ?? [], performanceRules: performanceRules.data ?? [], revenues: revenues.data ?? [], penalties: penalties.data ?? [] };
}

export async function savePayrollEmployeeRule(client: Client, profileId: string, fields: Record<string, Json | undefined>, storeIds: string[]) {
  const { data, error } = await client.rpc('admin_save_payroll_employee_rule', { p_profile_id: profileId, p_fields: fields as Json, p_store_ids: storeIds });
  if (error) throw new Error(error.message || '工资参数保存失败。');
  return data;
}

export async function savePayrollPerformanceRule(client: Client, fields: Record<string, Json | undefined>) {
  const { data, error } = await client.rpc('admin_save_payroll_performance_rule', { p_fields: fields as Json });
  if (error) throw new Error(error.message || '绩效规则保存失败。');
  return data;
}

export async function savePayrollRevenue(client: Client, input: Pick<RevenueRow, 'store_id' | 'revenue_date' | 'confirmed_amount' | 'note' | 'updated_by'>) {
  const { error } = await client.from('payroll_store_revenues').upsert(input, { onConflict: 'store_id,revenue_date' });
  if (error) throw new Error(error.message || '营业收入保存失败。');
}

export async function addPayrollPenalty(client: Client, input: Pick<PenaltyRow, 'profile_id' | 'event_date' | 'reason' | 'amount' | 'event_level' | 'performance_deduction' | 'created_by'>) {
  const { error } = await client.from('payroll_penalties').insert(input);
  if (error) throw new Error(error.message || '罚款记录保存失败。');
}

export async function revokePayrollPenalty(client: Client, id: string, reason: string) {
  const { error } = await client.from('payroll_penalties').update({ status: 'revoked', revoke_reason: reason }).eq('id', id);
  if (error) throw new Error(error.message || '撤销罚款失败。');
}

export type PayrollEmployeeRule = RuleRow;
export type PayrollPerformanceRule = PerformanceRuleRow;
export type PayrollRevenue = RevenueRow;
export type PayrollPenalty = PenaltyRow;

