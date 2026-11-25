import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  Layers,
  LogOut,
  PackageCheck,
  PlusCircle,
  RefreshCw,
  Store,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { IconButton } from '../../components/ui/Actions';
import { FeedbackBanner, SkeletonCard, StatusBadge } from '../../components/ui/Feedback';
import { SegmentedControl } from '../../components/ui/FormField';
import { MetricCard, SectionCard, SectionHeader } from '../../components/ui/Surface';
import { useAuth } from '../auth/AuthContext';
import { formatMoney, todayInChina, type AdminPayrollSummary } from '../payroll/model';
import { supabase } from '../../lib/supabase';
import { loadAdminOperationOverview, type AdminOperationOverview } from '../../services/admin-operation-overview.service';
import { loadAdminPayrollEstimates } from '../../services/payroll.service';
import { loadPayrollStatistics, type PayrollStatistics } from '../../services/payroll-statistics.service';
import { loadStoreClosures, storeOperatesOn, type StoreClosure } from '../../services/store-business.service';
import { loadTodoSummary, type TodoSummary } from '../../services/todo.service';
import { loadV2Analytics, type V2Analytics } from '../../services/v2-analytics.service';

export type BoardPeriod = 'today' | '7d' | 'month';

const shiftIsoDate = (isoDate: string, deltaDays: number) => {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
};

const formatChinaDateLabel = (isoDate: string) => {
  const date = new Date(`${isoDate}T12:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long' }).format(date);
  const [year, month, day] = isoDate.split('-');
  return `${year}年${Number(month)}月${Number(day)}日 · ${weekday}`;
};

const periodDateRange = (today: string, period: BoardPeriod) => {
  if (period === 'today') return { dateFrom: today, dateTo: today };
  if (period === 'month') return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today };
  return { dateFrom: shiftIsoDate(today, -6), dateTo: today };
};

const formatPercent = (ratio: number | null) => (
  ratio === null || !Number.isFinite(ratio) ? '—' : `${(ratio * 100).toFixed(1)}%`
);

const ratioTone = (ratio: number | null) => {
  if (ratio === null || !Number.isFinite(ratio)) return { badge: 'neutral' as const, bar: 'bg-slate-300', label: '待营收数据' };
  const pct = ratio * 100;
  if (pct <= 25) return { badge: 'success' as const, bar: 'bg-brand-500', label: '健康区间' };
  if (pct <= 35) return { badge: 'warning' as const, bar: 'bg-amber-500', label: '需关注' };
  return { badge: 'danger' as const, bar: 'bg-red-500', label: '偏高预警' };
};

const quickActions = [
  { icon: PlusCircle, label: '发布任务', to: '/app/admin/tasks/publish', tint: 'bg-brand-50 text-brand-700' },
  { icon: PackageCheck, label: '到货汇总', to: '/app/admin/arrivals/summary', tint: 'bg-amber-50 text-amber-700' },
  { icon: CalendarClock, label: '考勤管理', to: '/app/admin/attendance', tint: 'bg-sky-50 text-sky-700' },
  { icon: CircleDollarSign, label: '薪资管理', to: '/app/admin/payroll', tint: 'bg-emerald-50 text-emerald-700' },
  { icon: Bell, label: '公告管理', to: '/app/admin/announcements', tint: 'bg-indigo-50 text-indigo-700' },
  { icon: BarChart3, label: '运营统计', to: '/app/admin/analytics', tint: 'bg-slate-100 text-slate-700' },
] as const;

export function AdminOperationBoard() {
  const auth = useAuth();
  const today = useMemo(() => todayInChina(), []);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [period, setPeriod] = useState<BoardPeriod>('7d');
  const [overview, setOverview] = useState<AdminOperationOverview | null>(null);
  const [summary, setSummary] = useState<TodoSummary | null>(null);
  const [payrollSummary, setPayrollSummary] = useState<AdminPayrollSummary | null>(null);
  const [analytics, setAnalytics] = useState<V2Analytics | null>(null);
  const [payrollStats, setPayrollStats] = useState<PayrollStatistics | null>(null);
  const [closures, setClosures] = useState<StoreClosure[]>([]);

  const [coreLoading, setCoreLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  const coreSeqRef = useRef(0);
  const analyticsSeqRef = useRef(0);

  const loadCoreAndStats = useCallback(async () => {
    if (!supabase || !auth.profile) return;
    const seq = ++coreSeqRef.current;
    setCoreLoading((prev) => prev && !overview);
    setStatsLoading((prev) => prev && !payrollStats);

    const corePromise = Promise.all([
      loadAdminOperationOverview(supabase),
      loadTodoSummary(supabase, { isAdmin: true, profileId: auth.profile.id }),
      loadAdminPayrollEstimates(supabase, { asOf: today }),
    ]).then(([nextOverview, nextSummary, nextPayrollSummary]) => {
      if (seq !== coreSeqRef.current) return;
      setOverview(nextOverview);
      setSummary(nextSummary);
      setPayrollSummary(nextPayrollSummary);
      setMessage(null);
      setCoreLoading(false);
    }).catch((error) => {
      if (seq !== coreSeqRef.current) return;
      setMessage(error instanceof Error ? error.message : '运营概览加载失败。');
      setCoreLoading(false);
    });

    const secondaryPromise = Promise.allSettled([
      loadPayrollStatistics(supabase, monthStart, today),
      loadStoreClosures(supabase),
    ]).then(([statsResult, closuresResult]) => {
      if (seq !== coreSeqRef.current) return;
      if (statsResult.status === 'fulfilled' && statsResult.value) {
        setPayrollStats(statsResult.value);
      }
      if (closuresResult.status === 'fulfilled' && Array.isArray(closuresResult.value)) {
        setClosures(closuresResult.value);
      }
      setStatsLoading(false);
    });

    await Promise.all([corePromise, secondaryPromise]);
  }, [auth.profile, monthStart, overview, payrollStats, today]);

  const loadAnalyticsForPeriod = useCallback(async (targetPeriod: BoardPeriod) => {
    if (!supabase || !auth.profile) return;
    const seq = ++analyticsSeqRef.current;
    setAnalyticsLoading(true);
    try {
      const next = await loadV2Analytics(supabase, periodDateRange(today, targetPeriod));
      if (seq !== analyticsSeqRef.current) return;
      setAnalytics(next);
      setAnalyticsError(null);
    } catch (error) {
      if (seq !== analyticsSeqRef.current) return;
      setAnalyticsError(error instanceof Error ? error.message : '趋势数据加载失败。');
    } finally {
      if (seq === analyticsSeqRef.current) setAnalyticsLoading(false);
    }
  }, [auth.profile, today]);

  useEffect(() => {
    void loadCoreAndStats();
  }, [auth.profile, monthStart, today]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadAnalyticsForPeriod(period);
  }, [loadAnalyticsForPeriod, period]);

  useEffect(() => {
    const refresh = () => {
      void loadCoreAndStats();
      void loadAnalyticsForPeriod(period);
    };
    window.addEventListener('storehub:arrivals-changed', refresh);
    window.addEventListener('storehub:todos-changed', refresh);
    return () => {
      window.removeEventListener('storehub:arrivals-changed', refresh);
      window.removeEventListener('storehub:todos-changed', refresh);
    };
  }, [loadAnalyticsForPeriod, loadCoreAndStats, period]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadCoreAndStats(), loadAnalyticsForPeriod(period)]);
    } finally {
      setRefreshing(false);
    }
  };

  const storeStatusSummary = useMemo(() => {
    const stores = auth.availableStores ?? [];
    const operating = stores.filter((store) => storeOperatesOn(closures, store.id, today));
    const closed = stores.filter((store) => !storeOperatesOn(closures, store.id, today));
    return { closed, operating, total: stores.length };
  }, [auth.availableStores, closures, today]);

  const todoBreakdown = useMemo(() => {
    if (!summary) return [];
    const items = [
      { count: summary.tasks, label: '任务审核', tone: 'danger' as const },
      { count: summary.productFeedback, label: '货品变更/删除', tone: 'warning' as const },
      { count: summary.productCreationRequests, label: '新品新增申请', tone: 'warning' as const },
      { count: summary.overtime, label: '工时审批', tone: 'info' as const },
      { count: summary.arrivalCorrections, label: '到货更正', tone: 'warning' as const },
      { count: summary.payrollConfirmations, label: '工资单已确认', tone: 'success' as const },
      { count: summary.managerPenalties, label: '店长罚单待阅', tone: 'danger' as const },
    ];
    return [...items].sort((a, b) => (b.count > 0 ? 1 : 0) - (a.count > 0 ? 1 : 0) || b.count - a.count);
  }, [summary]);

  const storeRows = useMemo(() => {
    const map = new Map<string, {
      approved: number;
      isOperating: boolean;
      name: string;
      rate: number | null;
      revenue: number | null;
      salaryCost: number | null;
      ratio: number | null;
      storeId: string;
      total: number;
    }>();

    for (const store of auth.availableStores ?? []) {
      map.set(store.id, {
        approved: 0,
        isOperating: storeOperatesOn(closures, store.id, today),
        name: store.name,
        rate: null,
        ratio: null,
        revenue: null,
        salaryCost: null,
        storeId: store.id,
        total: 0,
      });
    }

    for (const rate of analytics?.tasks.store_rates ?? []) {
      const existing = map.get(rate.store_id) ?? {
        approved: 0,
        isOperating: storeOperatesOn(closures, rate.store_id, today),
        name: rate.store_name,
        rate: null,
        ratio: null,
        revenue: null,
        salaryCost: null,
        storeId: rate.store_id,
        total: 0,
      };
      existing.approved = rate.approved;
      existing.total = rate.total;
      existing.rate = rate.rate;
      map.set(rate.store_id, existing);
    }

    for (const store of payrollStats?.stores ?? []) {
      const existing = map.get(store.storeId) ?? {
        approved: 0,
        isOperating: storeOperatesOn(closures, store.storeId, today),
        name: store.name,
        rate: null,
        ratio: null,
        revenue: null,
        salaryCost: null,
        storeId: store.storeId,
        total: 0,
      };
      existing.revenue = store.revenue;
      existing.salaryCost = store.salaryCost;
      existing.ratio = store.payrollToRevenueRatio;
      map.set(store.storeId, existing);
    }

    return [...map.values()].sort((a, b) => Number(b.isOperating) - Number(a.isOperating) || (b.revenue ?? -1) - (a.revenue ?? -1));
  }, [analytics?.tasks.store_rates, auth.availableStores, closures, payrollStats?.stores, today]);

  const taskDistribution = useMemo(() => {
    const t = analytics?.tasks;
    if (!t) return null;
    const total = t.approved + t.submitted + t.pending + t.rejected + t.overdue;
    return {
      completionRate: t.completion_rate,
      segments: [
        { color: 'bg-brand-500', count: t.approved, dot: 'bg-brand-500', label: '已通过' },
        { color: 'bg-sky-500', count: t.submitted, dot: 'bg-sky-500', label: '待审核' },
        { color: 'bg-amber-400', count: t.pending, dot: 'bg-amber-400', label: '待办' },
        { color: 'bg-orange-500', count: t.rejected, dot: 'bg-orange-500', label: '已退回' },
        { color: 'bg-red-500', count: t.overdue, dot: 'bg-red-500', label: '已逾期' },
      ],
      total,
    };
  }, [analytics?.tasks]);

  const trendBars = useMemo(() => {
    const raw = analytics?.arrival.trend ?? [];
    const sliced = raw.length > 14 ? raw.slice(-14) : raw;
    const max = Math.max(1, ...sliced.map((point) => point.count));
    return { max, points: sliced };
  }, [analytics?.arrival.trend]);

  const payrollCompleteness = payrollSummary && payrollSummary.employeeCount > 0
    ? Math.round((payrollSummary.completeCount / payrollSummary.employeeCount) * 100)
    : null;
  const laborRatioStyle = ratioTone(payrollStats?.overallPayrollRatio ?? null);
  const periodLabel = period === 'today' ? '今日' : period === 'month' ? '本月' : '近 7 天';

  const alertItems = [
    (summary?.count ?? 0) > 0 ? { label: `待审批 ${summary!.count} 项`, to: '/app/todos', tone: 'danger' as const } : null,
    (analytics?.tasks.overdue ?? 0) > 0 ? { label: `逾期任务 ${analytics!.tasks.overdue} 项`, to: '/app/admin/tasks', tone: 'danger' as const } : null,
    (analytics?.tasks.rejected ?? 0) > 0 ? { label: `待整改 ${analytics!.tasks.rejected} 项`, to: '/app/admin/tasks', tone: 'warning' as const } : null,
    (overview?.arrival_pending ?? 0) > 0 ? { label: `未阅到货 ${overview!.arrival_pending} 单`, to: '/app/admin/arrivals', tone: 'warning' as const } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <section className="app-page-min-height bg-canvas px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-3.5">
        {/* 1. Hero Header & Live Status Strip */}
        <header className="ui-card relative overflow-hidden p-4 sm:p-5">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-700 via-brand-500 to-emerald-400" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-bold tracking-wide text-brand-700">门店运营系统 · 管理员</p>
                {storeStatusSummary.total > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-100">
                    <Store aria-hidden="true" className="h-3 w-3" />
                    在营 {storeStatusSummary.operating.length} 家
                    {storeStatusSummary.closed.length > 0 ? ` · 已关店 ${storeStatusSummary.closed.length}` : ''}
                  </span>
                ) : null}
              </div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">运营概览</h1>
              <p className="mt-0.5 text-xs font-medium text-slate-500 sm:text-sm">{formatChinaDateLabel(today)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <IconButton aria-label="刷新运营概览" disabled={refreshing} onClick={() => void handleManualRefresh()}>
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin text-brand-600' : ''}`} />
              </IconButton>
              <IconButton aria-label="退出登录" onClick={() => void auth.signOut()}>
                <LogOut className="h-5 w-5" />
              </IconButton>
            </div>
          </div>

          <div className="mt-3.5 border-t border-slate-100 pt-3">
            {alertItems.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-600">
                  <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 text-amber-600" />
                  优先关注：
                </span>
                {alertItems.map((alert) => (
                  <Link
                    className={`ui-interactive inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${
                      alert.tone === 'danger'
                        ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100/70'
                        : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100/70'
                    }`}
                    key={alert.label}
                    to={alert.to}
                  >
                    <span>{alert.label}</span>
                    <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </Link>
                ))}
              </div>
            ) : !coreLoading && overview ? (
              <div className="flex items-center gap-2 text-xs font-semibold text-brand-700">
                <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span>当前门店运营平稳，暂无积压待办或未阅异常。</span>
              </div>
            ) : (
              <div aria-hidden="true" className="ui-skeleton h-5 w-52" />
            )}
          </div>
        </header>

        {message ? <FeedbackBanner tone="danger">{message}</FeedbackBanner> : null}

        {/* 2. Monthly Financial & Labor Efficiency Hero Cards */}
        <section aria-label="本月经营与薪资概览" className="grid gap-3 md:grid-cols-2">
          <Link className="ui-card ui-interactive group relative flex flex-col justify-between overflow-hidden p-4 hover:border-brand-200 hover:shadow-card-hover sm:p-5" to="/app/admin/payroll">
            <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-brand-500" />
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700 ring-1 ring-brand-100">
                <CircleDollarSign aria-hidden="true" className="h-3.5 w-3.5" />
                实时薪资成本
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-brand-700">
                薪资管理
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-3">
              <p className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">
                {payrollSummary ? formatMoney(payrollSummary.knownEstimatedTotal) : '—'}
              </p>
              <span className="shrink-0 text-xs font-semibold text-slate-500">
                数据完整 {payrollSummary?.completeCount ?? '—'}/{payrollSummary?.employeeCount ?? '—'}
              </span>
            </div>
            <div className="mt-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all duration-300"
                  style={{ width: `${payrollCompleteness ?? 0}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>截至今日（本月累计预估）</span>
                {payrollStats ? (
                  <span className="tabular-nums font-medium text-slate-600">
                    总工时 {payrollStats.totalHours}h · 均时薪 {payrollStats.averageHourlyCost != null ? `${formatMoney(payrollStats.averageHourlyCost)}/h` : '—'}
                  </span>
                ) : null}
              </div>
            </div>
          </Link>

          <Link className="ui-card ui-interactive group relative flex flex-col justify-between overflow-hidden p-4 hover:border-brand-200 hover:shadow-card-hover sm:p-5" to="/app/admin/payroll?tab=statistics">
            <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-[3px] ${laborRatioStyle.bar}`} />
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200/80">
                <TrendingUp aria-hidden="true" className="h-3.5 w-3.5 text-brand-700" />
                本月累计营收与人效
              </span>
              <StatusBadge tone={laborRatioStyle.badge}>
                人力占比 {formatPercent(payrollStats?.overallPayrollRatio ?? null)}
              </StatusBadge>
            </div>
            {statsLoading && !payrollStats ? (
              <div className="mt-3 space-y-2.5">
                <div className="ui-skeleton h-8 w-36" />
                <div className="ui-skeleton h-2 w-full" />
              </div>
            ) : (
              <>
                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <p className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">
                    {payrollStats ? formatMoney(payrollStats.totalRevenue) : '—'}
                  </p>
                  <span className="shrink-0 text-xs font-semibold text-slate-500">{laborRatioStyle.label}</span>
                </div>
                <div className="mt-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${laborRatioStyle.bar}`}
                      style={{ width: `${Math.min(100, Math.max(0, (payrollStats?.overallPayrollRatio ?? 0) * 100))}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>本月在营及历史结算汇总</span>
                    <span className="inline-flex items-center gap-0.5 font-semibold text-brand-700">
                      综合统计
                      <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>
              </>
            )}
          </Link>
        </section>

        {/* 3. Today's Store Operations 4-Card Grid */}
        <section aria-label="今日作业概览" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <MetricCard
            icon={AlertTriangle}
            label="待处理"
            note="货品申请与任务审核"
            tone={(summary?.count ?? 0) > 0 ? 'danger' : 'brand'}
            to="/app/todos"
            value={summary?.count ?? '—'}
          />
          <MetricCard
            icon={PackageCheck}
            label="到货数量"
            note={overview && overview.arrival_pending > 0 ? `今日上报 · 未阅 ${overview.arrival_pending} 单` : '今日到货上报'}
            tone="warning"
            to="/app/admin/arrivals"
            value={overview?.arrival_today ?? '—'}
          />
          <MetricCard
            icon={ClipboardList}
            label="今日盘点"
            note={`进行中 ${overview?.inventory_pending ?? '—'}`}
            tone="info"
            to="/app/history"
            value={overview?.inventory_completed_today ?? '—'}
          />
          <MetricCard
            icon={ClipboardCheck}
            label="执行中任务"
            note={`已完成 ${overview?.v2_task_completed ?? '—'}`}
            tone="brand"
            to="/app/admin/tasks"
            value={overview?.v2_task_active ?? '—'}
          />
        </section>

        {/* 4. Actionable Todo Category Breakdown */}
        {summary ? (
          <SectionCard>
            <SectionHeader
              action={(
                <Link className="inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2 text-xs font-bold text-brand-700 hover:bg-brand-50 sm:text-sm" to="/app/todos">
                  进入待办
                  <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              )}
              description={summary.count > 0 ? `共 ${summary.count} 项待办，按分类直达处理。` : '所有审批与提醒均已处理完毕。'}
              icon={Layers}
              title="待办分类直达"
            />
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {todoBreakdown.map((item) => {
                const active = item.count > 0;
                const activeClasses = item.tone === 'danger'
                  ? 'border-red-200/90 bg-red-50/60 text-red-900 hover:bg-red-50'
                  : item.tone === 'warning'
                    ? 'border-amber-200/90 bg-amber-50/60 text-amber-950 hover:bg-amber-50'
                    : item.tone === 'info'
                      ? 'border-sky-200/90 bg-sky-50/60 text-sky-900 hover:bg-sky-50'
                      : 'border-emerald-200/90 bg-emerald-50/60 text-emerald-900 hover:bg-emerald-50';
                return (
                  <Link
                    className={`ui-interactive flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-semibold sm:text-sm ${
                      active ? activeClasses : 'border-slate-200/70 bg-slate-50/60 text-slate-400 hover:bg-slate-100/70'
                    }`}
                    key={item.label}
                    to="/app/todos"
                  >
                    <span className="truncate">{item.label}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                      active ? 'bg-white/90 text-slate-900 shadow-sm' : 'text-slate-400'
                    }`}>
                      {item.count}
                    </span>
                  </Link>
                );
              })}
            </div>
          </SectionCard>
        ) : coreLoading ? <SkeletonCard lines={3} /> : null}

        {/* 5. Interactive Store Execution & Visual Trends Board */}
        <SectionCard>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SectionHeader
              description={`按授权门店汇总${periodLabel}任务执行与到货趋势。`}
              icon={Activity}
              title="门店执行与趋势看板"
            />
            <SegmentedControl
              className="grid-cols-3 sm:w-56"
              items={[
                { active: period === 'today', label: '今日', onClick: () => setPeriod('today') },
                { active: period === '7d', label: '近 7 天', onClick: () => setPeriod('7d') },
                { active: period === 'month', label: '本月', onClick: () => setPeriod('month') },
              ]}
            />
          </div>

          {analyticsError ? (
            <div className="mt-3">
              <FeedbackBanner tone="warning">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{analyticsError}</span>
                  <button className="rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-bold text-amber-900" onClick={() => void loadAnalyticsForPeriod(period)} type="button">重试</button>
                </div>
              </FeedbackBanner>
            </div>
          ) : null}

          {analyticsLoading && !analytics ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="ui-skeleton h-40 w-full" />
              <div className="ui-skeleton h-40 w-full" />
            </div>
          ) : (
            <div className="mt-4 grid gap-3.5 lg:grid-cols-2">
              {/* 5A. Per-store health & financial comparison */}
              <div className="ui-card-muted flex flex-col justify-between p-3.5 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900">分门店健康度对比</h3>
                  <Link className="text-xs font-bold text-brand-700 hover:underline" to="/app/admin/tasks">任务明细</Link>
                </div>
                <div className="mt-3 space-y-2.5">
                  {storeRows.length > 0 ? storeRows.map((store) => (
                    <Link
                      className="ui-interactive block rounded-xl border border-slate-200/80 bg-white p-3 hover:border-brand-200"
                      key={store.storeId}
                      to="/app/admin/tasks"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <b className="truncate text-sm text-slate-900">{store.name}</b>
                          <StatusBadge tone={store.isOperating ? 'success' : 'neutral'}>
                            {store.isOperating ? '在营' : '已关店'}
                          </StatusBadge>
                        </div>
                        <span className="shrink-0 text-xs font-bold tabular-nums text-brand-700">
                          {store.rate !== null ? `任务 ${store.approved}/${store.total} · ${store.rate}%` : `${periodLabel}暂无任务`}
                        </span>
                      </div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            store.rate === null ? 'bg-slate-200' : store.rate >= 80 ? 'bg-brand-500' : store.rate >= 50 ? 'bg-amber-400' : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.min(100, store.rate ?? 0)}%` }}
                        />
                      </div>
                      {store.revenue !== null || store.salaryCost !== null ? (
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-slate-500">
                          <span>本月营收 <b className="text-slate-800">{formatMoney(store.revenue ?? 0)}</b></span>
                          <span>薪资 <b className="text-slate-800">{formatMoney(store.salaryCost ?? 0)}</b></span>
                          {store.ratio !== null ? <span>占比 <b className="text-brand-700">{formatPercent(store.ratio)}</b></span> : null}
                        </div>
                      ) : null}
                    </Link>
                  )) : (
                    <p className="py-4 text-center text-xs text-slate-500">暂无门店执行数据。</p>
                  )}
                </div>
              </div>

              {/* 5B. Task status stacked bar + inspection issues */}
              <div className="ui-card-muted flex flex-col justify-between gap-3.5 p-3.5 sm:p-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900">{periodLabel}任务状态分布</h3>
                    <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-bold tabular-nums text-brand-700 ring-1 ring-brand-100">
                      完成率 {taskDistribution?.completionRate ?? 0}%
                    </span>
                  </div>
                  <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-slate-200/80">
                    {taskDistribution && taskDistribution.total > 0 ? taskDistribution.segments.map((segment) => (
                      segment.count > 0 ? (
                        <div
                          className={`${segment.color} h-full transition-all duration-300`}
                          key={segment.label}
                          style={{ width: `${(segment.count / taskDistribution.total) * 100}%` }}
                          title={`${segment.label} ${segment.count}`}
                        />
                      ) : null
                    )) : null}
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-1.5 text-center">
                    {(taskDistribution?.segments ?? []).map((segment) => (
                      <Link className="rounded-lg border border-slate-200/70 bg-white px-1 py-2 hover:border-brand-200" key={segment.label} to="/app/admin/tasks">
                        <p className="text-sm font-bold tabular-nums text-slate-900">{segment.count}</p>
                        <p className="mt-0.5 flex items-center justify-center gap-1 text-[10px] font-medium text-slate-500">
                          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${segment.dot}`} />
                          {segment.label}
                        </p>
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200/80 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-700">巡店整改与高频问题</span>
                    <span className="text-xs font-semibold tabular-nums text-slate-500">
                      问题 {analytics?.inspection.issue_count ?? 0} · 整改率 {analytics?.inspection.correction_completion_rate ?? 0}%
                    </span>
                  </div>
                  {analytics?.inspection.frequent_issues.length ? (
                    <ol className="mt-2 space-y-1.5">
                      {analytics.inspection.frequent_issues.slice(0, 3).map((issue, index) => (
                        <li className="flex items-center justify-between gap-2 rounded-lg bg-red-50/70 px-2.5 py-1.5 text-xs" key={issue.label}>
                          <span className="truncate font-medium text-slate-800">{index + 1}. {issue.label}</span>
                          <b className="shrink-0 tabular-nums text-red-700">{issue.count} 次</b>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-brand-700">
                      <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                      {periodLabel}暂无高频巡店异常。
                    </p>
                  )}
                </div>
              </div>

              {/* 5C. Arrival Trend Mini Bar Chart (full width below on lg) */}
              <div className="ui-card-muted p-3.5 sm:p-4 lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{periodLabel}到货趋势</h3>
                    <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                      期间上报 <b className="text-slate-800">{analytics?.arrival.today ?? 0}</b> 单 · 覆盖 <b className="text-slate-800">{analytics?.arrival.stores ?? 0}</b> 家门店 · 货品 <b className="text-slate-800">{analytics?.arrival.product_kinds ?? 0}</b> 种 · 数量合计 <b className="text-slate-800">{analytics?.arrival.quantity_total ?? 0}</b>
                    </p>
                  </div>
                  <Link className="inline-flex items-center gap-0.5 text-xs font-bold text-brand-700 hover:underline" to="/app/admin/arrivals/summary">
                    单品到货汇总
                    <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </Link>
                </div>

                {trendBars.points.length > 0 ? (
                  <div className="mt-3 flex h-24 items-end gap-1.5 rounded-xl border border-slate-200/70 bg-white px-3 pb-2.5 pt-3">
                    {trendBars.points.map((point) => {
                      const isToday = point.date === today;
                      const heightPx = Math.max(8, Math.round((point.count / trendBars.max) * 48));
                      return (
                        <div className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" key={point.date}>
                          <span className={`text-[10px] font-bold tabular-nums ${isToday ? 'text-brand-700' : 'text-slate-500'}`}>
                            {point.count}
                          </span>
                          <div
                            className={`w-full max-w-[28px] rounded-t-md transition-all duration-300 ${
                              isToday ? 'bg-brand-600' : 'bg-amber-400/85'
                            }`}
                            style={{ height: `${heightPx}px` }}
                          />
                          <span className={`truncate text-[10px] tabular-nums ${isToday ? 'font-bold text-brand-700' : 'text-slate-400'}`}>
                            {point.date.slice(5)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-slate-200/70 bg-white py-5 text-center text-xs text-slate-500">
                    {periodLabel}暂无到货趋势数据。
                  </p>
                )}
              </div>
            </div>
          )}
        </SectionCard>

        {/* 6. High-Frequency Admin Quick Actions */}
        <SectionCard>
          <SectionHeader description="常用管理模块一键直达。" title="快捷操作" />
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {quickActions.map(({ icon: Icon, label, tint, to }) => (
              <Link
                className="ui-interactive flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50/70 px-2 py-2.5 text-center hover:border-brand-200 hover:bg-brand-50/40"
                key={to}
                to={to}
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tint}`}>
                  <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
                </span>
                <span className="line-clamp-1 text-xs font-bold text-slate-800">{label}</span>
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>
    </section>
  );
}
