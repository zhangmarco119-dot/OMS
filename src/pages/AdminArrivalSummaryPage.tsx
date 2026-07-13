import { FileDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { createArrivalSummaryExport, downloadArrivalExport } from '../features/export/arrivalExport';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadAdminArrivalSummary, localIsoDate, type AdminArrivalSummary } from '../services/admin-arrivals.service';

type SummaryTab = 'details' | 'products';

export function AdminArrivalSummaryPage() {
  const auth = useAuth();
  const [dateMode, setDateMode] = useState<'day' | 'range'>('day');
  const [date, setDate] = useState(localIsoDate());
  const [dateFrom, setDateFrom] = useState(localIsoDate());
  const [dateTo, setDateTo] = useState(localIsoDate());
  const [storeId, setStoreId] = useState('');
  const [tab, setTab] = useState<SummaryTab>('details');
  const [summary, setSummary] = useState<AdminArrivalSummary>({ details: [], products: [] });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage('需要配置 Supabase 才能加载每日汇总。'); return; }
    setStatus('loading');
    try {
      const range = dateMode === 'day' ? { dateFrom: date, dateTo: date } : { dateFrom, dateTo };
      if (range.dateFrom > range.dateTo) throw new Error('开始日期不能晚于结束日期。');
      setSummary(await loadAdminArrivalSummary(supabase, range, storeId)); setStatus('ready'); setMessage(null);
    }
    catch (error) { setStatus('error'); setMessage(error instanceof Error ? error.message : '加载每日汇总失败。'); }
  }, [date, dateFrom, dateMode, dateTo, storeId]);
  useEffect(() => { void load(); }, [load]);

  const metrics = useMemo(() => ({
    products: summary.products.length,
    reports: new Set(summary.details.map((row) => row.report_id).filter(Boolean)).size,
    stores: new Set(summary.details.map((row) => row.store_id).filter(Boolean)).size,
    units: summary.details.reduce((total, row) => total + (Number(row.quantity) || 0), 0),
  }), [summary]);

  const exportLabel = dateMode === 'day' ? date : `${dateFrom}至${dateTo}`;
  return <PageShell eyebrow="门店运营系统 · 管理员" title="到货中心" backTo="/app/admin/arrivals">
    <section className="rounded-lg bg-white p-4 shadow-sm"><div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"><button className={`min-h-10 rounded-md text-sm font-bold ${dateMode === 'day' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setDateMode('day')} type="button">选择某日</button><button className={`min-h-10 rounded-md text-sm font-bold ${dateMode === 'range' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setDateMode('range')} type="button">选择时间区间</button></div><div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">{dateMode === 'day' ? <label className="text-sm font-semibold text-slate-700">日期<input className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3" onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label> : <><label className="text-sm font-semibold text-slate-700">开始日期<input className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3" onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} /></label><label className="text-sm font-semibold text-slate-700">结束日期<input className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3" onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} /></label></>}<label className="text-sm font-semibold text-slate-700">门店<select className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3" onChange={(event) => setStoreId(event.target.value)} value={storeId}><option value="">全部门店</option>{auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><button className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white disabled:opacity-40" disabled={status !== 'ready' || summary.details.length === 0} onClick={() => downloadArrivalExport(createArrivalSummaryExport(summary, exportLabel))} type="button"><FileDown className="h-5 w-5" />导出 Excel</button></div></section>
    {message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}
    {status === 'loading' ? <p className="rounded-lg bg-white p-5 font-semibold text-slate-600 shadow-sm">正在汇总到货数据</p> : null}
    {status === 'ready' ? <>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="上报数" value={metrics.reports} /><Metric label="到货门店" value={metrics.stores} /><Metric label="产品种类" value={metrics.products} /><Metric label="明细数量合计" value={Number(metrics.units.toFixed(3))} /></section>
      <section className="rounded-lg bg-white p-4 shadow-sm"><div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1"><button className={`min-h-10 rounded-md font-bold ${tab === 'details' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setTab('details')} type="button">到货明细</button><button className={`min-h-10 rounded-md font-bold ${tab === 'products' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setTab('products')} type="button">产品汇总</button></div></section>
      {tab === 'details' ? <DetailSummary rows={summary.details} /> : <ProductSummary rows={summary.products} />}
    </> : null}
  </PageShell>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-white p-4 shadow-sm"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{value}</p></div>; }

function DetailSummary({ rows }: { rows: AdminArrivalSummary['details'] }) { if (!rows.length) return <Empty />; return <><div className="space-y-3 md:hidden">{rows.map((row) => <article className="rounded-lg bg-white p-4 shadow-sm" key={row.item_id}><div className="flex justify-between gap-3"><h3 className="font-bold">{row.product_name_snapshot}</h3><p className="font-bold text-brand-700">{row.quantity} {row.unit}</p></div><p className="mt-2 text-sm text-slate-500">{row.store_name_snapshot} · {row.arrival_time?.slice(0, 5) ?? ''}</p><p className="mt-1 text-xs text-slate-400">{row.reporter_name_snapshot} · {row.report_no}</p></article>)}</div><div className="hidden overflow-x-auto rounded-lg bg-white shadow-sm md:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">时间</th><th className="p-3">门店</th><th className="p-3">产品</th><th className="p-3">数量</th><th className="p-3">提交人</th><th className="p-3">编号</th></tr></thead><tbody>{rows.map((row) => <tr className="border-t" key={row.item_id}><td className="p-3">{row.arrival_time?.slice(0, 5)}</td><td className="p-3">{row.store_name_snapshot}</td><td className="p-3">{row.product_name_snapshot}</td><td className="p-3 font-bold">{row.quantity} {row.unit}</td><td className="p-3">{row.reporter_name_snapshot}</td><td className="p-3">{row.report_no}</td></tr>)}</tbody></table></div></>; }

function ProductSummary({ rows }: { rows: AdminArrivalSummary['products'] }) { if (!rows.length) return <Empty />; return <><div className="space-y-3 md:hidden">{rows.map((row, index) => <article className="rounded-lg bg-white p-4 shadow-sm" key={`${row.store_id}-${row.product_name_snapshot}-${row.unit}-${index}`}><div className="flex justify-between gap-3"><h3 className="font-bold">{row.product_name_snapshot}</h3><p className="font-bold text-brand-700">{row.total_quantity} {row.unit}</p></div><p className="mt-2 text-sm text-slate-500">{row.store_name_snapshot} · {row.report_count} 次上报</p></article>)}</div><div className="hidden overflow-x-auto rounded-lg bg-white shadow-sm md:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">门店</th><th className="p-3">产品</th><th className="p-3">合计数量</th><th className="p-3">上报次数</th></tr></thead><tbody>{rows.map((row, index) => <tr className="border-t" key={`${row.store_id}-${row.product_name_snapshot}-${row.unit}-${index}`}><td className="p-3">{row.store_name_snapshot}</td><td className="p-3">{row.product_name_snapshot}</td><td className="p-3 font-bold">{row.total_quantity} {row.unit}</td><td className="p-3">{row.report_count}</td></tr>)}</tbody></table></div></>; }

function Empty() { return <p className="rounded-lg bg-white p-8 text-center text-slate-500 shadow-sm">当前时间范围内没有符合条件的到货数据。</p>; }
