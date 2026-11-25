import { BarChart3, CheckCircle2, ClipboardCheck, PackageCheck, RefreshCw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { IconButton } from '../components/ui/Actions';
import { ErrorState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { SegmentedControl } from '../components/ui/FormField';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import { loadV2Analytics, type V2Analytics } from '../services/v2-analytics.service';

const localIsoDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Shanghai', year: 'numeric' }).formatToParts(date);
  const at = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${at('year')}-${at('month')}-${at('day')}`;
};

const shiftDate = (days: number) => {
  const target = new Date();
  target.setDate(target.getDate() + days);
  return localIsoDate(target);
};

const empty: V2Analytics = { arrival: { pending: 0, product_kinds: 0, quantity_total: 0, stores: 0, today: 0, trend: [] }, inspection: { correction_completion_rate: 0, frequent_issues: [], issue_count: 0 }, tasks: { approved: 0, completion_rate: 0, overdue: 0, pending: 0, rejected: 0, store_rates: [], submitted: 0 }, v1: { inventory_submissions: 0, open_inventory: 0, order_submissions: 0 } };

export function AdminAnalyticsPage() {
  const today = useMemo(() => localIsoDate(), []);
  const [data, setData] = useState<V2Analytics>(empty);
  const [dateMode, setDateMode] = useRememberedPageState<'day' | 'range'>('date-mode', 'range');
  const [date, setDate] = useRememberedPageState('date', today);
  const [dateFrom, setDateFrom] = useRememberedPageState('date-from', shiftDate(-6));
  const [dateTo, setDateTo] = useRememberedPageState('date-to', today);
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
  const trendPoints = useMemo(() => (data.arrival.trend.length > 14 ? data.arrival.trend.slice(-14) : data.arrival.trend), [data.arrival.trend]);
  const maxTrend = useMemo(() => Math.max(1, ...trendPoints.map((item) => item.count)), [trendPoints]);
  const periodLabel = range.dateFrom === range.dateTo ? range.dateFrom : `${range.dateFrom} 至 ${range.dateTo}`;
  const taskTotal = data.tasks.approved + data.tasks.submitted + data.tasks.pending + data.tasks.rejected + data.tasks.overdue;

  const applyPreset = (preset: 'today' | '7d' | 'month') => {
    if (preset === 'today') {
      setDateMode('day');
      setDate(today);
      return;
    }
    setDateMode('range');
    setDateTo(today);
    setDateFrom(preset === 'month' ? `${today.slice(0, 7)}-01` : shiftDate(-6));
  };

  return (
    <PageShell
      action={<IconButton aria-label="刷新统计" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></IconButton>}
      backTo="/app/workbench"
      contentGapClassName="gap-3.5"
      eyebrow="门店运营系统 · 管理员"
      title="运营数据统计"
    >
      <SectionCard>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-brand-700">授权门店运营数据</p>
            <p className="mt-0.5 text-xs text-slate-500">选择日期或快捷区间后，所有看板同步汇总；点击卡片直达对应模块。</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button className="ui-interactive min-h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700" onClick={() => applyPreset('today')} type="button">今日</button>
            <button className="ui-interactive min-h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700" onClick={() => applyPreset('7d')} type="button">近 7 天</button>
            <button className="ui-interactive min-h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700" onClick={() => applyPreset('month')} type="button">本月</button>
          </div>
        </div>

        <SegmentedControl
          className="mt-3 grid-cols-2"
          items={[
            { active: dateMode === 'day', label: '选择某日', onClick: () => setDateMode('day') },
            { active: dateMode === 'range', label: '选择时间区间', onClick: () => setDateMode('range') },
          ]}
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {dateMode === 'day' ? (
            <label className="text-sm font-semibold text-slate-700">
              日期
              <input className="ui-input mt-1" onChange={(event) => setDate(event.target.value)} type="date" value={date} />
            </label>
          ) : (
            <>
              <label className="text-sm font-semibold text-slate-700">
                开始日期
                <input className="ui-input mt-1" onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                结束日期
                <input className="ui-input mt-1" onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} />
              </label>
            </>
          )}
        </div>
        <p className="mt-2.5 text-xs font-medium text-slate-500">当前统计范围：<b className="text-slate-800">{periodLabel}</b></p>
      </SectionCard>

      {message ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {status === 'loading' ? <LoadingState label="正在汇总运营数据" /> : null}

      {status === 'ready' ? (
        <>
          <SectionCard>
            <SectionHeader icon={PackageCheck} title="到货" />
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Metric label="期间上报" to="/app/admin/arrivals/summary" value={data.arrival.today} />
              <Metric label="待查看" to="/app/admin/arrivals" value={data.arrival.pending} />
              <Metric label="到货门店" to="/app/admin/arrivals/summary" value={data.arrival.stores} />
              <Metric label="产品种类" to="/app/admin/arrivals/summary" value={data.arrival.product_kinds} />
              <Metric label="数量合计" to="/app/admin/arrivals/summary" value={data.arrival.quantity_total} />
              <Metric label="查看到货中心" to="/app/admin/arrivals" value="进入" />
            </div>
            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-500">到货趋势</p>
              <div className="mt-2 flex h-24 items-end gap-1.5 rounded-xl border border-slate-200/70 bg-slate-50/60 px-3 pb-2.5 pt-3">
                {trendPoints.length ? trendPoints.map((item) => {
                  const isToday = item.date === today;
                  return (
                    <div className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" key={item.date}>
                      <span className={`text-[10px] font-bold tabular-nums ${isToday ? 'text-brand-700' : 'text-slate-500'}`}>{item.count}</span>
                      <div className={`w-full max-w-[28px] rounded-t-md ${isToday ? 'bg-brand-600' : 'bg-amber-400/90'}`} style={{ height: `${Math.max(8, Math.round((item.count / maxTrend) * 48))}px` }} />
                      <span className={`truncate text-[10px] tabular-nums ${isToday ? 'font-bold text-brand-700' : 'text-slate-400'}`}>{item.date.slice(5)}</span>
                    </div>
                  );
                }) : <p className="w-full py-4 text-center text-sm text-slate-500">当前周期暂无到货数据。</p>}
              </div>
            </div>
          </SectionCard>

          <SectionCard>
            <SectionHeader action={<StatusBadge tone="success">完成率 {data.tasks.completion_rate}%</StatusBadge>} icon={ClipboardCheck} title="任务完成情况" />
            {taskTotal > 0 ? (
              <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                {data.tasks.approved > 0 ? <div className="bg-brand-500" style={{ width: `${(data.tasks.approved / taskTotal) * 100}%` }} /> : null}
                {data.tasks.submitted > 0 ? <div className="bg-sky-500" style={{ width: `${(data.tasks.submitted / taskTotal) * 100}%` }} /> : null}
                {data.tasks.pending > 0 ? <div className="bg-amber-400" style={{ width: `${(data.tasks.pending / taskTotal) * 100}%` }} /> : null}
                {data.tasks.rejected > 0 ? <div className="bg-orange-500" style={{ width: `${(data.tasks.rejected / taskTotal) * 100}%` }} /> : null}
                {data.tasks.overdue > 0 ? <div className="bg-red-500" style={{ width: `${(data.tasks.overdue / taskTotal) * 100}%` }} /> : null}
              </div>
            ) : null}
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Metric label="待办" to="/app/admin/tasks" value={data.tasks.pending} />
              <Metric label="待审核" to="/app/admin/tasks" value={data.tasks.submitted} />
              <Metric label="已通过" to="/app/admin/tasks" value={data.tasks.approved} />
              <Metric label="已退回" to="/app/admin/tasks" value={data.tasks.rejected} />
              <Metric label="已逾期" to="/app/admin/tasks" value={data.tasks.overdue} />
              <Metric label="完成率" to="/app/admin/tasks" value={`${data.tasks.completion_rate}%`} />
            </div>
            <div className="mt-4 space-y-2">
              {data.tasks.store_rates.map((rate) => (
                <Link className="ui-interactive block rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 hover:border-brand-200 hover:bg-brand-50/30" key={rate.store_id} to="/app/admin/tasks">
                  <div className="flex justify-between gap-3 text-sm"><b className="text-slate-900">{rate.store_name}</b><span className="font-bold tabular-nums text-brand-700">{rate.approved}/{rate.total} · {rate.rate}%</span></div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200/80"><div className={`h-2 rounded-full ${rate.rate >= 80 ? 'bg-brand-500' : rate.rate >= 50 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${Math.min(100, rate.rate)}%` }} /></div>
                </Link>
              ))}
              {data.tasks.store_rates.length === 0 ? <p className="text-sm text-slate-500">暂无可统计的任务。</p> : null}
            </div>
          </SectionCard>

          <SectionCard>
            <SectionHeader icon={TriangleAlert} title="巡店与整改" />
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <Metric label="问题项" to="/app/admin/tasks" value={data.inspection.issue_count} />
              <Metric label="整改完成率" to="/app/admin/tasks" value={`${data.inspection.correction_completion_rate}%`} />
            </div>
            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-500">高频问题</p>
              {data.inspection.frequent_issues.length ? (
                <ol className="mt-2 space-y-2">
                  {data.inspection.frequent_issues.map((issue, index) => (
                    <li key={issue.label}><Link className="ui-interactive flex justify-between rounded-xl border border-red-100 bg-red-50/70 px-3.5 py-2.5 text-sm hover:bg-red-50" to="/app/admin/tasks"><span className="font-medium text-slate-800">{index + 1}. {issue.label}</span><b className="tabular-nums text-red-700">{issue.count} 次</b></Link></li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-brand-700"><CheckCircle2 aria-hidden="true" className="h-4 w-4" />暂无巡店问题记录。</p>
              )}
            </div>
          </SectionCard>

          <SectionCard>
            <SectionHeader icon={BarChart3} title="点货订货摘要" />
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Metric label="盘点提交" to="/app/history" value={data.v1.inventory_submissions} />
              <Metric label="订货提交" to="/app/history" value={data.v1.order_submissions} />
              <Metric label="未完成盘点" to="/app/inventory" value={data.v1.open_inventory} />
            </div>
          </SectionCard>
        </>
      ) : null}
    </PageShell>
  );
}

function Metric({ label, to, value }: { label: string; to: string; value: number | string }) {
  return <Link className="ui-interactive rounded-xl border border-slate-200/80 bg-slate-50/80 px-2 py-3 transition hover:border-brand-200 hover:bg-brand-50/50" to={to}><p className="text-lg font-bold tabular-nums text-slate-900">{value}</p><p className="mt-1 text-[11px] font-medium text-slate-500">{label}</p></Link>;
}
