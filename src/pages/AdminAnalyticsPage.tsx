import { BarChart3, ClipboardCheck, PackageCheck, RefreshCw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { supabase } from '../lib/supabase';
import { loadV2Analytics, type V2Analytics } from '../services/v2-analytics.service';

const empty: V2Analytics = { arrival: { pending: 0, product_kinds: 0, quantity_total: 0, stores: 0, today: 0, trend: [] }, inspection: { correction_completion_rate: 0, frequent_issues: [], issue_count: 0 }, tasks: { approved: 0, completion_rate: 0, overdue: 0, pending: 0, rejected: 0, store_rates: [], submitted: 0 }, v1: { inventory_submissions: 0, open_inventory: 0, order_submissions: 0 } };

export function AdminAnalyticsPage() {
  const [data, setData] = useState<V2Analytics>(empty);
  const [days, setDays] = useState(7);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage('缺少 Supabase 配置，无法加载数据统计。'); return; }
    setStatus('loading');
    try { setData(await loadV2Analytics(supabase, days)); setStatus('ready'); setMessage(null); }
    catch (error) { setStatus('error'); setMessage(error instanceof Error ? error.message : '加载数据统计失败。'); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);
  const maxTrend = useMemo(() => Math.max(1, ...data.arrival.trend.map((item) => item.count)), [data.arrival.trend]);

  return <PageShell eyebrow="门店运营系统 · 阶段 8" title="运营数据统计" backTo="/app">
    <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-brand-700">授权门店运营数据</p><p className="mt-1 text-sm text-slate-500">统计数据由数据库聚合，不在前端全量计算。</p></div><button aria-label="刷新统计" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200" onClick={() => void load()} type="button"><RefreshCw className="h-4 w-4" /></button></div><div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">{[7, 14, 30].map((value) => <button className={`min-h-10 rounded-md text-sm font-bold ${days === value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} key={value} onClick={() => setDays(value)} type="button">近 {value} 天</button>)}</div></section>
    {message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}
    {status === 'loading' ? <p className="rounded-lg bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">正在汇总运营数据</p> : null}
    {status === 'ready' ? <>
      <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-amber-700" /><h2 className="font-bold text-slate-900">到货</h2></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="今日上报" value={data.arrival.today} /><Metric label="待查看" value={data.arrival.pending} /><Metric label="到货门店" value={data.arrival.stores} /><Metric label="产品种类" value={data.arrival.product_kinds} /><Metric label="数量合计" value={data.arrival.quantity_total} /><Metric label="统计周期" value={`${days}天`} /></div><div className="mt-4"><p className="text-xs font-semibold text-slate-500">到货趋势</p><div className="mt-2 flex h-20 items-end gap-1">{data.arrival.trend.length ? data.arrival.trend.map((item) => <div className="flex min-w-0 flex-1 flex-col items-center gap-1" key={item.date}><span className="text-[10px] text-slate-500">{item.count}</span><div className="w-full rounded-t bg-amber-400" style={{ height: `${Math.max(6, item.count / maxTrend * 52)}px` }} /><span className="text-[9px] text-slate-400">{item.date.slice(5)}</span></div>) : <p className="text-sm text-slate-500">当前周期暂无到货数据。</p>}</div></div></section>
      <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-brand-700" /><h2 className="font-bold text-slate-900">任务完成情况</h2></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="待办" value={data.tasks.pending} /><Metric label="待审核" value={data.tasks.submitted} /><Metric label="已通过" value={data.tasks.approved} /><Metric label="已退回" value={data.tasks.rejected} /><Metric label="已逾期" value={data.tasks.overdue} /><Metric label="完成率" value={`${data.tasks.completion_rate}%`} /></div><div className="mt-4 space-y-2">{data.tasks.store_rates.map((rate) => <div className="rounded-lg bg-slate-50 p-3" key={rate.store_id}><div className="flex justify-between gap-3 text-sm"><b>{rate.store_name}</b><span>{rate.approved}/{rate.total} · {rate.rate}%</span></div><div className="mt-2 h-2 rounded bg-slate-200"><div className="h-2 rounded bg-brand-600" style={{ width: `${Math.min(100, rate.rate)}%` }} /></div></div>)}{data.tasks.store_rates.length === 0 ? <p className="text-sm text-slate-500">暂无可统计的任务。</p> : null}</div></section>
      <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><TriangleAlert className="h-5 w-5 text-red-700" /><h2 className="font-bold text-slate-900">巡店与整改</h2></div><div className="mt-3 grid grid-cols-2 gap-2 text-center"><Metric label="问题项" value={data.inspection.issue_count} /><Metric label="整改完成率" value={`${data.inspection.correction_completion_rate}%`} /></div><div className="mt-4"><p className="text-xs font-semibold text-slate-500">高频问题</p>{data.inspection.frequent_issues.length ? <ol className="mt-2 space-y-2">{data.inspection.frequent_issues.map((issue, index) => <li className="flex justify-between rounded-lg bg-red-50 px-3 py-2 text-sm" key={issue.label}><span>{index + 1}. {issue.label}</span><b className="text-red-700">{issue.count} 次</b></li>)}</ol> : <p className="mt-2 text-sm text-slate-500">暂无巡店问题记录。</p>}</div></section>
      <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-sky-700" /><h2 className="font-bold text-slate-900">V1 摘要（近 30 天）</h2></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="盘点提交" value={data.v1.inventory_submissions} /><Metric label="订货提交" value={data.v1.order_submissions} /><Metric label="未完成盘点" value={data.v1.open_inventory} /></div></section>
    </> : null}
  </PageShell>;
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg bg-slate-50 px-2 py-3"><p className="text-lg font-bold text-slate-900">{value}</p><p className="mt-1 text-[11px] text-slate-500">{label}</p></div>;
}
