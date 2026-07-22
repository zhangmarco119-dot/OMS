import { ChevronLeft, ChevronRight, Edit3, PackageCheck, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { PageShell } from '../components/layout/PageShell';
import { LoadingState, StatusBadge } from '../components/ui/Feedback';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import {
  loadArrivalReportDetail,
  reopenVoidedArrivalReport,
  type ArrivalReportDetail,
} from '../services/arrivals.service';

const employeeStatusLabel: Record<ArrivalReportDetail['report']['status'], string> = {
  draft: '草稿',
  submitted: '已上报',
  viewed: '已上报',
  voided: '已作废',
};

const formatTimestamp = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

export function ArrivalReportDetailPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { reportId = '' } = useParams();
  const [detail, setDetail] = useState<ArrivalReportDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !reportId) {
      setStatus('error');
      setMessage('无法加载到货记录。');
      return;
    }
    setStatus('loading');
    try {
      setDetail(await loadArrivalReportDetail(supabase, reportId));
      setMessage(null);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载到货记录失败。');
      setStatus('error');
    }
  }, [reportId]);

  useEffect(() => { void load(); }, [load]);

  const reopen = async () => {
    if (!supabase || !detail || busy) return;
    setBusy(true);
    try {
      await reopenVoidedArrivalReport(supabase, detail.report.id);
      window.dispatchEvent(new Event('storehub:arrivals-changed'));
      navigate(`/app/arrivals?reportId=${detail.report.id}`, { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法修改这条到货记录。');
    } finally {
      setBusy(false);
    }
  };

  const viewerIndex = detail && viewerUrl
    ? detail.images.findIndex((image) => image.signedUrl === viewerUrl)
    : -1;
  const changeViewerImage = (offset: number) => {
    if (!detail || viewerIndex < 0 || detail.images.length < 2) return;
    const nextIndex = (viewerIndex + offset + detail.images.length) % detail.images.length;
    setViewerUrl(detail.images[nextIndex].signedUrl);
  };

  const canReopen = detail?.report.status === 'voided'
    && detail.report.reported_by === auth.profile?.id;

  return (
    <PageShell eyebrow="门店运营系统" title="到货记录详情" backTo="/app/arrivals/history" contentGapClassName="gap-3">
      {status === 'loading' ? <LoadingState label="正在加载到货记录" /> : null}
      {status === 'error' ? <section className="ui-card p-5"><p className="text-sm text-red-700">{message}</p><button className="ui-button-secondary mt-4 w-full" onClick={() => void load()} type="button">重新加载</button></section> : null}
      {status === 'ready' && detail ? <>
        <section className="ui-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="text-xs font-bold text-brand-700">{detail.report.report_no}</p><h2 className="mt-1 text-lg font-bold text-slate-900">{detail.report.generated_summary}</h2></div>
            <StatusBadge tone={detail.report.status === 'voided' ? 'danger' : detail.report.status === 'draft' ? 'neutral' : 'success'}>{employeeStatusLabel[detail.report.status]}</StatusBadge>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Info label="上报人" value={detail.report.reporter_name_snapshot} />
            <Info label="到货时间" value={`${detail.report.arrival_date} ${detail.report.arrival_time?.slice(0, 5) ?? ''}`} />
            <Info label="配送方" value={detail.report.carrier_name || '—'} />
            <Info label="快递单号" value={detail.report.tracking_no || '—'} />
            <Info label="提交时间" value={formatTimestamp(detail.report.submitted_at)} />
          </dl>
          {detail.report.note ? <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">备注：{detail.report.note}</p> : null}
          {detail.report.void_reason ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700">作废原因：{detail.report.void_reason}</p> : null}
        </section>

        <ImageSection images={detail.images.filter((image) => image.image_type === 'waybill')} onView={setViewerUrl} title="快递面单照片" />

        <section className="ui-card p-4">
          <h2 className="font-bold text-slate-900">产品明细与拆包照片</h2>
          <div className="mt-3 space-y-3">{detail.items.map((item, index) => {
            const images = detail.images.filter((image) => image.image_type === 'goods' && image.arrival_item_id === item.id);
            return <article className="rounded-lg border border-slate-200 p-3" key={item.id}>
              <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-900">{index + 1}. {item.product_name_snapshot}</p>{item.note ? <p className="mt-1 text-xs text-slate-500">{item.note}</p> : null}</div><p className="shrink-0 font-bold text-brand-700">{item.quantity} {item.unit}</p></div>
              <div className="mt-3 grid grid-cols-3 gap-2">{images.map((image) => <button className="aspect-square overflow-hidden rounded-lg bg-slate-100" key={image.id} onClick={() => setViewerUrl(image.signedUrl)} type="button"><img alt={`${item.product_name_snapshot}拆包照片`} className="h-full w-full object-cover" src={image.signedUrl} /></button>)}</div>
            </article>;
          })}</div>
        </section>

        {detail.images.some((image) => image.image_type === 'goods' && !image.arrival_item_id)
          ? <ImageSection images={detail.images.filter((image) => image.image_type === 'goods' && !image.arrival_item_id)} onView={setViewerUrl} title="历史拆包照片" />
          : null}

        {canReopen ? <section className="ui-card p-4"><p className="text-sm leading-6 text-slate-600">这条上报已被管理员作废。修改后重新提交，管理员会收到新的到货上报。</p><button className="ui-button-primary mt-3 w-full" disabled={busy} onClick={() => void reopen()} type="button"><Edit3 className="h-5 w-5" aria-hidden="true" />{busy ? '正在打开草稿' : '修改并重新上报'}</button></section> : null}
      </> : null}

      {viewerUrl ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label="查看到货图片" onClick={() => setViewerUrl(null)}><button aria-label="关闭图片" className="absolute right-4 top-4 h-12 w-12 rounded-full bg-white/15 text-white" onClick={() => setViewerUrl(null)} type="button"><X className="mx-auto h-6 w-6" /></button>{detail && detail.images.length > 1 ? <><button aria-label="上一张图片" className="absolute left-3 h-12 w-12 rounded-full bg-white/15 text-white" onClick={(event) => { event.stopPropagation(); changeViewerImage(-1); }} type="button"><ChevronLeft className="mx-auto h-7 w-7" /></button><button aria-label="下一张图片" className="absolute right-3 h-12 w-12 rounded-full bg-white/15 text-white" onClick={(event) => { event.stopPropagation(); changeViewerImage(1); }} type="button"><ChevronRight className="mx-auto h-7 w-7" /></button></> : null}<img alt="到货大图" className="max-h-[85vh] max-w-full object-contain" onClick={(event) => event.stopPropagation()} src={viewerUrl} /></div> : null}
      <ActionFeedbackDialog message={message ?? ''} onClose={() => setMessage(null)} open={status !== 'error' && Boolean(message)} title="操作未完成" tone="danger" />
    </PageShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className="mt-1 font-medium text-slate-800">{value}</dd></div>;
}

function ImageSection({ images, onView, title }: { images: ArrivalReportDetail['images']; onView: (url: string) => void; title: string }) {
  return <section className="ui-card p-4"><div className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-brand-700" aria-hidden="true" /><h2 className="font-bold text-slate-900">{title}</h2></div>{images.length ? <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">{images.map((image) => <button className="aspect-square overflow-hidden rounded-lg bg-slate-100" key={image.id} onClick={() => onView(image.signedUrl)} type="button"><img alt={title} className="h-full w-full object-cover" src={image.signedUrl} /></button>)}</div> : <p className="mt-3 text-sm text-slate-500">没有图片。</p>}</section>;
}
