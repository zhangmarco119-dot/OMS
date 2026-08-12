import { Edit3, PackageCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { PageShell } from '../components/layout/PageShell';
import { FeedbackBanner, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { ImageViewer } from '../components/ui/ImageViewer';
import { ProgressiveImage } from '../components/ui/ProgressiveImage';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import {
  loadArrivalReportDetail,
  loadLatestArrivalCorrection,
  reopenVoidedArrivalReport,
  type ArrivalCorrectionRequest,
  type ArrivalReportDetail,
} from '../services/arrivals.service';
import { loadArrivalImageUrls } from '../services/arrival-images.service';

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
  const [searchParams] = useSearchParams();
  const { reportId = '' } = useParams();
  const [detail, setDetail] = useState<ArrivalReportDetail | null>(null);
  const [latestCorrection, setLatestCorrection] = useState<ArrivalCorrectionRequest | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [imagesLoading, setImagesLoading] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !reportId) {
      setStatus('error');
      setMessage('无法加载到货记录。');
      return;
    }
    setStatus('loading');
    try {
      const [nextDetail, correction] = await Promise.all([
        loadArrivalReportDetail(supabase, reportId),
        loadLatestArrivalCorrection(supabase, reportId),
      ]);
      setDetail(nextDetail);
      setLatestCorrection(correction);
      setMessage(null);
      setStatus('ready');
      setImagesLoading(nextDetail.images.length > 0);
      if (nextDetail.images.length > 0) {
        void loadArrivalImageUrls(supabase, nextDetail.images).then((urls) => {
          setDetail((current) => current ? { ...current, images: current.images.map((image) => ({ ...image, signedUrl: urls[image.id] ?? '' })) } : current);
        }).catch(() => undefined).finally(() => setImagesLoading(false));
      }
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

  const viewerImages = (detail?.images ?? []).flatMap((image) => image.signedUrl ? [{ alt: image.file_name || '到货图片', url: image.signedUrl }] : []);
  const openViewer = (url: string) => {
    const index = viewerImages.findIndex((image) => image.url === url);
    if (index >= 0) setViewerIndex(index);
  };

  const canReopen = detail?.report.status === 'voided'
    && detail.report.reported_by === auth.profile?.id;
  const canCorrect = Boolean(detail
    && ['submitted', 'viewed'].includes(detail.report.status)
    && detail.report.store_id === auth.store?.id
    && (auth.profile?.role === 'manager' || detail.report.reported_by === auth.profile?.id));
  const itemIds = new Set(detail?.items.map((item) => item.id) ?? []);
  const historicalGoodsImages = detail?.images.filter((image) => image.image_type === 'goods' && (!image.arrival_item_id || !itemIds.has(image.arrival_item_id))) ?? [];

  return (
    <PageShell eyebrow="门店运营系统" title="到货记录详情" backTo="/app/arrivals/history" contentGapClassName="gap-3">
      {status === 'loading' ? <LoadingState label="正在加载到货记录" /> : null}
      {status === 'error' ? <section className="ui-card p-5"><p className="text-sm text-red-700">{message}</p><button className="ui-button-secondary mt-4 w-full" onClick={() => void load()} type="button">重新加载</button></section> : null}
      {status === 'ready' && detail ? <>
        {searchParams.get('correction') === 'submitted' ? <FeedbackBanner title="更正申请已提交" tone="success">审核通过前，当前到货记录保持不变。你可以在这里查看最新审核状态。</FeedbackBanner> : null}
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

        <ImageSection images={detail.images.filter((image) => image.image_type === 'waybill')} imagesLoading={imagesLoading} onView={openViewer} title="快递面单照片" />

        <section className="ui-card p-4">
          <h2 className="font-bold text-slate-900">产品明细与拆包照片</h2>
          <div className="mt-3 space-y-3">{detail.items.map((item, index) => {
            const images = detail.images.filter((image) => image.image_type === 'goods' && image.arrival_item_id === item.id);
            return <article className="rounded-lg border border-slate-200 p-3" key={item.id}>
              <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-900">{index + 1}. {item.product_name_snapshot}</p>{item.note ? <p className="mt-1 text-xs text-slate-500">{item.note}</p> : null}</div><p className="shrink-0 font-bold text-brand-700">{item.quantity} {item.unit}</p></div>
              <div className="mt-3 grid grid-cols-3 gap-2">{images.map((image) => <button className="aspect-square overflow-hidden rounded-lg bg-slate-100" disabled={!image.signedUrl} key={image.id} onClick={() => image.signedUrl && openViewer(image.signedUrl)} type="button"><ProgressiveImage alt={`${item.product_name_snapshot}拆包照片`} className="h-full w-full object-cover" containerClassName="h-full w-full" resourceLoading={imagesLoading && !image.signedUrl} src={image.signedUrl} /></button>)}</div>
            </article>;
          })}</div>
        </section>

        {historicalGoodsImages.length > 0
          ? <ImageSection images={historicalGoodsImages} imagesLoading={imagesLoading} onView={openViewer} title="历史拆包照片" />
          : null}

        {canCorrect ? <section className="ui-card p-4">
          <div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-slate-900">更正到货信息</h2><p className="mt-1 text-sm leading-6 text-slate-600">{auth.profile?.role === 'manager' ? '店长可修改本店所有人的到货信息，提交后由管理员审核。' : '员工只能修改自己提交的记录，提交后由店长或管理员审核。'}</p></div>{latestCorrection ? <StatusBadge tone={latestCorrection.status === 'pending' ? 'warning' : latestCorrection.status === 'approved' ? 'success' : 'danger'}>{latestCorrection.status === 'pending' ? '更正待审核' : latestCorrection.status === 'approved' ? '更正已通过' : '更正被拒绝'}</StatusBadge> : null}</div>
          {latestCorrection?.review_note ? <FeedbackBanner className="mt-3" title="审核备注" tone={latestCorrection.status === 'rejected' ? 'danger' : 'info'}>{latestCorrection.review_note}</FeedbackBanner> : null}
          {latestCorrection?.status !== 'pending' ? <Link className="ui-button-secondary mt-3 w-full" to={`/app/arrivals/${detail.report.id}/correct`}><Edit3 className="h-5 w-5" />申请修改到货信息</Link> : <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">已有更正申请正在审核，暂时不能重复提交。</p>}
        </section> : null}

        {canReopen ? <section className="ui-card p-4"><p className="text-sm leading-6 text-slate-600">这条上报已被管理员作废。修改后重新提交，管理员会收到新的到货上报。</p><button className="ui-button-primary mt-3 w-full" disabled={busy} onClick={() => void reopen()} type="button"><Edit3 className="h-5 w-5" aria-hidden="true" />{busy ? '正在打开草稿' : '修改并重新上报'}</button></section> : null}
      </> : null}

      {viewerIndex != null ? <ImageViewer activeIndex={viewerIndex} images={viewerImages} label="查看到货图片" onClose={() => setViewerIndex(null)} onIndexChange={setViewerIndex} /> : null}
      <ActionFeedbackDialog message={message ?? ''} onClose={() => setMessage(null)} open={status !== 'error' && Boolean(message)} title="操作未完成" tone="danger" />
    </PageShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className="mt-1 font-medium text-slate-800">{value}</dd></div>;
}

function ImageSection({ images, imagesLoading, onView, title }: { images: ArrivalReportDetail['images']; imagesLoading: boolean; onView: (url: string) => void; title: string }) {
  return <section className="ui-card p-4"><div className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-brand-700" aria-hidden="true" /><h2 className="font-bold text-slate-900">{title}</h2></div>{images.length ? <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">{images.map((image) => <button className="aspect-square overflow-hidden rounded-lg bg-slate-100" disabled={!image.signedUrl} key={image.id} onClick={() => onView(image.signedUrl)} type="button"><ProgressiveImage alt={title} className="h-full w-full object-cover" containerClassName="h-full w-full" resourceLoading={imagesLoading && !image.signedUrl} src={image.signedUrl} /></button>)}</div> : <p className="mt-3 text-sm text-slate-500">没有图片。</p>}</section>;
}
