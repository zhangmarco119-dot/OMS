import { Download, FileDown, LoaderCircle, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { ConfirmDialog } from '../components/ui/Actions';
import { ImageViewer } from '../components/ui/ImageViewer';
import { AiEntityReviewPanel } from '../features/ai-review/AiEntityReviewPanel';
import { buildAiArrivalDraftPatch } from '../features/ai-review/arrivalAiDraftPatch';
import { isAiWorkflowEnabledForStore } from '../features/ai-review/pilot';
import { useAiPilotSettings } from '../features/ai-review/useAiPilotSettings';
import {
  arrivalStatusClass,
  arrivalStatusLabel,
  formatArrivalDateTime,
  formatTimestamp,
} from '../features/arrivals/adminArrivalFormat';
import { createArrivalReportExport, downloadArrivalExport } from '../features/export/arrivalExport';
import { supabase } from '../lib/supabase';
import {
  loadAdminArrivalDetail,
  loadAdminArrivalImageUrls,
  markAdminArrivalViewed,
  voidAdminArrival,
  type AdminArrivalDetail,
} from '../services/admin-arrivals.service';

const auditLabel: Record<string, string> = {
  arrival_report_submitted: '提交到货上报',
  arrival_report_viewed: '管理员标记查看',
  arrival_report_voided: '管理员作废记录',
  arrival_report_reopened: '员工打开修改',
  arrival_report_admin_updated: '管理员修改到货信息',
};

export function AdminArrivalDetailPage() {
  const navigate = useNavigate();
  const aiPilot = useAiPilotSettings();
  const { reportId = '' } = useParams();
  const [detail, setDetail] = useState<AdminArrivalDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageUrlsLoading, setImageUrlsLoading] = useState(false);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    if (!supabase || !reportId) {
      setStatus('error');
      setMessage('无法加载到货详情。');
      return;
    }
    setStatus('loading');
    try {
      const nextDetail = await loadAdminArrivalDetail(supabase, reportId);
      if (sequence !== loadSequence.current) return;
      setDetail(nextDetail);
      setStatus('ready');
      setMessage(null);
      setImageUrlsLoading(nextDetail.images.length > 0);

      void loadAdminArrivalImageUrls(supabase, nextDetail.images).then((urls) => {
        if (sequence !== loadSequence.current) return;
        setDetail((current) => current?.report.id === reportId ? {
          ...current,
          images: current.images.map((image) => ({ ...image, signedUrl: urls[image.id] ?? '' })),
        } : current);
      }).catch(() => {
        // Individual image failures are rendered inside their own tiles.
      }).finally(() => {
        if (sequence === loadSequence.current) setImageUrlsLoading(false);
      });

      if (nextDetail.report.status === 'submitted') {
        void markAdminArrivalViewed(supabase, reportId).then(() => {
          if (sequence !== loadSequence.current) return;
          setDetail((current) => current?.report.id === reportId ? {
            ...current,
            report: { ...current.report, status: 'viewed', viewed_at: current.report.viewed_at ?? new Date().toISOString() },
          } : current);
          window.dispatchEvent(new Event('storehub:arrivals-changed'));
        }).catch((error) => {
          if (sequence === loadSequence.current) setMessage(error instanceof Error ? error.message : '标记到货记录已读失败。');
        });
      }
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '加载到货详情失败。');
    }
  }, [reportId]);

  useEffect(() => { void load(); }, [load]);

  const confirmVoid = async () => {
    if (!supabase || !detail) return;
    if (!voidReason.trim()) {
      setMessage('请填写作废原因。');
      return;
    }
    setShowVoidConfirm(true);
  };

  const voidReport = async () => {
    if (!supabase || !detail) return;
    setShowVoidConfirm(false);
    setBusy(true);
    try {
      if (detail.report.status === 'submitted') await markAdminArrivalViewed(supabase, detail.report.id);
      await voidAdminArrival(supabase, detail.report.id, voidReason);
      window.dispatchEvent(new Event('storehub:arrivals-changed'));
      setShowVoidDialog(false);
      setVoidReason('');
      await load();
      setMessage('到货记录已作废，不再计入到货汇总。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '作废到货单失败。');
    } finally {
      setBusy(false);
    }
  };

  const exportReport = () => {
    if (detail) downloadArrivalExport(createArrivalReportExport(detail));
  };

  const viewerImages = (detail?.images ?? []).flatMap((image) => image.signedUrl ? [{ alt: image.file_name || '到货图片', url: image.signedUrl }] : []);
  const aiReviewEnabled = Boolean(detail && isAiWorkflowEnabledForStore(aiPilot.settings, detail.report.store_id, 'arrival_report'));
  const aiApplyEnabled = Boolean(detail && isAiWorkflowEnabledForStore(aiPilot.settings, detail.report.store_id, 'arrival_report', true));
  const openViewer = (url: string) => {
    const index = viewerImages.findIndex((image) => image.url === url);
    if (index >= 0) setViewerIndex(index);
  };

  return (
    <PageShell eyebrow="门店运营系统 · 管理员" title="到货详情" backTo="/app/admin/arrivals">
      {status === 'error' && message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}
      {status === 'loading' ? <p className="rounded-lg bg-white p-5 font-semibold text-slate-600 shadow-sm">正在加载到货详情</p> : null}
      {status === 'ready' && detail ? <>
        <section className="rounded-lg bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-brand-700">{detail.report.report_no}</p><h2 className="mt-1 truncate text-lg font-bold leading-6 text-slate-900">{detail.report.store_name_snapshot}</h2></div><span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold leading-none ${arrivalStatusClass[detail.report.status]}`}>{arrivalStatusLabel[detail.report.status]}</span></div>
          <p className="mt-4 rounded-lg bg-brand-50 p-4 font-semibold leading-7 text-brand-900">{detail.report.generated_summary}</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3">
            <Info label="提交人" value={detail.report.reporter_name_snapshot} />
            <Info label="到货时间" value={formatArrivalDateTime(detail.report.arrival_date, detail.report.arrival_time)} />
            <Info label="配送方" value={detail.report.carrier_name || '—'} />
            <Info label="快递单号" value={detail.report.tracking_no || '—'} />
            <Info label="创建时间" value={formatTimestamp(detail.report.created_at)} />
            <Info label="提交时间" value={formatTimestamp(detail.report.submitted_at)} />
            <Info label="查看时间" value={formatTimestamp(detail.report.viewed_at)} />
            <Info label="作废时间" value={formatTimestamp(detail.report.voided_at)} />
          </dl>
          {detail.report.note ? <div className="mt-4 border-t border-slate-100 pt-4"><p className="text-xs font-semibold text-slate-500">备注</p><p className="mt-1 text-sm leading-6 text-slate-800">{detail.report.note}</p></div> : null}
          {detail.report.void_reason ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">作废原因：{detail.report.void_reason}</p> : null}
        </section>

        <AiEntityReviewPanel
          applyLabel="带入更正草稿"
          autoRunEnabled={Boolean(aiPilot.settings?.autoRunEnabled)}
          canAdopt={(suggestion) => buildAiArrivalDraftPatch(suggestion, suggestion.draftPatch) !== null}
          enabled={aiReviewEnabled}
          entityId={detail.report.id}
          onAdopt={aiApplyEnabled ? (suggestion, result, modifiedValue) => navigate(`/app/arrivals/${detail.report.id}/correct`, {
            state: {
              aiDraftPatch: buildAiArrivalDraftPatch(suggestion, Object.keys(result.draftPatch).length ? result.draftPatch : suggestion.draftPatch),
              aiModifiedValue: modifiedValue,
              aiSuggestionId: suggestion.id,
            },
          }) : undefined}
          storeId={detail.report.store_id}
          workflow="arrival_report"
        />

        <ImageGroup images={detail.images.filter((image) => image.image_type === 'waybill')} loading={imageUrlsLoading} onView={openViewer} title="面单照片" />

        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="font-bold text-slate-900">产品明细与拆包照片</h2>
          <div className="mt-3 space-y-3">
            {detail.items.map((item, index) => {
              const itemImages = detail.images.filter((image) => image.image_type === 'goods' && image.arrival_item_id === item.id);
              return <article className="rounded-lg border border-slate-200 p-3" key={item.id}>
                <div className="flex items-start justify-between gap-4">
                  <div><p className="font-semibold text-slate-900">{index + 1}. {item.product_name_snapshot}</p>{item.note ? <p className="mt-1 text-xs text-slate-500">{item.note}</p> : null}{item.is_unmatched_product ? <span className="mt-1 inline-block rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">未匹配货品</span> : null}</div>
                  <p className="shrink-0 font-bold text-brand-700">{item.quantity} {item.unit}</p>
                </div>
                <ProductImageGrid images={itemImages} loading={imageUrlsLoading} onView={openViewer} productName={item.product_name_snapshot} />
              </article>;
            })}
          </div>
        </section>

        {detail.images.some((image) => image.image_type === 'goods' && !image.arrival_item_id)
          ? <ImageGroup images={detail.images.filter((image) => image.image_type === 'goods' && !image.arrival_item_id)} loading={imageUrlsLoading} onView={openViewer} title="历史货品照片（未关联具体产品）" />
          : null}

        <section className="rounded-lg bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">操作日志</h2>{detail.auditLogs.length ? <ol className="mt-3 space-y-3">{detail.auditLogs.map((log) => <li className="border-l-2 border-brand-200 pl-3 text-sm" key={log.id}><p className="font-semibold text-slate-800">{auditLabel[log.action] ?? log.action}</p><p className="mt-1 text-xs text-slate-500">{formatTimestamp(log.created_at)}</p></li>)}</ol> : <p className="mt-3 text-sm text-slate-500">暂无操作日志。</p>}</section>

        <section className="grid gap-3 rounded-lg bg-white p-4 shadow-sm sm:grid-cols-3">
          {detail.report.status !== 'voided' ? <Link className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-brand-200 px-4 font-bold text-brand-700" to={`/app/arrivals/${detail.report.id}/correct`}><Pencil className="h-5 w-5" />修改信息</Link> : null}
          <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 font-bold text-slate-800" onClick={exportReport} type="button"><FileDown className="h-5 w-5" />导出记录</button>
          {detail.report.status !== 'voided' ? <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-red-200 px-4 font-bold text-red-700" disabled={busy} onClick={() => setShowVoidDialog(true)} type="button"><Trash2 className="h-5 w-5" />作废</button> : null}
        </section>
      </> : null}

      {viewerIndex != null ? <ImageViewer activeIndex={viewerIndex} images={viewerImages} label="查看到货图片" onClose={() => setViewerIndex(null)} onIndexChange={setViewerIndex} /> : null}
      {showVoidDialog ? <div className="ui-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="void-title"><div className="ui-dialog-panel max-w-md p-5"><h2 className="text-lg font-bold" id="void-title">作废到货记录</h2><p className="mt-2 text-sm text-slate-600">作废后记录仍保留，但不会计入每日汇总。</p><label className="mt-4 block text-sm font-semibold">作废原因<textarea className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 p-3" onChange={(event) => setVoidReason(event.target.value)} value={voidReason} /></label><div className="mt-4 grid grid-cols-2 gap-3"><button className="min-h-11 rounded-lg border border-slate-200 font-bold" onClick={() => setShowVoidDialog(false)} type="button">取消</button><button className="min-h-11 rounded-lg bg-red-600 font-bold text-white" disabled={busy} onClick={() => void confirmVoid()} type="button">继续作废</button></div></div></div> : null}
      <ConfirmDialog confirmLabel="确认作废" danger onCancel={() => setShowVoidConfirm(false)} onConfirm={() => void voidReport()} open={showVoidConfirm} title="再次确认作废"><p>确定作废到货单 {detail?.report.report_no} 吗？作废后该记录不会计入到货汇总。</p></ConfirmDialog>
      <ActionFeedbackDialog message={message ?? ''} onClose={() => setMessage(null)} open={status !== 'error' && Boolean(message)} title={message?.includes('已标记') || message?.includes('已作废') ? '操作成功' : message?.includes('请填写') ? '请完善作废信息' : '操作未完成'} tone={message?.includes('已标记') || message?.includes('已作废') ? 'success' : message?.includes('请填写') ? 'warning' : 'danger'} />
    </PageShell>
  );
}

function Info({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="text-[11px] font-semibold leading-4 text-slate-500">{label}</dt><dd className="mt-0.5 break-words text-[13px] font-medium leading-5 text-slate-800">{value}</dd></div>; }

function ImageGroup({ images, loading, onView, title }: { images: AdminArrivalDetail['images']; loading: boolean; onView: (url: string) => void; title: string }) {
  return <section className="rounded-lg bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">{title}</h2>{images.length ? <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{images.map((image) => <ArrivalImageTile alt={title} downloadable image={image} key={image.id} loading={loading} onView={onView} />)}</div> : <p className="mt-3 text-sm text-slate-500">没有图片。</p>}</section>;
}

function ProductImageGrid({ images, loading, onView, productName }: { images: AdminArrivalDetail['images']; loading: boolean; onView: (url: string) => void; productName: string }) {
  if (!images.length) return <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-500">该产品没有关联照片。</p>;
  return <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">{images.map((image) => <ArrivalImageTile alt={`${productName}拆包照片`} image={image} key={image.id} loading={loading} onView={onView} />)}</div>;
}

function ArrivalImageTile({ alt, downloadable = false, image, loading, onView }: { alt: string; downloadable?: boolean; image: AdminArrivalDetail['images'][number]; loading: boolean; onView: (url: string) => void }) {
  const [browserState, setBrowserState] = useState<'loading' | 'ready' | 'error'>(image.signedUrl ? 'loading' : 'error');
  useEffect(() => setBrowserState(image.signedUrl ? 'loading' : 'error'), [image.signedUrl]);
  const waitingForUrl = loading && !image.signedUrl;
  const failed = !waitingForUrl && (!image.signedUrl || browserState === 'error');
  const ready = Boolean(image.signedUrl) && browserState === 'ready';
  return <div>
    <button className="relative block aspect-square w-full overflow-hidden rounded-lg bg-slate-100" disabled={!ready} onClick={() => { if (image.signedUrl) onView(image.signedUrl); }} type="button">
      {image.signedUrl ? <img alt={alt} className={`h-full w-full object-cover transition-opacity ${ready ? 'opacity-100' : 'opacity-0'}`} onError={() => setBrowserState('error')} onLoad={() => setBrowserState('ready')} src={image.signedUrl} /> : null}
      {waitingForUrl || browserState === 'loading' ? <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 text-center text-xs font-semibold text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin text-brand-600" />正在加载图片</span> : null}
      {failed ? <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-xs font-semibold text-slate-500">图片加载失败</span> : null}
    </button>
    {downloadable ? image.signedUrl && ready ? <a className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-1 rounded-md border border-slate-200 text-xs font-bold text-slate-700" download={image.file_name} href={image.signedUrl}><Download className="h-3.5 w-3.5" />下载</a> : <span className="mt-2 inline-flex min-h-9 w-full items-center justify-center rounded-md border border-slate-100 text-xs font-semibold text-slate-400">{failed ? '暂不可下载' : '图片加载中'}</span> : null}
  </div>;
}
