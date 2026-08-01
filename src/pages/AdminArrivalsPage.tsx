import { CalendarDays, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/Feedback';
import { SectionCard } from '../components/ui/Surface';
import {
  formatArrivalDateTime,
} from '../features/arrivals/adminArrivalFormat';
import { ArrivalPeriodFilter } from '../features/arrivals/ArrivalPeriodFilter';
import { createDefaultArrivalPeriod, resolveArrivalPeriod } from '../features/arrivals/arrivalPeriod';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import {
  loadAdminArrivalList,
  localIsoDate,
  type AdminArrivalListFilters,
  type AdminArrivalListItem,
} from '../services/admin-arrivals.service';

const initialFilters: AdminArrivalListFilters = {
  dateFrom: localIsoDate(),
  dateTo: localIsoDate(),
  page: 1,
  status: 'all',
  storeId: '',
};

export function AdminArrivalsPage() {
  const auth = useAuth();
  const [filters, setFilters] = useRememberedPageState('filters', initialFilters);
  const [period, setPeriod] = useRememberedPageState('period-v2', createDefaultArrivalPeriod(localIsoDate()));
  const [reports, setReports] = useState<AdminArrivalListItem[]>([]);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pageCount = Math.max(1, Math.ceil(count / 20));

  const load = useCallback(async () => {
    if (!supabase) {
      setStatus('error');
      setErrorMessage('需要配置 Supabase 才能加载到货中心。');
      return;
    }
    setStatus('loading');
    setErrorMessage(null);
    try {
      const list = await loadAdminArrivalList(supabase, { ...filters, ...resolveArrivalPeriod(period) });
      setReports(list.reports);
      setCount(list.count);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : '加载到货中心失败。');
    }
  }, [filters, period]);

  useEffect(() => { void load(); }, [load]);

  const storeOptions = useMemo(() => auth.availableStores, [auth.availableStores]);

  return (
    <PageShell eyebrow="门店运营系统 · 管理员" title="到货中心" backTo="/app">
      <SectionCard className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="shrink-0 text-base font-bold text-slate-900">到货记录</h2>
            <span className="truncate text-xs text-slate-500">共 {count} 条</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link className="ui-button-secondary min-h-9 gap-1.5 px-2.5 py-1 text-xs" to="/app/admin/arrivals/summary"><CalendarDays className="h-4 w-4" aria-hidden="true" />到货汇总</Link>
            <button aria-label="刷新到货记录" className="ui-icon-button h-9 min-h-9 w-9" onClick={() => void load()} type="button"><RefreshCw className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </div>
        <ArrivalFilters filters={filters} onChange={setFilters} onPeriodChange={(value) => { setPeriod(value); setFilters((current) => ({ ...current, page: 1 })); }} period={period} stores={storeOptions} className="mt-2.5" />
      </SectionCard>

      {errorMessage ? <ErrorState message={errorMessage} onRetry={() => void load()} /> : null}
      {status === 'loading' ? <LoadingState label="正在加载到货记录" /> : null}
      {status === 'ready' && reports.length === 0 ? <EmptyState title="没有到货记录" description="当前筛选条件下暂无符合条件的到货记录。" /> : null}
      {status === 'ready' && reports.length > 0 ? <ArrivalList reports={reports} /> : null}

      {status === 'ready' && count > 20 ? (
        <div className="flex items-center justify-center gap-3 rounded-lg bg-white p-3 shadow-sm">
          <button className="min-h-10 rounded-lg border border-slate-200 px-4 font-bold disabled:text-slate-300" disabled={filters.page <= 1} onClick={() => setFilters((value) => ({ ...value, page: value.page - 1 }))} type="button">上一页</button>
          <span className="text-sm text-slate-600">第 {filters.page} / {pageCount} 页</span>
          <button className="min-h-10 rounded-lg border border-slate-200 px-4 font-bold disabled:text-slate-300" disabled={filters.page >= pageCount} onClick={() => setFilters((value) => ({ ...value, page: value.page + 1 }))} type="button">下一页</button>
        </div>
      ) : null}
    </PageShell>
  );
}

function ArrivalFilters({ className, filters, onChange, onPeriodChange, period, stores }: { className: string; filters: AdminArrivalListFilters; onChange: (value: AdminArrivalListFilters) => void; onPeriodChange: Parameters<typeof ArrivalPeriodFilter>[0]['onChange']; period: Parameters<typeof ArrivalPeriodFilter>[0]['value']; stores: Array<{ id: string; name: string }> }) {
  const update = (patch: Partial<AdminArrivalListFilters>) => onChange({ ...filters, ...patch, page: 1 });
  return <div className={className}>
    <ArrivalPeriodFilter compact onChange={onPeriodChange} value={period} />
    <div className="mt-2 grid grid-cols-2 gap-2">
      <label className="text-xs font-semibold text-slate-600">门店<select className="ui-input mt-0.5 min-h-9 py-1 text-sm" onChange={(event) => update({ storeId: event.target.value })} value={filters.storeId}><option value="">全部门店</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">状态<select className="ui-input mt-0.5 min-h-9 py-1 text-sm" onChange={(event) => update({ status: event.target.value as AdminArrivalListFilters['status'] })} value={filters.status}><option value="all">有效到货</option><option value="submitted">未读</option><option value="viewed">已读</option><option value="voided">已作废</option></select></label>
    </div>
  </div>;
}

function ArrivalList({ reports }: { reports: AdminArrivalListItem[] }) {
  return <div className="grid gap-2 md:grid-cols-2">{reports.map((report) => <Link className="ui-card ui-interactive flex gap-3 p-3" key={report.id} to={`/app/admin/arrivals/${report.id}`}>
    {report.thumbnailUrl ? <img alt="到货照片预览" className="h-20 w-20 shrink-0 rounded-lg bg-slate-50 object-cover" loading="lazy" src={report.thumbnailUrl} /> : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[11px] text-slate-400">暂无照片</div>}
    <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-[11px] text-slate-400">{report.store_name_snapshot}</p><div className="flex shrink-0 flex-wrap justify-end gap-1"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${report.allProductsMatched ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{report.allProductsMatched ? '已匹配货品' : '含未匹配货品'}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${report.status === 'submitted' ? 'bg-amber-50 text-amber-700' : report.status === 'viewed' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{report.status === 'submitted' ? '未读' : report.status === 'viewed' ? '已读' : '已作废'}</span></div></div><p className="mt-1 line-clamp-2 text-lg font-bold leading-6 tracking-tight text-slate-900">{report.itemSummary}</p><p className="mt-1 text-xs text-slate-500">{formatArrivalDateTime(report.arrival_date, report.arrival_time)} · {report.reporter_name_snapshot}</p></div>
  </Link>)}</div>;
}
