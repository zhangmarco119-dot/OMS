import type { Json } from '../types/database';
import { supabase } from '../lib/supabase';
import type { OperationReportField, RefundEntry } from '../features/operation-reports/reportText';

export type OperationReport = {
  attendance_sync_job_id: string | null; computed_data: Record<string, unknown>; created_by: string;
  field_config_snapshot: OperationReportField[]; id: string; manual_values: Record<string, string>;
  refund_entries: RefundEntry[]; refund_note_snapshot: string; report_date: string;
  sales_sync_job_id: string | null; status: 'draft' | 'submitted'; store_id: string;
  submitted_at: string | null; text_report: string | null; title_snapshot: string;
};

export type OperationReportAvailability = { available: boolean; fields?: OperationReportField[]; refundNote?: string; title?: string };

const client = () => { if (!supabase) throw new Error('数据库连接尚未配置。'); return supabase; };
const dataObject = <T>(value: Json | null): T => value as T;

export async function getOperationReportAvailability(storeId: string) {
  const { data, error } = await client().rpc('get_operation_report_availability', { p_store_id: storeId });
  if (error) throw new Error(error.message);
  return dataObject<OperationReportAvailability>(data);
}

export async function syncOperationReportSources(storeId: string, date: string, onStage: (stage: 'pos' | 'attendance' | 'prepare') => void) {
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
  return dataObject<OperationReport>(prepared.data);
}

export async function submitOperationReport(reportId: string, manualValues: Record<string, string>, refunds: RefundEntry[], text: string) {
  const { data, error } = await client().rpc('submit_operation_report', {
    p_manual_values: manualValues, p_refund_entries: refunds, p_report_id: reportId, p_text_report: text,
  });
  if (error) throw new Error(error.message);
  return dataObject<OperationReport>(data);
}

export async function listOperationReports(storeId?: string) {
  let query = client().from('operation_reports').select('*').order('report_date', { ascending: false }).limit(60);
  if (storeId) query = query.eq('store_id', storeId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ ...row, computed_data: dataObject<Record<string, unknown>>(row.computed_data), field_config_snapshot: dataObject<OperationReportField[]>(row.field_config_snapshot), manual_values: dataObject<Record<string, string>>(row.manual_values), refund_entries: dataObject<RefundEntry[]>(row.refund_entries) })) as OperationReport[];
}

export async function getOperationReport(reportId: string) {
  const { data, error } = await client().from('operation_reports').select('*').eq('id', reportId).single();
  if (error) throw new Error(error.message);
  return { ...data, computed_data: dataObject<Record<string, unknown>>(data.computed_data), field_config_snapshot: dataObject<OperationReportField[]>(data.field_config_snapshot), manual_values: dataObject<Record<string, string>>(data.manual_values), refund_entries: dataObject<RefundEntry[]>(data.refund_entries) } as OperationReport;
}

export async function saveOperationReportTemplate(storeId: string, title: string, fields: OperationReportField[], refundNote: string, enabled: boolean) {
  const { error } = await client().rpc('admin_save_operation_report_template', { p_enabled: enabled, p_fields: fields as unknown as Json, p_refund_note: refundNote, p_store_id: storeId, p_title: title });
  if (error) throw new Error(error.message);
}
