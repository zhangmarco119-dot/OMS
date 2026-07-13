import { Bell, CalendarDays, ChevronRight, Filter, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import {
  arrivalStatusClass,
  arrivalStatusLabel,
  formatArrivalDateTime,
  formatTimestamp,
} from '../features/arrivals/adminArrivalFormat';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import {
  loadAdminArrivalList,
  loadAdminArrivalMessages,
  localIsoDate,
  markAdminArrivalViewed,
  type AdminArrivalListFilters,
  type AdminArrivalMessage,
  type AdminArrivalReport,
} from '../services/admin-arrivals.service';

const dateDaysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localIsoDate(date);
};

const initialFilters: AdminArrivalListFilters = {
  dateFrom: dateDaysAgo(30),
  dateTo: localIsoDate(),
  page: 1,
  status: 'all',
  storeId: '',
};

export function AdminArrivalsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState(initialFilters);
  const [messages, setMessages] = useState<AdminArrivalMessage[]>([]);
  const [reports, setReports] = useState<AdminArrivalReport[]>([]);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
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
      const [nextMessages, list] = await Promise.all([
        loadAdminArrivalMessages(supabase),
        loadAdminArrivalList(supabase, filters),
      ]);
      setMessages(nextMessages);
      setReports(list.reports);
      setCount(list.count);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : '加载到货中心失败。');
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  const openMessage = async (message: AdminArrivalMessage) => {
    if (!supabase) return;
    setErrorMessage(null);
    try {
      await markAdminArrivalViewed(supabase, message.report.id);
      navigate(`/app/admin/arrivals/${message.report.id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '标记消息失败。');
    }
  };

  const storeOptions = useMemo(() => auth.availableStores, [auth.availableStores]);

  return (
    <PageShell eyebrow="门店运营系统 · 管理员" title="到货中心" backTo="/app">
      <section className="rounded-lg bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Bell className="h-5 w-5 text-brand-700" aria-hidden="true" />
            <div><h2 className="font-bold text-slate-900">未读到货消息</h2><p className="text-sm text-slate-500">{messages.length} 条待查看</p></div>
          </div>
          <Link className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-50 px-3 text-sm font-bold text-brand-700" to="/app/admin/arrivals/summary">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />到货中心汇总
          </Link>
        </div>
        {messages.length > 0 ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {messages.map((message) => (
              <button className="flex w-full items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-left" key={message.notification.id} onClick={() => void openMessage(message)} type="button">
                {message.thumbnailUrl ? <img alt="面单缩略图" className="h-16 w-16 shrink-0 rounded-md object-cover" src={message.thumbnailUrl} /> : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-white text-xs text-slate-400">无图片</div>}
                <span className="min-w-0 flex-1"><span className="block text-xs font-bold text-amber-800">{message.report.store_name_snapshot} · 未读</span><span className="mt-1 block truncate font-bold text-slate-900">{message.report.generated_summary}</span><span className="mt-1 block text-xs text-slate-500">{message.report.reporter_name_snapshot} · {formatTimestamp(message.report.submitted_at)}</span></span>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">暂无未读到货消息。</p>}
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="font-bold text-slate-900">到货记录</h2><p className="text-sm text-slate-500">共 {count} 条</p></div>
          <div className="flex gap-2">
            <button className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-bold md:hidden" onClick={() => setShowFilters((value) => !value)} type="button"><Filter className="h-4 w-4" aria-hidden="true" />筛选</button>
            <button aria-label="刷新" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200" onClick={() => void load()} type="button"><RefreshCw className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </div>
        <ArrivalFilters filters={filters} onChange={setFilters} stores={storeOptions} className="mt-4 hidden md:grid" />
      </section>

      {showFilters ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40 md:hidden" role="dialog" aria-modal="true" aria-label="筛选到货记录">
          <div className="w-full rounded-t-2xl bg-white p-5">
            <div className="flex items-center justify-between"><h2 className="text-lg font-bold">筛选</h2><button aria-label="关闭筛选" className="h-10 w-10" onClick={() => setShowFilters(false)} type="button"><X className="mx-auto h-5 w-5" /></button></div>
            <ArrivalFilters filters={filters} onChange={setFilters} stores={storeOptions} className="mt-4 grid" />
            <button className="mt-4 min-h-11 w-full rounded-lg bg-brand-600 font-bold text-white" onClick={() => setShowFilters(false)} type="button">查看结果</button>
          </div>
        </div>
      ) : null}

      {errorMessage ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{errorMessage}</p> : null}
      {status === 'loading' ? <p className="rounded-lg bg-white p-5 font-semibold text-slate-600 shadow-sm">正在加载到货记录</p> : null}
      {status === 'ready' && reports.length === 0 ? <p className="rounded-lg bg-white p-8 text-center text-slate-500 shadow-sm">当前筛选条件下没有到货记录。</p> : null}
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

function ArrivalFilters({ className, filters, onChange, stores }: { className: string; filters: AdminArrivalListFilters; onChange: (value: AdminArrivalListFilters) => void; stores: Array<{ id: string; name: string }> }) {
  const update = (patch: Partial<AdminArrivalListFilters>) => onChange({ ...filters, ...patch, page: 1 });
  return <div className={`${className} gap-3 md:grid-cols-4`}>
    <label className="text-sm font-semibold text-slate-700">门店<select className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3" onChange={(event) => update({ storeId: event.target.value })} value={filters.storeId}><option value="">全部门店</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
    <label className="text-sm font-semibold text-slate-700">开始日期<input className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3" onChange={(event) => update({ dateFrom: event.target.value })} type="date" value={filters.dateFrom} /></label>
    <label className="text-sm font-semibold text-slate-700">结束日期<input className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3" onChange={(event) => update({ dateTo: event.target.value })} type="date" value={filters.dateTo} /></label>
    <label className="text-sm font-semibold text-slate-700">状态<select className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3" onChange={(event) => update({ status: event.target.value as AdminArrivalListFilters['status'] })} value={filters.status}><option value="all">全部状态</option><option value="submitted">待查看</option><option value="viewed">已查看</option><option value="voided">已作废</option></select></label>
  </div>;
}

function ArrivalList({ reports }: { reports: AdminArrivalReport[] }) {
  return <>
    <div className="space-y-3 md:hidden">{reports.map((report) => <Link className="block rounded-lg bg-white p-4 shadow-sm" key={report.id} to={`/app/admin/arrivals/${report.id}`}><div className="flex justify-between gap-3"><div><p className="text-xs font-bold text-brand-700">{report.report_no}</p><h3 className="mt-1 font-bold text-slate-900">{report.store_name_snapshot}</h3></div><span className={`h-fit rounded-full px-3 py-1 text-xs font-bold ${arrivalStatusClass[report.status]}`}>{arrivalStatusLabel[report.status]}</span></div><p className="mt-3 line-clamp-2 text-sm text-slate-700">{report.generated_summary}</p><p className="mt-2 text-xs text-slate-500">{formatArrivalDateTime(report.arrival_date, report.arrival_time)} · {report.reporter_name_snapshot}</p></Link>)}</div>
    <div className="hidden overflow-x-auto rounded-lg bg-white shadow-sm md:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr><th className="p-3">编号</th><th className="p-3">门店</th><th className="p-3">到货时间</th><th className="p-3">提交人</th><th className="p-3">状态</th><th className="sticky right-0 bg-slate-50 p-3">操作</th></tr></thead><tbody>{reports.map((report) => <tr className="border-t border-slate-100" key={report.id}><td className="p-3 font-semibold">{report.report_no}</td><td className="p-3">{report.store_name_snapshot}</td><td className="p-3">{formatArrivalDateTime(report.arrival_date, report.arrival_time)}</td><td className="p-3">{report.reporter_name_snapshot}</td><td className="p-3"><span className={`rounded-full px-3 py-1 text-xs font-bold ${arrivalStatusClass[report.status]}`}>{arrivalStatusLabel[report.status]}</span></td><td className="sticky right-0 bg-white p-3"><Link className="font-bold text-brand-700" to={`/app/admin/arrivals/${report.id}`}>查看详情</Link></td></tr>)}</tbody></table></div>
  </>;
}
