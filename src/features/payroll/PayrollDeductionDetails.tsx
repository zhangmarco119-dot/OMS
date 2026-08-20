import { ChevronRight, ReceiptText, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ImageViewer } from '../../components/ui/ImageViewer';
import { ProgressiveImage } from '../../components/ui/ProgressiveImage';
import { supabase } from '../../lib/supabase';
import { loadPayrollDeductionItems, loadPayrollPenaltyAssets, loadPayrollPenaltyAssetUrl, type PayrollPenaltyAsset } from '../../services/payroll.service';
import { formatMoney, type PayrollDeductionItem, type PayrollEstimate } from './model';

const formatDate = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(date);
};

export function PayrollDeductionRow({ detailsTitle = '扣款明细', emptyMessage = '本期没有扣款记录。', estimate, label, total }: { detailsTitle?: string; emptyMessage?: string; estimate: PayrollEstimate; label: string; total: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PayrollDeductionItem[]>(estimate.deductionItems ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [evidenceAssets, setEvidenceAssets] = useState<PayrollPenaltyAsset[] | null>(null);
  const [evidenceError, setEvidenceError] = useState(false);
  const [evidenceUrls, setEvidenceUrls] = useState<Record<string, string | null>>({});
  const [activeEvidenceIndex, setActiveEvidenceIndex] = useState<number | null>(null);
  useEffect(() => {
    setItems(estimate.deductionItems ?? []);
    setError('');
    setOpen(false);
  }, [estimate.asOf, estimate.deductionItems, estimate.profileId]);

  useEffect(() => {
    if (!open || !supabase) return;
    const client = supabase;
    const penaltyIds = items
      .filter((item) => item.type === 'penalty' && item.id.startsWith('penalty:'))
      .map((item) => item.id.slice('penalty:'.length));
    if (!penaltyIds.length) {
      setEvidenceAssets([]);
      setEvidenceError(false);
      return;
    }
    let cancelled = false;
    setEvidenceAssets(null);
    setEvidenceError(false);
    setEvidenceUrls({});
    void loadPayrollPenaltyAssets(client, penaltyIds).then((assets) => {
      if (cancelled) return;
      setEvidenceAssets(assets);
      for (const asset of assets) {
        void loadPayrollPenaltyAssetUrl(client, asset).then((url) => {
          if (!cancelled) setEvidenceUrls((current) => ({ ...current, [asset.id]: url }));
        }).catch(() => {
          if (!cancelled) setEvidenceUrls((current) => ({ ...current, [asset.id]: null }));
        });
      }
    }).catch(() => {
      if (!cancelled) {
        setEvidenceAssets([]);
        setEvidenceError(true);
      }
    });
    return () => { cancelled = true; };
  }, [items, open]);

  const show = async () => {
    setOpen(true); setError('');
    if (items.length || !supabase) return;
    setLoading(true);
    try { setItems(await loadPayrollDeductionItems(supabase, estimate.profileId, estimate.monthStart, estimate.asOf || estimate.monthEnd)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '暂时无法加载扣款明细。'); }
    finally { setLoading(false); }
  };

  const readyEvidence = (evidenceAssets ?? []).filter((asset) => Boolean(evidenceUrls[asset.id])).map((asset) => ({ alt: asset.file_name, url: evidenceUrls[asset.id] as string }));

  return <>
    <button className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-slate-100 py-2.5 text-left text-sm" onClick={() => void show()} type="button">
      <span><b className="text-slate-700">{label}</b><small className="mt-0.5 block text-xs text-slate-500">点击查看扣款时间和原因</small></span>
      <span className="flex items-center gap-1"><b className="tabular-nums text-rose-700">{total ? `-${formatMoney(total)}` : formatMoney(0)}</b><ChevronRight className="h-4 w-4 text-slate-400" /></span>
    </button>
    {open ? <div aria-modal="true" className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 p-3 sm:items-center" role="dialog">
      <section className="max-h-[78vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl">
        <header className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-700"><ReceiptText className="h-5 w-5" /></span><div><h3 className="font-bold text-slate-900">{detailsTitle}</h3><p className="text-xs text-slate-500">{estimate.displayName} · 合计 {formatMoney(total)}</p></div></div><button aria-label={`关闭${detailsTitle}`} className="ui-icon-button" onClick={() => setOpen(false)} type="button"><X className="h-5 w-5" /></button></header>
        {loading ? <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">正在加载扣款明细……</p> : null}
        {error ? <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        {!loading && !error && !items.length ? <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{emptyMessage}</p> : null}
        <div className="mt-4 space-y-2">{items.map((item) => {
          const penaltyId = item.type === 'penalty' && item.id.startsWith('penalty:') ? item.id.slice('penalty:'.length) : null;
          const assets = penaltyId ? (evidenceAssets ?? []).filter((asset) => asset.penalty_id === penaltyId) : [];
          return <article className="rounded-xl border border-slate-200 p-3" key={item.id}><div className="flex items-start justify-between gap-3"><div><b className="text-sm text-slate-900">{item.title}</b><p className="mt-1 text-xs text-slate-500">{formatDate(item.date)}</p></div><b className="shrink-0 text-sm tabular-nums text-rose-700">-{formatMoney(item.amount)}</b></div><p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-sm leading-5 text-slate-700">{item.reason || '未填写扣款原因'}</p>{penaltyId && evidenceAssets === null ? <ProgressiveImage alt="处罚图片" containerClassName="mt-2 aspect-[4/3] w-full rounded-lg" resourceLoading /> : null}{penaltyId && evidenceError ? <ProgressiveImage alt="处罚图片" containerClassName="mt-2 aspect-[4/3] w-full rounded-lg" /> : null}{assets.length ? <div className="mt-2 grid grid-cols-3 gap-2">{assets.map((asset) => {
            const url = evidenceUrls[asset.id];
            return <button aria-label={`查看罚单图片 ${asset.file_name}`} className="block" disabled={!url} key={asset.id} onClick={() => {
              const index = readyEvidence.findIndex((entry) => entry.url === url);
              if (index >= 0) setActiveEvidenceIndex(index);
            }} type="button"><ProgressiveImage alt={asset.file_name} className="aspect-square h-full w-full object-cover" containerClassName="aspect-square w-full rounded-lg" resourceLoading={url === undefined} src={url} /></button>;
          })}</div> : null}</article>;
        })}</div>
        <button className="ui-button-primary mt-4 w-full" onClick={() => setOpen(false)} type="button">关闭</button>
      </section>
    </div> : null}
    {activeEvidenceIndex !== null ? <ImageViewer activeIndex={activeEvidenceIndex} images={readyEvidence} label="罚单图片预览" onClose={() => setActiveEvidenceIndex(null)} onIndexChange={setActiveEvidenceIndex} /> : null}
  </>;
}
