import { ClipboardCopy, Download, Images, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { ActionFeedbackDialog, type ActionFeedbackTone } from '../components/feedback/ActionFeedbackDialog';
import { PageShell } from '../components/layout/PageShell';
import { ErrorState, LoadingState } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import {
  downloadOperationReportImage,
  loadOperationReportImages,
  type OperationReportImage,
} from '../services/operation-report-images.service';
import { getOperationReport, type OperationReport } from '../services/operation-reports.service';

type Feedback = { message: string; title: string; tone: ActionFeedbackTone };

export function OperationReportDetailPage() {
  const { reportId = '' } = useParams();
  const auth = useAuth();
  const [report, setReport] = useState<OperationReport | null>(null);
  const [images, setImages] = useState<OperationReportImage[]>([]);
  const [viewer, setViewer] = useState<OperationReportImage | null>(null);
  const [downloadingId, setDownloadingId] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const row = await getOperationReport(reportId);
        setReport(row);
        if (supabase) setImages(await loadOperationReportImages(supabase, reportId));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '报告加载失败。');
      }
    })();
  }, [reportId]);

  const download = async (image: OperationReportImage) => {
    if (!supabase) return;
    setDownloadingId(image.id);
    try {
      await downloadOperationReportImage(supabase, image);
      setFeedback({ title: '图片已下载', message: '现场照片已保存到当前设备。', tone: 'success' });
    } catch (cause) {
      setFeedback({ title: '下载失败', message: cause instanceof Error ? cause.message : '请稍后重试。', tone: 'danger' });
    } finally {
      setDownloadingId('');
    }
  };

  if (error) return <PageShell backTo="/app/operation-reports" eyebrow="门店运营" title="运营报告详情"><ErrorState message={error} /></PageShell>;
  if (!report) return <PageShell backTo="/app/operation-reports" eyebrow="门店运营" title="运营报告详情"><LoadingState /></PageShell>;

  const canSeePhotos = auth.profile?.role === 'admin' || auth.profile?.role === 'manager';
  return (
    <PageShell backTo="/app/operation-reports" eyebrow={report.report_date} title={report.title_snapshot}>
      <SectionCard>
        <pre className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{report.text_report}</pre>
        <button className="ui-button-primary mt-4 w-full" onClick={async () => {
          await navigator.clipboard.writeText(report.text_report ?? '');
          setFeedback({ title: '复制成功', message: '纯文字运营报告已复制到剪贴板。', tone: 'success' });
        }} type="button"><ClipboardCopy className="h-4 w-4" />一键复制纯文字</button>
      </SectionCard>

      {canSeePhotos ? (
        <SectionCard>
          <SectionHeader icon={Images} title="现场图片" description="点击图片可查看大图，也可以下载保存到当前设备。" />
          <div className="mt-3 grid grid-cols-2 gap-3">
            {images.map((image) => {
              const field = report.field_config_snapshot.find((item) => item.id === image.field_id);
              const value = report.manual_values[image.field_id]?.trim();
              return (
                <figure className="min-w-0" key={image.id}>
                  <button aria-label={`查看${field?.label ?? '现场'}大图`} className="block w-full overflow-hidden rounded-xl bg-slate-50" onClick={() => setViewer(image)} type="button">
                    <img alt="运营报告现场图片" className="aspect-square w-full object-contain" src={image.signedUrl} />
                  </button>
                  <figcaption className="mt-1 text-center text-xs text-slate-600">{field?.label ?? image.field_id}{value ? `：${value}${field?.unit ?? ''}` : ''}</figcaption>
                  <button className="ui-button-secondary mt-2 min-h-9 w-full px-2 py-1.5 text-xs" disabled={downloadingId === image.id} onClick={() => void download(image)} type="button">
                    <Download className="h-3.5 w-3.5" />{downloadingId === image.id ? '正在下载' : '下载保存'}
                  </button>
                </figure>
              );
            })}
          </div>
        </SectionCard>
      ) : null}

      {viewer ? (
        <div aria-label="运营报告现场图片大图" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4" onClick={() => setViewer(null)} role="dialog">
          <button aria-label="关闭大图" className="absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white" onClick={() => setViewer(null)} type="button"><X className="h-6 w-6" /></button>
          <img alt="运营报告现场图片大图" className="max-h-[82vh] max-w-full object-contain" onClick={(event) => event.stopPropagation()} src={viewer.signedUrl} />
          <button className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 font-bold text-slate-900 shadow-xl" disabled={downloadingId === viewer.id} onClick={(event) => { event.stopPropagation(); void download(viewer); }} type="button">
            <Download className="h-4 w-4" />{downloadingId === viewer.id ? '正在下载' : '下载原图'}
          </button>
        </div>
      ) : null}

      <ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone} />
    </PageShell>
  );
}
