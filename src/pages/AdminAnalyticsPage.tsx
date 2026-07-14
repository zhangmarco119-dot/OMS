import { BarChart3, ClipboardCheck, PackageCheck, RefreshCw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ErrorState, LoadingState } from '../components/ui/Feedback';
import { supabase } from '../lib/supabase';
import { loadV2Analytics, type V2Analytics } from '../services/v2-analytics.service';

const localIsoDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Shanghai', year: 'numeric' }).formatToParts(date);
  const at = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${at('year')}-${at('month')}-${at('day')}`;
};
const empty: V2Analytics = { arrival: { pending: 0, product_kinds: 0, quantity_total: 0, stores: 0, today: 0, trend: [] }, inspection: { correction_completion_rate: 0, frequent_issues: [], issue_count: 0 }, tasks: { approved: 0, completion_rate: 0, overdue: 0, pending: 0, rejected: 0, store_rates: [], submitted: 0 }, v1: { inventory_submissions: 0, open_inventory: 0, order_submissions: 0 } };

export function AdminAnalyticsPage() {
  const [data, setData] = useState<V2Analytics>(empty);
  const [dateMode, setDateMode] = useState<'day' | 'range'>('range');
  const [date, setDate] = useState(localIsoDate());
  const [dateFrom, setDateFrom] = useState(() => { const start = new Date(); start.setDate(start.getDate() - 6); return localIsoDate(start); });
  const [dateTo, setDateTo] = useState(localIsoDate());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage('缺少 Supabase 配置，无法加载数据统计。'); return; }
    const range = dateMode === 'day' ? { dateFrom: date, dateTo: date } : { dateFrom, dateTo };
    if (range.dateFrom > range.dateTo) { setStatus('error'); setMessage('开始日期不能晚于结束日期。'); return; }
    setStatus('loading');
    try { setData(await loadV2Analytics(supabase, range)); setStatus('ready'); setMessage(null); }
    catch (error) { setStatus('error'); setMessage(error instanceof Error ? error.message : '加载数据统计失败。'); }
  }, [date, dateFrom, dateMode, dateTo]);
  useEffect(() => { void load(); }, [load]);
  const range = dateMode === 'day' ? { dateFrom: date, dateTo: date } : { dateFrom, dateTo };
  const maxTrend = useMemo(() => Math.max(1, ...data.arrival.trend.map((item) => item.count)), [data.arrival.trend]);
  const periodLabel = range.dateFrom === range.dateTo ? range.dateFrom : `${range.dateFrom} 至 ${range.dateTo}`;

  return <PageShell eyebrow="门店运营系统 · 管理员" title="运营数据统计" backTo="/app">
    <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-brand-700">授权门店运营数据</p><p className="mt-1 text-sm text-slate-500">选择日期后，所有卡片均按该范围汇总；点击卡片可进入对应模块。</p></div><button aria-label="刷新统计" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200" onClick={() => void load()} type="button"><RefreshCw className="h-4 w-4" /></button></div><div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"><button className={`min-h-10 rounded-md text-sm font-bold ${dateMode === 'day' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setDateMode('day')} type="button">选择某日</button><button className={`min-h-10 rounded-md text-sm font-bold ${dateMode === 'range' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setDateMode('range')} type="button">选择时间区间</button></div><div className="mt-3 grid gap-3 sm:grid-cols-2">{dateMode === 'day' ? <label className="text-sm font-semibold text-slate-700">日期<input className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3" onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label> : <><label className="text-sm font-semibold text-slate-700">开始日期<input className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3" onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} /></label><label className="text-sm font-semibold text-slate-700">结束日期<input className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3" onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} /></label></>}</div><p className="mt-2 text-xs text-slate-500">当前统计范围：{periodLabel}</p></section>
    {message ? <ErrorState message={message} onRetry={() => void load()} /> : null}
    {status === 'loading' ? <LoadingState label="正在汇总运营数据" /> : null}
    {status === 'ready' ? <>
      <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-amber-700" /><h2 className="font-bold text-slate-900">到货</h2></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="期间上报" to="/app/admin/arrivals/summary" value={data.arrival.today} /><Metric label="待查看" to="/app/admin/arrivals" value={data.arrival.pending} /><Metric label="到货门店" to="/app/admin/arrivals/summary" value={data.arrival.stores} /><Metric label="产品种类" to="/app/admin/arrivals/summary" value={data.arrival.product_kinds} /><Metric label="数量合计" to="/app/admin/arrivals/summary" value={data.arrival.quantity_total} /><Metric label="查看到货中心" to="/app/admin/arrivals" value="进入" /></div><div className="mt-4"><p className="text-xs font-semibold text-slate-500">到货趋势</p><div className="mt-2 flex h-20 items-end gap-1">{data.arrival.trend.length ? data.arrival.trend.map((item) => <div className="flex min-w-0 flex-1 flex-col items-center gap-1" key={item.date}><span className="text-[10px] text-slate-500">{item.count}</span><div className="w-full rounded-t bg-amber-400" style={{ height: `${Math.max(6, item.count / maxTrend * 52)}px` }} /><span className="text-[9px] text-slate-400">{item.date.slice(5)}</span></div>) : <p className="text-sm text-slate-500">当前周期暂无到货数据。</p>}</div></div></section>
      <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-brand-700" /><h2 className="font-bold text-slate-900">任务完成情况</h2></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="待办" to="/app/admin/tasks" value={data.tasks.pending} /><Metric label="待审核" to="/app/admin/tasks" value={data.tasks.submitted} /><Metric label="已通过" to="/app/admin/tasks" value={data.tasks.approved} /><Metric label="已退回" to="/app/admin/tasks" value={data.tasks.rejected} /><Metric label="已逾期" to="/app/admin/tasks" value={data.tasks.overdue} /><Metric label="完成率" to="/app/admin/tasks" value={`${data.tasks.completion_rate}%`} /></div><div className="mt-4 space-y-2">{data.tasks.store_rates.map((rate) => <Link className="block rounded-lg bg-slate-50 p-3" key={rate.store_id} to="/app/admin/tasks"><div className="flex justify-between gap-3 text-sm"><b>{rate.store_name}</b><span>{rate.approved}/{rate.total} · {rate.rate}%</span></div><div className="mt-2 h-2 rounded bg-slate-200"><div className="h-2 rounded bg-brand-600" style={{ width: `${Math.min(100, rate.rate)}%` }} /></div></Link>)}{data.tasks.store_rates.length === 0 ? <p className="text-sm text-slate-500">暂无可统计的任务。</p> : null}</div></section>
      <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><TriangleAlert className="h-5 w-5 text-red-700" /><h2 className="font-bold text-slate-900">巡店与整改</h2></div><div className="mt-3 grid grid-cols-2 gap-2 text-center"><Metric label="问题项" to="/app/admin/tasks" value={data.inspection.issue_count} /><Metric label="整改完成率" to="/app/admin/tasks" value={`${data.inspection.correction_completion_rate}%`} /></div><div className="mt-4"><p className="text-xs font-semibold text-slate-500">高频问题</p>{data.inspection.frequent_issues.length ? <ol className="mt-2 space-y-2">{data.inspection.frequent_issues.map((issue, index) => <li key={issue.label}><Link className="flex justify-between rounded-lg bg-red-50 px-3 py-2 text-sm" to="/app/admin/tasks"><span>{index + 1}. {issue.label}</span><b className="text-red-700">{issue.count} 次</b></Link></li>)}</ol> : <p className="mt-2 text-sm text-slate-500">暂无巡店问题记录。</p>}</div></section>
      <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-sky-700" /><h2 className="font-bold text-slate-900">点货订货摘要</h2></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="盘点提交" to="/app/history" value={data.v1.inventory_submissions} /><Metric label="订货提交" to="/app/history" value={data.v1.order_submissions} /><Metric label="未完成盘点" to="/app/inventory" value={data.v1.open_inventory} /></div></section>
    </> : null}
  </PageShell>;
}

function Metric({ label, to, value }: { label: string; to: string; value: number | string }) {
  return <Link className="ui-interactive rounded-lg border border-slate-200 bg-slate-50 px-2 py-3 transition hover:border-brand-200 hover:bg-brand-50" to={to}><p className="text-lg font-bold tabular-nums text-slate-900">{value}</p><p className="mt-1 text-[11px] text-slate-500">{label}</p></Link>;
}
