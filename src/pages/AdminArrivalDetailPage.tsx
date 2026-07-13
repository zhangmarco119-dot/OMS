import { ChevronLeft, ChevronRight, Download, Eye, FileDown, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
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
  markAdminArrivalViewed,
  voidAdminArrival,
  type AdminArrivalDetail,
} from '../services/admin-arrivals.service';

const auditLabel: Record<string, string> = {
  arrival_report_submitted: '提交到货上报',
  arrival_report_viewed: '管理员标记查看',
  arrival_report_voided: '管理员作废记录',
};

export function AdminArrivalDetailPage() {
  const { reportId = '' } = useParams();
  const [detail, setDetail] = useState<AdminArrivalDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !reportId) {
      setStatus('error');
      setMessage('无法加载到货详情。');
      return;
    }
    setStatus('loading');
    try {
      setDetail(await loadAdminArrivalDetail(supabase, reportId));
      setStatus('ready');
      setMessage(null);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '加载到货详情失败。');
    }
  }, [reportId]);

  useEffect(() => { void load(); }, [load]);

  const markViewed = async () => {
    if (!supabase || !detail) return;
    setBusy(true);
    try {
      await markAdminArrivalViewed(supabase, detail.report.id);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '标记查看失败。');
    } finally {
      setBusy(false);
    }
  };

  const confirmVoid = async () => {
    if (!supabase || !detail) return;
    if (!voidReason.trim()) {
      setMessage('请填写作废原因。');
      return;
    }
    if (!window.confirm(`再次确认作废到货单 ${detail.report.report_no}？作废后不会计入每日汇总。`)) return;
    setBusy(true);
    try {
      if (detail.report.status === 'submitted') await markAdminArrivalViewed(supabase, detail.report.id);
      await voidAdminArrival(supabase, detail.report.id, voidReason);
      setShowVoidDialog(false);
      setVoidReason('');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '作废到货单失败。');
    } finally {
      setBusy(false);
    }
  };

  const exportReport = () => {
    if (detail) downloadArrivalExport(createArrivalReportExport(detail));
  };

  const viewerIndex = detail && viewerUrl
    ? detail.images.findIndex((image) => image.signedUrl === viewerUrl)
    : -1;
  const changeViewerImage = (offset: number) => {
    if (!detail || viewerIndex < 0 || detail.images.length < 2) return;
    const nextIndex = (viewerIndex + offset + detail.images.length) % detail.images.length;
    setViewerUrl(detail.images[nextIndex].signedUrl);
  };

  return (
    <PageShell eyebrow="门店运营系统 · 管理员" title="到货详情" backTo="/app/admin/arrivals">
      {message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}
      {status === 'loading' ? <p className="rounded-lg bg-white p-5 font-semibold text-slate-600 shadow-sm">正在加载到货详情</p> : null}
      {status === 'ready' && detail ? <>
        <section className="rounded-lg bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-brand-700">{detail.report.report_no}</p><h2 className="mt-1 text-xl font-bold text-slate-900">{detail.report.store_name_snapshot}</h2></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${arrivalStatusClass[detail.report.status]}`}>{arrivalStatusLabel[detail.report.status]}</span></div>
          <p className="mt-4 rounded-lg bg-brand-50 p-4 font-semibold leading-7 text-brand-900">{detail.report.generated_summary}</p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
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

        <ImageGroup images={detail.images.filter((image) => image.image_type === 'waybill')} onView={setViewerUrl} title="面单照片" />
        <ImageGroup images={detail.images.filter((image) => image.image_type === 'goods')} onView={setViewerUrl} title="货品照片" />

        <section className="rounded-lg bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">产品明细</h2><div className="mt-3 divide-y divide-slate-100">{detail.items.map((item, index) => <div className="flex items-start justify-between gap-4 py-3" key={item.id}><div><p className="font-semibold text-slate-900">{index + 1}. {item.product_name_snapshot}</p>{item.note ? <p className="mt-1 text-xs text-slate-500">{item.note}</p> : null}{item.is_unmatched_product ? <span className="mt-1 inline-block rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">未匹配商品</span> : null}</div><p className="shrink-0 font-bold text-brand-700">{item.quantity} {item.unit}</p></div>)}</div></section>

        <section className="rounded-lg bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">操作日志</h2>{detail.auditLogs.length ? <ol className="mt-3 space-y-3">{detail.auditLogs.map((log) => <li className="border-l-2 border-brand-200 pl-3 text-sm" key={log.id}><p className="font-semibold text-slate-800">{auditLabel[log.action] ?? log.action}</p><p className="mt-1 text-xs text-slate-500">{formatTimestamp(log.created_at)}</p></li>)}</ol> : <p className="mt-3 text-sm text-slate-500">暂无操作日志。</p>}</section>

        <section className="grid gap-3 rounded-lg bg-white p-4 shadow-sm sm:grid-cols-3">
          {detail.report.status === 'submitted' ? <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void markViewed()} type="button"><Eye className="h-5 w-5" />标记已查看</button> : null}
          <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 font-bold text-slate-800" onClick={exportReport} type="button"><FileDown className="h-5 w-5" />导出记录</button>
          {detail.report.status !== 'voided' ? <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-red-200 px-4 font-bold text-red-700" disabled={busy} onClick={() => setShowVoidDialog(true)} type="button"><Trash2 className="h-5 w-5" />作废</button> : null}
        </section>
      </> : null}

      {viewerUrl ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label="查看到货图片"><button aria-label="关闭图片" className="absolute right-4 top-4 h-12 w-12 rounded-full bg-white/15 text-white" onClick={() => setViewerUrl(null)} type="button"><X className="mx-auto h-6 w-6" /></button>{detail && detail.images.length > 1 ? <><button aria-label="上一张图片" className="absolute left-3 h-12 w-12 rounded-full bg-white/15 text-white" onClick={() => changeViewerImage(-1)} type="button"><ChevronLeft className="mx-auto h-7 w-7" /></button><button aria-label="下一张图片" className="absolute right-3 h-12 w-12 rounded-full bg-white/15 text-white" onClick={() => changeViewerImage(1)} type="button"><ChevronRight className="mx-auto h-7 w-7" /></button><p className="absolute bottom-4 rounded-full bg-black/50 px-3 py-1 text-sm text-white">{viewerIndex + 1} / {detail.images.length}</p></> : null}<img alt="到货大图" className="max-h-[85vh] max-w-full object-contain" src={viewerUrl} /></div> : null}
      {showVoidDialog ? <div className="ui-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="void-title"><div className="ui-dialog-panel max-w-md p-5"><h2 className="text-lg font-bold" id="void-title">作废到货记录</h2><p className="mt-2 text-sm text-slate-600">作废后记录仍保留，但不会计入每日汇总。</p><label className="mt-4 block text-sm font-semibold">作废原因<textarea className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 p-3" onChange={(event) => setVoidReason(event.target.value)} value={voidReason} /></label><div className="mt-4 grid grid-cols-2 gap-3"><button className="min-h-11 rounded-lg border border-slate-200 font-bold" onClick={() => setShowVoidDialog(false)} type="button">取消</button><button className="min-h-11 rounded-lg bg-red-600 font-bold text-white" disabled={busy} onClick={() => void confirmVoid()} type="button">继续作废</button></div></div></div> : null}
    </PageShell>
  );
}

function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className="mt-1 font-medium text-slate-800">{value}</dd></div>; }

function ImageGroup({ images, onView, title }: { images: AdminArrivalDetail['images']; onView: (url: string) => void; title: string }) {
  return <section className="rounded-lg bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">{title}</h2>{images.length ? <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{images.map((image) => <div key={image.id}><button className="block aspect-square w-full overflow-hidden rounded-lg bg-slate-100" onClick={() => onView(image.signedUrl)} type="button"><img alt={title} className="h-full w-full object-cover" src={image.signedUrl} /></button><a className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-1 rounded-md border border-slate-200 text-xs font-bold text-slate-700" download={image.file_name} href={image.signedUrl}><Download className="h-3.5 w-3.5" />下载</a></div>)}</div> : <p className="mt-3 text-sm text-slate-500">没有图片。</p>}</section>;
}
