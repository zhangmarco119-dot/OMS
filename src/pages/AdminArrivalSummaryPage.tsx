import { FileDown, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/Feedback';
import { SegmentedControl } from '../components/ui/FormField';
import { SectionCard } from '../components/ui/Surface';
import { ArrivalPeriodFilter } from '../features/arrivals/ArrivalPeriodFilter';
import { arrivalPeriodLabel, createDefaultArrivalPeriod, resolveArrivalPeriod } from '../features/arrivals/arrivalPeriod';
import { createArrivalSummaryExport, downloadArrivalExport } from '../features/export/arrivalExport';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import { loadAdminArrivalSummary, localIsoDate, type AdminArrivalSummary } from '../services/admin-arrivals.service';

type SummaryTab = 'details' | 'products';

export function AdminArrivalSummaryPage() {
  const auth = useAuth();
  const [period, setPeriod] = useRememberedPageState('period-v2', createDefaultArrivalPeriod(localIsoDate()));
  const [storeId, setStoreId] = useRememberedPageState('store', '');
  const [tab, setTab] = useRememberedPageState<SummaryTab>('tab', 'details');
  const [productSearch, setProductSearch] = useRememberedPageState('product-search', '');
  const [summary, setSummary] = useState<AdminArrivalSummary>({ details: [], products: [] });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage('需要配置 Supabase 才能加载每日汇总。'); return; }
    setStatus('loading');
    try {
      const range = resolveArrivalPeriod(period);
      setSummary(await loadAdminArrivalSummary(supabase, range, storeId)); setStatus('ready'); setMessage(null);
    }
    catch (error) { setStatus('error'); setMessage(error instanceof Error ? error.message : '加载每日汇总失败。'); }
  }, [period, storeId]);
  useEffect(() => { void load(); }, [load]);

  const filteredSummary = useMemo(() => {
    const keyword = productSearch.trim().toLocaleLowerCase('zh-CN');
    if (!keyword) return summary;
    const matches = (name: string | null) => (name ?? '').toLocaleLowerCase('zh-CN').includes(keyword);
    return {
      details: summary.details.filter((row) => matches(row.product_name_snapshot)),
      products: summary.products.filter((row) => matches(row.product_name_snapshot)),
    };
  }, [productSearch, summary]);

  const metrics = useMemo(() => ({
    products: filteredSummary.products.length,
    reports: new Set(filteredSummary.details.map((row) => row.report_id).filter(Boolean)).size,
    stores: new Set(filteredSummary.details.map((row) => row.store_id).filter(Boolean)).size,
    units: filteredSummary.details.reduce((total, row) => total + (Number(row.quantity) || 0), 0),
  }), [filteredSummary]);

  const exportLabel = arrivalPeriodLabel(period);
  return <PageShell eyebrow="门店运营系统 · 管理员" title="到货中心" backTo="/app/admin/arrivals">
    <SectionCard><ArrivalPeriodFilter onChange={setPeriod} value={period} /><div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]"><label className="text-sm font-semibold text-slate-700">门店<select className="ui-input mt-1" onChange={(event) => setStoreId(event.target.value)} value={storeId}><option value="">全部门店</option>{auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><button className="ui-button-primary mt-auto" disabled={status !== 'ready' || filteredSummary.details.length === 0} onClick={() => downloadArrivalExport(createArrivalSummaryExport(filteredSummary, exportLabel))} type="button"><FileDown className="h-5 w-5" />导出 Excel</button></div><label className="relative mt-3 block"><span className="sr-only">检索汇总产品</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" aria-hidden="true" /><input aria-label="检索汇总产品" className="ui-input pl-9 pr-10" onChange={(event) => setProductSearch(event.target.value)} placeholder="输入产品名称，查看其到货情况" type="search" value={productSearch} />{productSearch ? <button aria-label="清空汇总产品检索" className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500" onClick={() => setProductSearch('')} type="button"><X className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}</label></SectionCard>
    {message ? <ErrorState message={message} onRetry={() => void load()} /> : null}
    {status === 'loading' ? <LoadingState label="正在汇总到货数据" /> : null}
    {status === 'ready' ? <>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="上报数" value={metrics.reports} /><Metric label="到货门店" value={metrics.stores} /><Metric label="产品种类" value={metrics.products} /><Metric label="明细数量合计" value={Number(metrics.units.toFixed(3))} /></section>
      <SectionCard><SegmentedControl className="grid-cols-2" items={[{ active: tab === 'details', label: '到货明细', onClick: () => setTab('details') }, { active: tab === 'products', label: '产品汇总', onClick: () => setTab('products') }]} /></SectionCard>
      {tab === 'details' ? <DetailSummary rows={filteredSummary.details} searchActive={Boolean(productSearch.trim())} /> : <ProductSummary rows={filteredSummary.products} searchActive={Boolean(productSearch.trim())} />}
    </> : null}
  </PageShell>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="ui-card p-3.5"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</p></div>; }

const arrivalItemHref = (row: AdminArrivalSummary['details'][number]) => `/app/admin/arrivals/${row.report_id ?? ''}${row.item_id ? `?item=${encodeURIComponent(row.item_id)}` : ''}`;

function DetailSummary({ rows, searchActive }: { rows: AdminArrivalSummary['details']; searchActive: boolean }) {
  const navigate = useNavigate();
  if (!rows.length) return <Empty searchActive={searchActive} />;
  return <><div className="space-y-3 md:hidden">{rows.map((row) => <Link aria-label={`查看${row.product_name_snapshot ?? '产品'}到货详情`} className="ui-interactive block rounded-lg bg-white p-4 shadow-sm" key={row.item_id} to={arrivalItemHref(row)}><div className="flex justify-between gap-3"><h3 className="font-bold">{row.product_name_snapshot}</h3><p className="font-bold text-brand-700">{row.quantity} {row.unit}</p></div><p className="mt-2 text-sm text-slate-500">{row.store_name_snapshot} · {row.arrival_time?.slice(0, 5) ?? ''}</p><p className="mt-1 text-xs text-slate-400">{row.reporter_name_snapshot} · {row.report_no}</p></Link>)}</div><div className="hidden overflow-x-auto rounded-lg bg-white shadow-sm md:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">时间</th><th className="p-3">门店</th><th className="p-3">产品</th><th className="p-3">数量</th><th className="p-3">提交人</th><th className="p-3">编号</th></tr></thead><tbody>{rows.map((row) => <tr aria-label={`查看${row.product_name_snapshot ?? '产品'}到货详情`} className="cursor-pointer border-t transition hover:bg-brand-50 focus:bg-brand-50 focus:outline-none" key={row.item_id} onClick={() => navigate(arrivalItemHref(row))} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(arrivalItemHref(row)); } }} role="link" tabIndex={0}><td className="p-3">{row.arrival_time?.slice(0, 5)}</td><td className="p-3">{row.store_name_snapshot}</td><td className="p-3">{row.product_name_snapshot}</td><td className="p-3 font-bold">{row.quantity} {row.unit}</td><td className="p-3">{row.reporter_name_snapshot}</td><td className="p-3">{row.report_no}</td></tr>)}</tbody></table></div></>;
}

function ProductSummary({ rows, searchActive }: { rows: AdminArrivalSummary['products']; searchActive: boolean }) { if (!rows.length) return <Empty searchActive={searchActive} />; return <><div className="space-y-3 md:hidden">{rows.map((row, index) => <article className="rounded-lg bg-white p-4 shadow-sm" key={`${row.store_id}-${row.product_name_snapshot}-${row.unit}-${index}`}><div className="flex justify-between gap-3"><h3 className="font-bold">{row.product_name_snapshot}</h3><p className="font-bold text-brand-700">{row.total_quantity} {row.unit}</p></div><p className="mt-2 text-sm text-slate-500">{row.store_name_snapshot} · {row.report_count} 次上报</p></article>)}</div><div className="hidden overflow-x-auto rounded-lg bg-white shadow-sm md:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">门店</th><th className="p-3">产品</th><th className="p-3">合计数量</th><th className="p-3">上报次数</th></tr></thead><tbody>{rows.map((row, index) => <tr className="border-t" key={`${row.store_id}-${row.product_name_snapshot}-${row.unit}-${index}`}><td className="p-3">{row.store_name_snapshot}</td><td className="p-3">{row.product_name_snapshot}</td><td className="p-3 font-bold">{row.total_quantity} {row.unit}</td><td className="p-3">{row.report_count}</td></tr>)}</tbody></table></div></>; }

function Empty({ searchActive }: { searchActive: boolean }) { return <EmptyState title={searchActive ? '没有找到该产品的到货记录' : '暂无到货数据'} description={searchActive ? '请更换产品名称，或调整时间和门店范围。' : '当前时间范围内没有符合条件的到货数据。'} />; }
