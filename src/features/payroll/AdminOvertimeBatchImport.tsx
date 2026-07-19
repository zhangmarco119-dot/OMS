import { Download, FileSpreadsheet, FileUp } from 'lucide-react';
import { useState } from 'react';

import { ActionFeedbackDialog } from '../../components/feedback/ActionFeedbackDialog';
import { BatchImportReportDialog } from '../../components/feedback/BatchImportReportDialog';
import { SectionCard, SectionHeader } from '../../components/ui/Surface';
import { supabase } from '../../lib/supabase';
import { adminRecordOvertime } from '../../services/payroll.service';
import { todayInChina } from './model';
import type {
  OvertimeImportProfile,
  OvertimeImportResult,
  OvertimeImportStore,
} from './overtimeBatchImport';

export function AdminOvertimeBatchImport({
  onSaved,
  profiles,
  stores,
}: {
  onSaved: () => Promise<void>;
  profiles: OvertimeImportProfile[];
  stores: OvertimeImportStore[];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<OvertimeImportResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const downloadTemplate = async () => {
    try {
      const { createOvertimeImportTemplate, downloadOvertimeImportTemplate } = await import('./overtimeBatchImport');
      downloadOvertimeImportTemplate(createOvertimeImportTemplate(profiles, stores));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加班导入模板生成失败。');
    }
  };

  const startImport = async () => {
    if (!supabase || !file) {
      setMessage('请先选择填写完成的 Excel 文件。');
      return;
    }
    const client = supabase;
    setImporting(true);
    setProgress(null);
    try {
      const { importAdminOvertimeRows, parseOvertimeImportFile } = await import('./overtimeBatchImport');
      const rows = await parseOvertimeImportFile(file);
      if (!rows.length) throw new Error('Excel 中没有需要导入的加班工时。');
      setProgress({ completed: 0, total: rows.length });
      const result = await importAdminOvertimeRows({
        onProgress: (completed, total) => setProgress({ completed, total }),
        profiles,
        recordOvertime: (input) => adminRecordOvertime(client, input),
        rows,
        stores,
        today: todayInChina(),
      });
      setReport(result);
      setFile(null);
      if (result.succeeded) await onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加班工时批量导入失败。');
    } finally {
      setImporting(false);
    }
  };

  const percentage = progress?.total ? Math.round(progress.completed / progress.total * 100) : 0;

  return <>
    <SectionCard>
      <SectionHeader icon={FileSpreadsheet} title="批量导入员工加班" description="适合一次登记多名员工或多个日期；导入后直接通过并计入实时薪资。" />
      <button className="ui-button-secondary mt-3 w-full" disabled={importing} onClick={() => void downloadTemplate()} type="button"><Download className="h-4 w-4" />下载 Excel 模板</button>
      <label className="mt-3 block text-sm font-semibold">选择填写完成的 Excel
        <input accept=".xlsx,.xls" className="mt-1 block w-full rounded-xl border border-slate-200 p-3 text-sm" disabled={importing} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setProgress(null); }} type="file" />
      </label>
      <p className="mt-2 text-xs leading-5 text-slate-500">按员工账号匹配，支持员工姓名校验；日期格式为 YYYY-MM-DD，工时为 0.5–6 小时。单行失败不会影响其他记录。</p>
      {progress ? <div className="mt-3" aria-live="polite"><div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600"><span>{importing ? '正在导入加班工时' : '导入处理完成'}</span><span>{progress.completed}/{progress.total}</span></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${percentage}%` }} /></div></div> : null}
      <button className="ui-button-primary mt-3 w-full" disabled={importing || !file} onClick={() => void startImport()} type="button"><FileUp className="h-4 w-4" />{importing ? '正在批量导入' : '开始批量导入'}</button>
    </SectionCard>

    <BatchImportReportDialog failureCount={report?.failed ?? 0} failures={report?.failures ?? []} onClose={() => setReport(null)} open={Boolean(report)} successCount={report?.succeeded ?? 0} successDescription={`成功登记 ${report?.succeeded ?? 0} 条加班工时，已直接确认通过并计入实时薪资。失败行不会影响其他记录。`} title="员工加班批量导入完成" />
    <ActionFeedbackDialog message={message ?? ''} onClose={() => setMessage(null)} open={Boolean(message)} title="导入未完成" tone="warning" />
  </>;
}
