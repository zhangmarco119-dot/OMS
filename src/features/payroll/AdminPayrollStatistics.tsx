import { BarChart3, ChevronRight, Clock3, Download, RefreshCw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ActionFeedbackDialog, type ActionFeedbackTone } from '../../components/feedback/ActionFeedbackDialog';
import { MonthPicker } from '../../components/forms/MonthPicker';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/Feedback';
import { SegmentedControl } from '../../components/ui/FormField';
import { SectionCard, SectionHeader } from '../../components/ui/Surface';
import { supabase } from '../../lib/supabase';
import { loadPayrollStatistics, type PayrollStatistics, type PayrollStatisticsEmployee, type PayrollStatisticsPeriod } from '../../services/payroll-statistics.service';
import { PayrollEstimateView } from './PayrollEstimateView';
import { PayrollStatementView } from './PayrollStatementView';
import { payrollMonthEndDate } from './monthSelection';
import { downloadPayrollStatisticsImage } from './payrollStatisticsImage';
import { formatMoney, todayInChina } from './model';

type RangeMode = 'day' | 'month' | 'range';
type Feedback = { message: string; title: string; tone: ActionFeedbackTone };

const percent = (value: number | null) => value == null ? '—' : `${(value * 100).toFixed(2)}%`;
const currentMonth = () => todayInChina().slice(0, 7);
const monthRange = (month: string) => ({ from: `${month}-01`, to: payrollMonthEndDate(month, todayInChina()) });

export function AdminPayrollStatistics() {
  const today = todayInChina();
  const [mode, setMode] = useState<RangeMode>('month');
  const [month, setMonth] = useState(currentMonth());
  const [day, setDay] = useState(today);
  const [customFrom, setCustomFrom] = useState(`${currentMonth()}-01`);
  const [customTo, setCustomTo] = useState(today);
  const [range, setRange] = useState(monthRange(currentMonth()));
  const [statistics, setStatistics] = useState<PayrollStatistics | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [search, setSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<PayrollStatisticsEmployee | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollStatisticsPeriod | null>(null);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async (nextRange: { from: string; to: string }) => {
    if (!supabase) return;
    setStatus('loading');
    try {
      setStatistics(await loadPayrollStatistics(supabase, nextRange.from, nextRange.to));
      setRange(nextRange);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setFeedback({ title: '综合统计加载失败', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    }
  }, []);

  useEffect(() => { void load(monthRange(currentMonth())); }, [load]);

  const applyRange = () => {
    const next = mode === 'day' ? { from: day, to: day } : mode === 'month' ? monthRange(month) : { from: customFrom, to: customTo };
    if (!next.from || !next.to || next.from > next.to || next.to > today) {
      setFeedback({ title: '请检查统计时间', message: '开始日期不能晚于结束日期，且不能包含未来日期。', tone: 'warning' });
      return;
    }
    void load(next);
  };

  const download = async () => {
    if (!statistics) return;
    setDownloading(true);
    try {
      await downloadPayrollStatisticsImage(statistics);
      setFeedback({ title: '薪资统计图表已生成', message: '图表已下载为 PNG 图片，包含总览、门店对比和员工工资。', tone: 'success' });
    } catch (error) {
      setFeedback({ title: '图表生成失败', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    } finally { setDownloading(false); }
  };

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return statistics?.employees.filter((employee) => !term || employee.displayName.toLocaleLowerCase().includes(term)) ?? [];
  }, [search, statistics]);

  if (selectedPeriod && selectedEmployee) {
    return <div aria-labelledby="payroll-statistics-detail-title" aria-modal="true" className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog"><div className="mx-auto max-w-2xl space-y-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
      <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5"><div><p className="text-xs font-bold text-brand-700">{selectedPeriod.from} 至 {selectedPeriod.to}</p><h2 className="text-xl font-bold" id="payroll-statistics-detail-title">{selectedEmployee.displayName}工资详情</h2></div><button aria-label="关闭工资详情" className="ui-icon-button" onClick={() => setSelectedPeriod(null)} type="button"><X className="h-5 w-5" /></button></header>
      <SectionCard className="grid grid-cols-2 gap-2"><Mini label="区间薪资成本" value={formatMoney(selectedPeriod.salaryCost)} /><Mini label="区间工时" value={`${selectedPeriod.hours.toFixed(2)} 小时`} /></SectionCard>
      {selectedPeriod.source === 'payslip' ? <><StatusBadge tone={selectedPeriod.payslipStatus === 'confirmed' ? 'success' : 'warning'}>{selectedPeriod.payslipStatus === 'confirmed' ? '工资单已确认' : selectedPeriod.payslipStatus === 'issued' ? '工资单已发送' : '工资单草稿'}</StatusBadge><PayrollStatementView estimate={selectedPeriod.estimate} payrollMonth={selectedPeriod.payrollMonth} /></> : <><p className="rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-900">该区间尚无完整月正式工资单，以区间结束日的实时薪资明细作为计算依据。</p><PayrollEstimateView estimate={selectedPeriod.estimate} /></>}
    </div></div>;
  }

  if (selectedEmployee) {
    return <><button className="ui-button-secondary" onClick={() => setSelectedEmployee(null)} type="button">返回员工工资列表</button><SectionCard className="bg-gradient-to-br from-brand-700 to-emerald-800 text-white"><p className="text-sm font-bold">{selectedEmployee.displayName}{selectedEmployee.employmentType === 'part_time' ? ' · 兼职' : ''}</p><p className="mt-2 text-3xl font-bold">{formatMoney(selectedEmployee.salaryCost)}</p><p className="mt-1 text-xs text-emerald-100">{range.from} 至 {range.to} · {selectedEmployee.hours.toFixed(2)} 小时 · 平均 {selectedEmployee.averageHourlyCost == null ? '—' : `${formatMoney(selectedEmployee.averageHourlyCost)}/小时`}</p></SectionCard><SectionCard className="overflow-hidden p-0"><div className="border-b border-slate-100 p-4"><SectionHeader icon={Clock3} title="按月工资明细" description="点击查看正式工资单或实时计算明细。" /></div><div className="divide-y divide-slate-100">{selectedEmployee.periods.map((period) => <button className="ui-interactive flex w-full items-center justify-between gap-3 p-4 text-left" key={`${period.payrollMonth}:${period.from}`} onClick={() => setSelectedPeriod(period)} type="button"><div><b className="text-sm">{period.from === period.to ? period.from : `${period.from} 至 ${period.to}`}</b><p className="mt-1 text-xs text-slate-500">{period.source === 'payslip' ? '正式工资单' : '实时计算'} · {period.hours.toFixed(2)} 小时</p></div><div className="flex items-center gap-2"><b className="tabular-nums text-brand-800">{formatMoney(period.salaryCost)}</b><ChevronRight className="h-4 w-4 text-slate-400" /></div></button>)}</div></SectionCard></>;
  }

  return <>
    <SectionCard className="p-3"><SegmentedControl className="grid-cols-3" items={[
      { active: mode === 'month', label: '按月', onClick: () => setMode('month') },
      { active: mode === 'day', label: '按天', onClick: () => setMode('day') },
      { active: mode === 'range', label: '时间段', onClick: () => setMode('range') },
    ]} />
      <div className="mt-3">{mode === 'month' ? <MonthPicker label="统计月份" maxMonth={today.slice(0, 7)} onChange={setMonth} value={month} /> : null}{mode === 'day' ? <label className="text-sm font-semibold">统计日期<input className="ui-input mt-1" max={today} onChange={(event) => setDay(event.target.value)} type="date" value={day} /></label> : null}{mode === 'range' ? <div className="grid grid-cols-2 gap-2"><label className="text-sm font-semibold">开始日期<input className="ui-input mt-1" max={today} onChange={(event) => setCustomFrom(event.target.value)} type="date" value={customFrom} /></label><label className="text-sm font-semibold">结束日期<input className="ui-input mt-1" max={today} onChange={(event) => setCustomTo(event.target.value)} type="date" value={customTo} /></label></div> : null}</div>
      <button className="ui-button-primary mt-3 w-full" disabled={status === 'loading'} onClick={applyRange} type="button"><RefreshCw className={`h-4 w-4 ${status === 'loading' ? 'animate-spin' : ''}`} />更新统计</button>
    </SectionCard>
    {status === 'loading' ? <LoadingState label="正在汇总工时、工资与营业收入" /> : null}
    {status === 'error' ? <ErrorState message="薪资综合统计暂时无法加载。" onRetry={() => void load(range)} /> : null}
    {status === 'ready' && statistics ? <>
      <SectionCard className="border-brand-100 bg-gradient-to-br from-brand-700 to-emerald-800 text-white"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-emerald-100">{statistics.from} 至 {statistics.to}</p><h2 className="mt-1 text-xl font-bold">薪资综合统计</h2></div><button className="rounded-lg bg-white/15 px-3 py-2 text-xs font-bold" disabled={downloading} onClick={() => void download()} type="button"><Download className="mr-1 inline h-4 w-4" />{downloading ? '正在生成' : '生成统计图表'}</button></div><div className="mt-4 grid grid-cols-2 gap-2"><HeroMetric label="总薪资成本" value={formatMoney(statistics.totalSalaryCost)} /><HeroMetric label="总计工时" value={`${statistics.totalHours.toFixed(2)} 小时`} /><HeroMetric label="平均工时成本" value={statistics.averageHourlyCost == null ? '—' : `${formatMoney(statistics.averageHourlyCost)}/小时`} /><HeroMetric label="全部门店薪资占比" value={percent(statistics.overallPayrollRatio)} /></div><p className="mt-3 text-xs leading-5 text-emerald-100">薪资成本按收入项减处罚统计，个税不作为门店用工成本；有效出勤按 8 小时/天，另加已审批工时。</p></SectionCard>
      <SectionCard className="overflow-hidden p-0"><div className="border-b border-slate-100 p-4"><SectionHeader icon={BarChart3} title="门店薪资占比" description={`全部门店营业收入 ${formatMoney(statistics.totalRevenue)} · 总薪资占营收 ${percent(statistics.overallPayrollRatio)}`} /></div><div className="divide-y divide-slate-100">{statistics.stores.map((store) => <div className="p-3.5" key={store.storeId}><div className="flex items-start justify-between gap-3"><div><b className="text-sm">{store.name}</b><p className="mt-1 text-xs text-slate-500">营收 {formatMoney(store.revenue)} · {store.hours.toFixed(2)} 小时</p></div><div className="text-right"><b className="text-sm text-brand-800">{formatMoney(store.salaryCost)}</b><p className="mt-1 text-xs font-semibold text-slate-500">占营收 {percent(store.payrollToRevenueRatio)}</p></div></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min((store.payrollShare ?? 0) * 100, 100)}%` }} /></div><p className="mt-1 text-right text-[11px] text-slate-500">占全部薪资 {percent(store.payrollShare)}</p></div>)}</div></SectionCard>
      <SectionCard className="overflow-hidden p-0"><div className="border-b border-slate-100 p-3"><SectionHeader icon={Clock3} title={`员工工资 · ${statistics.employees.length}人`} description="紧凑显示选定区间的工资与工时，点击员工查看详情工资单。" /><label className="relative mt-3 block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input className="ui-input pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="搜索员工" value={search} /></label></div>{!filteredEmployees.length ? <EmptyState title="选定时间内暂无员工工资" /> : <div className="divide-y divide-slate-100">{filteredEmployees.map((employee) => <button className="ui-interactive grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 text-left" key={employee.profileId} onClick={() => setSelectedEmployee(employee)} type="button"><div className="min-w-0"><b className="truncate text-sm">{employee.displayName}{employee.employmentType === 'part_time' ? ' · 兼职' : ''}</b><p className="mt-1 text-xs text-slate-500">{employee.hours.toFixed(2)} 小时 · 平均 {employee.averageHourlyCost == null ? '—' : `${formatMoney(employee.averageHourlyCost)}/小时`}</p></div><div className="flex items-center gap-1.5"><b className="tabular-nums text-brand-800">{formatMoney(employee.salaryCost)}</b><ChevronRight className="h-4 w-4 text-slate-400" /></div></button>)}</div>}</SectionCard>
    </> : null}
    <ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone} />
  </>;
}

function HeroMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-white/10 px-3 py-3"><span className="block text-[11px] font-semibold text-emerald-100">{label}</span><b className="mt-1 block text-lg tabular-nums text-white">{value}</b></div>; }
function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-3 text-center"><b className="block text-base text-slate-900">{value}</b><span className="mt-1 block text-xs text-slate-500">{label}</span></div>; }
