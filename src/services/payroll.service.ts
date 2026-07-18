import type { SupabaseClient } from '@supabase/supabase-js';

import type { AdminPayrollSummary, PayrollEstimate } from '../features/payroll/model';
import { createUuid } from '../lib/uuid';
import type { Database, Json } from '../types/database';

type Client = SupabaseClient<Database>;
type RuleRow = Database['public']['Tables']['payroll_employee_rules']['Row'];
type PerformanceRuleRow = Database['public']['Tables']['payroll_performance_rules']['Row'];
type RevenueRow = Database['public']['Tables']['payroll_store_revenues']['Row'];
type PenaltyRow = Database['public']['Tables']['payroll_penalties']['Row'];
type OvertimeRequestRow = Database['public']['Tables']['payroll_overtime_requests']['Row'];
export type PosSalesIntegration = Database['public']['Tables']['pos_sales_integrations']['Row'];
export type PosSalesSyncJob = Database['public']['Tables']['pos_sales_sync_jobs']['Row'];

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
    commissionEnabled: boolAt(item.commissionEnabled), fullAttendanceBonusEnabled: boolAt(item.fullAttendanceBonusEnabled),
    fullAttendanceBonusAmount: numberAt(item.fullAttendanceBonusAmount), fullAttendanceBonusAwarded: boolAt(item.fullAttendanceBonusAwarded),
    accruedFullAttendanceBonus: numberAt(item.accruedFullAttendanceBonus), serviceAwardEnabled: boolAt(item.serviceAwardEnabled),
    serviceAwardAmount: numberAt(item.serviceAwardAmount), accruedServiceAward: numberAt(item.accruedServiceAward),
    regularizationDate: nullableTextAt(item.regularizationDate), eligibleAttendanceDays: numberAt(item.eligibleAttendanceDays),
    regularizationFactor: numberAt(item.regularizationFactor), isProbation: boolAt(item.isProbation), accruedBaseSalary: numberAt(item.accruedBaseSalary),
    accruedHousingAllowance: numberAt(item.accruedHousingAllowance), accruedPerformance: nullableNumberAt(item.accruedPerformance),
    accruedCommission: nullableNumberAt(item.accruedCommission), lateCount: numberAt(item.lateCount), lateMinutes: numberAt(item.lateMinutes),
    overtimeHours: numberAt(item.overtimeHours), overtimeHourlyRate: nullableNumberAt(item.overtimeHourlyRate), accruedOvertime: numberAt(item.accruedOvertime),
    lateFine: numberAt(item.lateFine), otherFine: numberAt(item.otherFine), fineTotal: numberAt(item.fineTotal),
    taskDueCount: numberAt(item.taskDueCount), taskCompletedCount: numberAt(item.taskCompletedCount), taskScore: nullableNumberAt(item.taskScore),
    attendanceScore: numberAt(item.attendanceScore), disciplineScore: numberAt(item.disciplineScore), performanceScore: nullableNumberAt(item.performanceScore),
    performanceGrade: nullableTextAt(item.performanceGrade), revenueTotal: numberAt(item.revenueTotal),
    revenueEffectiveDate: nullableTextAt(item.revenueEffectiveDate), revenueCarriedForward: boolAt(item.revenueCarriedForward), performanceReady: boolAt(item.performanceReady),
    commissionReady: boolAt(item.commissionReady), dataComplete: boolAt(item.dataComplete), incomeSubtotalKnown: numberAt(item.incomeSubtotalKnown),
    knownEstimatedPayable: numberAt(item.knownEstimatedPayable), estimatedPayable: nullableNumberAt(item.estimatedPayable),
    attendanceUpdatedAt: nullableTextAt(item.attendanceUpdatedAt), tasksUpdatedAt: nullableTextAt(item.tasksUpdatedAt),
    revenueUpdatedAt: nullableTextAt(item.revenueUpdatedAt), penaltiesUpdatedAt: nullableTextAt(item.penaltiesUpdatedAt),
    overtimeUpdatedAt: nullableTextAt(item.overtimeUpdatedAt),
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
  const [profiles, rules, commissionStores, performanceRules, revenues, revenueInputs, penalties, penaltyAssets, overtimeRates, overtimeRequests] = await Promise.all([
    client.from('profiles').select('*').in('role', ['staff', 'manager']).is('deleted_at', null).order('display_name'),
    client.from('payroll_employee_rules').select('*').order('effective_from', { ascending: false }),
    client.from('payroll_employee_commission_stores').select('*'),
    client.from('payroll_performance_rules').select('*').order('effective_from', { ascending: false }),
    client.from('payroll_store_revenues').select('*').gte('revenue_date', monthStart).order('revenue_date', { ascending: false }),
    client.from('payroll_store_revenue_inputs').select('*').gte('as_of_date', monthStart).order('as_of_date', { ascending: false }),
    client.from('payroll_penalties').select('*').gte('event_date', monthStart).order('event_date', { ascending: false }),
    client.from('payroll_penalty_assets').select('*').order('created_at', { ascending: true }),
    client.from('payroll_overtime_rates').select('*').order('effective_from', { ascending: false }),
    client.from('payroll_overtime_requests').select('*').gte('overtime_date', monthStart).order('created_at', { ascending: false }),
  ]);
  const error = profiles.error ?? rules.error ?? commissionStores.error ?? performanceRules.error ?? revenues.error ?? revenueInputs.error ?? penalties.error ?? penaltyAssets.error ?? overtimeRates.error ?? overtimeRequests.error;
  if (error) throw new Error(error.message || '暂时无法加载工资设置。');
  return { profiles: profiles.data ?? [], rules: rules.data ?? [], commissionStores: commissionStores.data ?? [], performanceRules: performanceRules.data ?? [], revenues: revenues.data ?? [], revenueInputs: revenueInputs.data ?? [], penalties: penalties.data ?? [], penaltyAssets: penaltyAssets.data ?? [], overtimeRates: overtimeRates.data ?? [], overtimeRequests: overtimeRequests.data ?? [] };
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
  const { error } = await client.from('payroll_store_revenues').upsert({
    ...input,
    source: 'manual',
    source_reference_id: null,
    source_updated_at: new Date().toISOString(),
  }, { onConflict: 'store_id,revenue_date' });
  if (error) throw new Error(error.message || '营业收入保存失败。');
}

export async function savePayrollRevenueInput(client: Client, input: {
  asOfDate: string;
  mode: 'pos_sync' | 'manual';
  manualCumulativeAmount?: number | null;
  note?: string;
  storeId: string;
}) {
  const { data, error } = await client.rpc('save_payroll_store_revenue_input', {
    p_as_of_date: input.asOfDate,
    p_input_mode: input.mode,
    p_manual_cumulative_amount: input.mode === 'manual' ? input.manualCumulativeAmount ?? null : null,
    p_note: input.note?.trim() ?? '',
    p_store_id: input.storeId,
  });
  if (error) throw new Error(error.message || '营业收入来源保存失败。');
  return data;
}

export async function loadPosSalesSetup(client: Client) {
  const [integrations, jobs] = await Promise.all([
    client.from('pos_sales_integrations').select('*').order('display_name'),
    client.from('pos_sales_sync_jobs').select('*').order('created_at', { ascending: false }).limit(20),
  ]);
  const error = integrations.error ?? jobs.error;
  if (error) throw new Error(error.message || '暂时无法加载收银系统同步状态。');
  return { integrations: integrations.data ?? [], jobs: jobs.data ?? [] };
}

export async function configurePosSalesIntegration(client: Client, input: {
  enabled: boolean;
  endHour: number;
  id: string;
  intervalMinutes: number;
  startHour: number;
}) {
  const { data, error } = await client.rpc('configure_pos_sales_integration', {
    p_enabled: input.enabled,
    p_end_hour: input.endHour,
    p_integration_id: input.id,
    p_interval_minutes: input.intervalMinutes,
    p_start_hour: input.startHour,
  });
  if (error) throw new Error(error.message || '收银系统同步设置保存失败。');
  return data;
}

export async function invokePospalSalesSync(client: Client, integrationId: string, date: string) {
  const { data, error } = await client.functions.invoke('pospal-sales', {
    body: { action: 'manual-sync', integrationId, date },
  });
  if (error) throw new Error(error.message || '银豹营业收入同步失败。');
  const result = data as { error?: string; results?: Array<{ apiCallCount?: number; revenueAmount?: number; status: string; ticketCount?: number }> } | null;
  if (result?.error) throw new Error(result.error);
  const first = result?.results?.[0];
  if (!first || first.status !== 'succeeded') throw new Error('银豹营业收入同步未返回成功结果。');
  return first;
}

export async function invokePospalMonthlySalesSync(client: Client, integrationId: string, endDate: string) {
  const { data, error } = await client.functions.invoke('pospal-sales', {
    body: { action: 'manual-sync-month', integrationId, endDate },
  });
  if (error) throw new Error(error.message || '银豹本月累计营业收入同步失败。');
  const result = data as { error?: string; results?: Array<{ apiCallCount?: number; revenueAmount?: number; status: string; syncDate?: string; syncEndDate?: string; ticketCount?: number }> } | null;
  if (result?.error) throw new Error(result.error);
  const first = result?.results?.[0];
  if (!first || first.status !== 'succeeded') throw new Error('银豹本月累计营业收入同步未返回成功结果。');
  return first;
}

export async function addPayrollPenalty(client: Client, input: { profileId: string; eventDate: string; reason: string; amount: number; eventLevel: PenaltyRow['event_level']; performanceDeduction: number }) {
  const { data, error } = await client.rpc('admin_create_payroll_penalty', { p_fields: input });
  if (error) throw new Error(error.message || '罚款记录保存失败。');
  return data as unknown as PenaltyRow;
}

export async function revokePayrollPenalty(client: Client, id: string, reason: string) {
  const { error } = await client.from('payroll_penalties').update({ status: 'revoked', revoke_reason: reason }).eq('id', id);
  if (error) throw new Error(error.message || '撤销罚款失败。');
}

const evidenceBucket = 'payroll-evidence';
const allowedEvidenceTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function uploadPayrollEvidence(client: Client, input: { file: File; ownerId: string; entityId: string }) {
  if (!allowedEvidenceTypes.has(input.file.type)) throw new Error('只支持 JPG、PNG 或 WEBP 图片。');
  if (!input.file.size || input.file.size > 10 * 1024 * 1024) throw new Error('图片大小必须在 10 MB 以内。');
  const extension = input.file.type === 'image/png' ? 'png' : input.file.type === 'image/webp' ? 'webp' : 'jpg';
  const objectPath = `${input.ownerId}/penalty/${input.entityId}/${createUuid()}.${extension}`;
  const uploaded = await client.storage.from(evidenceBucket).upload(objectPath, input.file, { contentType: input.file.type, upsert: false });
  if (uploaded.error) throw new Error(uploaded.error.message);
  const mimeType = input.file.type as 'image/jpeg' | 'image/png' | 'image/webp';
  const metadata = await client.from('payroll_penalty_assets').insert({ penalty_id: input.entityId, bucket: evidenceBucket, object_path: objectPath, file_name: input.file.name || `evidence.${extension}`, mime_type: mimeType, size_bytes: input.file.size, uploaded_by: input.ownerId });
  if (metadata.error) { await client.storage.from(evidenceBucket).remove([objectPath]); throw new Error(metadata.error.message); }
}

export async function loadMyOvertimeRequests(client: Client, profileId: string) {
  const { data, error } = await client.from('payroll_overtime_requests').select('*').eq('profile_id', profileId).order('overtime_date', { ascending: false });
  if (error) throw new Error(error.message || '暂时无法加载加班申请。');
  return data ?? [];
}

export async function loadManagerOvertimeRequests(client: Client, storeIds: string[]) {
  if (!storeIds.length) return [];
  const { data, error } = await client.from('payroll_overtime_requests').select('*').in('store_id', storeIds).order('created_at', { ascending: false });
  if (error) throw new Error(error.message || '暂时无法加载加班审批。');
  return data ?? [];
}

export async function loadAllOvertimeRequests(client: Client) {
  const { data, error } = await client.from('payroll_overtime_requests').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message || '暂时无法加载加班审批。');
  return data ?? [];
}

export async function loadOvertimeProfiles(client: Client, profileIds: string[]) {
  if (!profileIds.length) return [];
  const { data, error } = await client.from('profiles').select('*').in('id', Array.from(new Set(profileIds)));
  if (error) throw new Error(error.message || '暂时无法加载加班申请人信息。');
  return data ?? [];
}

export async function submitOvertimeRequest(client: Client, input: { storeId: string; overtimeDate: string; hours: number; reason?: string }) {
  const { data, error } = await client.rpc('submit_payroll_overtime_request', { p_store_id: input.storeId, p_overtime_date: input.overtimeDate, p_hours: input.hours, p_reason: input.reason });
  if (error) throw new Error(error.message || '加班申请提交失败。');
  return data as unknown as OvertimeRequestRow;
}

export async function updateOvertimeRequest(client: Client, id: string, input: { storeId: string; overtimeDate: string; hours: number; reason?: string }) {
  const { data, error } = await client.rpc('update_payroll_overtime_request', { p_request_id: id, p_store_id: input.storeId, p_overtime_date: input.overtimeDate, p_hours: input.hours, p_reason: input.reason });
  if (error) throw new Error(error.message || '加班申请修改失败。');
  return data as unknown as OvertimeRequestRow;
}

export async function reviewOvertimeRequest(client: Client, id: string, action: 'approved' | 'rejected', note: string) {
  const { data, error } = await client.rpc('review_payroll_overtime_request', { p_request_id: id, p_action: action, p_note: note });
  if (error) throw new Error(error.message || '加班审批提交失败。');
  return data as unknown as OvertimeRequestRow;
}

export async function saveOvertimeRate(client: Client, input: { hourlyRate: number; effectiveFrom: string; changeReason: string }) {
  const { error } = await client.rpc('admin_save_payroll_overtime_rate', { p_hourly_rate: input.hourlyRate, p_effective_from: input.effectiveFrom, p_change_reason: input.changeReason });
  if (error) throw new Error(error.message || '加班时薪保存失败。');
}

export type PayrollEmployeeRule = RuleRow;
export type PayrollPerformanceRule = PerformanceRuleRow;
export type PayrollRevenue = RevenueRow;
export type PayrollPenalty = PenaltyRow;
