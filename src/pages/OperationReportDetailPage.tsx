import { ClipboardCopy, Images } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageShell } from '../components/layout/PageShell';
import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { ErrorState, LoadingState } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadOperationReportImages, type OperationReportImage } from '../services/operation-report-images.service';
import { getOperationReport, type OperationReport } from '../services/operation-reports.service';

export function OperationReportDetailPage() {
  const { reportId = '' } = useParams(); const auth = useAuth();
  const [report, setReport] = useState<OperationReport | null>(null); const [images, setImages] = useState<OperationReportImage[]>([]); const [error, setError] = useState(''); const [copied, setCopied] = useState(false);
  useEffect(() => { void (async () => { try { const row = await getOperationReport(reportId); setReport(row); if (supabase) setImages(await loadOperationReportImages(supabase, reportId)); } catch (cause) { setError(cause instanceof Error ? cause.message : '报告加载失败。'); } })(); }, [reportId]);
  if (error) return <PageShell backTo="/app/operation-reports" eyebrow="门店运营" title="运营报告详情"><ErrorState message={error} /></PageShell>;
  if (!report) return <PageShell backTo="/app/operation-reports" eyebrow="门店运营" title="运营报告详情"><LoadingState /></PageShell>;
  const canSeePhotos = auth.profile?.role === 'admin' || auth.profile?.role === 'manager';
  return <PageShell backTo="/app/operation-reports" eyebrow={report.report_date} title={report.title_snapshot}><SectionCard><pre className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{report.text_report}</pre><button className="ui-button-primary mt-4 w-full" onClick={async () => { await navigator.clipboard.writeText(report.text_report ?? ''); setCopied(true); }} type="button"><ClipboardCopy className="h-4 w-4" />一键复制纯文字</button></SectionCard>{canSeePhotos ? <SectionCard><SectionHeader icon={Images} title="现场图片" description="店长和管理员可查看报告所附的物料与报废照片。" /><div className="mt-3 grid grid-cols-2 gap-2">{images.map((image) => <figure key={image.id}><img alt="运营报告现场图片" className="aspect-square w-full rounded-xl bg-slate-50 object-contain" src={image.signedUrl} /><figcaption className="mt-1 truncate text-center text-xs text-slate-500">{report.field_config_snapshot.find((field) => field.id === image.field_id)?.label ?? image.field_id}</figcaption></figure>)}</div></SectionCard> : null}<ActionFeedbackDialog message="纯文字运营报告已复制到剪贴板。" onClose={() => setCopied(false)} open={copied} title="复制成功" tone="success" /></PageShell>;
}
