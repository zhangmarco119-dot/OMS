import type { Json } from '../types/database';
import { supabase } from '../lib/supabase';
import type { OperationReportField, RefundEntry } from '../features/operation-reports/reportText';

export type OperationReport = {
  attendance_sync_job_id: string | null; computed_data: Record<string, unknown>; created_by: string;
  field_config_snapshot: OperationReportField[]; id: string; manual_values: Record<string, string>;
  refund_entries: RefundEntry[]; refund_note_snapshot: string; report_date: string;
  sales_sync_job_id: string | null; status: 'draft' | 'submitted'; store_id: string;
  submitted_at: string | null; text_report: string | null; title_snapshot: string;
  source_synced_at: string | null; refresh_started_at: string | null;
};

export type OperationReportAvailability = { available: boolean; fields?: OperationReportField[]; refundNote?: string; title?: string };

const client = () => { if (!supabase) throw new Error('数据库连接尚未配置。'); return supabase; };
const dataObject = <T>(value: Json | null): T => value as T;
const parseReport = (row: Record<string, unknown>) => ({
  ...row,
  computed_data: dataObject<Record<string, unknown>>(row.computed_data as Json),
  field_config_snapshot: dataObject<OperationReportField[]>(row.field_config_snapshot as Json),
  manual_values: dataObject<Record<string, string>>(row.manual_values as Json),
  refund_entries: dataObject<RefundEntry[]>(row.refund_entries as Json),
}) as OperationReport;

export async function getOperationReportAvailability(storeId: string) {
  const { data, error } = await client().rpc('get_operation_report_availability', { p_store_id: storeId });
  if (error) throw new Error(error.message);
  return dataObject<OperationReportAvailability>(data);
}

export async function getOperationReportDraft(storeId: string, date: string) {
  const { data, error } = await client().from('operation_reports').select('*')
    .eq('store_id', storeId).eq('report_date', date).eq('status', 'draft').maybeSingle();
  if (error) throw new Error(error.message);
  return data ? parseReport(data) : null;
}

export async function syncOperationReportSources(storeId: string, date: string, onStage: (stage: 'pos' | 'attendance' | 'prepare') => void) {
  const started = await client().rpc('begin_operation_report_refresh', { p_report_date: date, p_store_id: storeId });
  if (started.error) throw new Error(started.error.message);
  const gate = dataObject<{ cachedAt?: string; mode: 'cached' | 'refresh' | 'submitted' | 'throttled'; report?: Record<string, unknown> }>(started.data);
  if (gate.mode === 'cached' && gate.report) return { cached: true, report: parseReport(gate.report) };
  if (gate.mode === 'submitted') throw new Error('该日期的运营报告已经推送，历史报告不能重新生成。');
  if (gate.mode === 'throttled') throw new Error('数据正在拉取，请至少等待 30 秒后再试。');
  const draft = gate.report ? parseReport(gate.report) : null;
  try {
    onStage('pos');
    const pos = await client().functions.invoke('pospal-sales', { body: { action: 'report-sync', date, storeId } });
    if (pos.error || pos.data?.status !== 'succeeded') throw new Error(pos.data?.error ?? pos.error?.message ?? '收银数据拉取失败。');
    const salesJobId = pos.data.results?.[0]?.jobId as string | undefined;
    if (!salesJobId) throw new Error('收银同步未返回任务编号。');
    onStage('attendance');
    const attendance = await client().functions.invoke('dingtalk-attendance', { body: { action: 'report-sync', date, storeId } });
    if (attendance.error || !['succeeded', 'partial'].includes(attendance.data?.status)) throw new Error(attendance.data?.message ?? attendance.error?.message ?? '考勤数据拉取失败。');
    onStage('prepare');
    const prepared = await client().rpc('prepare_operation_report', {
      p_attendance_sync_job_id: attendance.data.jobId, p_report_date: date,
      p_sales_sync_job_id: salesJobId, p_store_id: storeId,
    });
    if (prepared.error) throw new Error(prepared.error.message);
    return { cached: Boolean(attendance.data?.cached), report: parseReport(dataObject<Record<string, unknown>>(prepared.data)) };
  } catch (error) {
    if (draft) await client().rpc('release_operation_report_refresh', { p_report_id: draft.id });
    throw error;
  }
}

export async function saveOperationReportDraft(reportId: string, manualValues: Record<string, string>, refunds: RefundEntry[]) {
  const { data, error } = await client().rpc('save_operation_report_draft', {
    p_manual_values: manualValues, p_refund_entries: refunds, p_report_id: reportId,
  });
  if (error) throw new Error(error.message);
  return parseReport(dataObject<Record<string, unknown>>(data));
}

export async function submitOperationReport(reportId: string, manualValues: Record<string, string>, refunds: RefundEntry[], text: string) {
  const { data, error } = await client().rpc('submit_operation_report', {
    p_manual_values: manualValues, p_refund_entries: refunds, p_report_id: reportId, p_text_report: text,
  });
  if (error) throw new Error(error.message);
  return dataObject<OperationReport>(data);
}

export async function listOperationReports(storeId?: string) {
  let query = client().from('operation_reports').select('*').eq('status', 'submitted').order('report_date', { ascending: false }).limit(60);
  if (storeId) query = query.eq('store_id', storeId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => parseReport(row));
}

export async function getOperationReport(reportId: string) {
  const { data, error } = await client().from('operation_reports').select('*').eq('id', reportId).single();
  if (error) throw new Error(error.message);
  return parseReport(data);
}

export async function saveOperationReportTemplate(storeId: string, title: string, fields: OperationReportField[], refundNote: string, enabled: boolean) {
  const { error } = await client().rpc('admin_save_operation_report_template', { p_enabled: enabled, p_fields: fields as unknown as Json, p_refund_note: refundNote, p_store_id: storeId, p_title: title });
  if (error) throw new Error(error.message);
}
