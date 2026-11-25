import { Bell, CalendarClock, ChevronRight, CircleDollarSign, ClipboardList, Clock3, ListTodo, LogOut, RefreshCw, Store, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { IconButton } from '../components/ui/Actions';
import { FeedbackBanner, StatusBadge } from '../components/ui/Feedback';
import { MetricCard, SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { AdminOperationBoard } from '../features/dashboard/AdminOperationBoard';
import { formatMoney, todayInChina, type PayrollEstimate } from '../features/payroll/model';
import { v2TaskStatusLabel } from '../features/v2-tasks/taskPresentation';
import { supabase } from '../lib/supabase';
import { loadNotifications, markNotificationRead, type UserNotification } from '../services/notifications.service';
import { loadMyPayrollEstimate } from '../services/payroll.service';
import { loadTodoSummary, type TodoSummary } from '../services/todo.service';
import { loadNotices, type NoticeListItem } from '../services/v2-content.service';
import { loadV2Tasks, type V2TaskListRow } from '../services/v2-tasks.service';

const notificationLink = (notification: UserNotification) => {
  if (notification.entity_type === 'v2_notice') return `/app/notices/${notification.entity_id}`;
  if (notification.entity_type === 'v2_task') return notification.type === 'v2_task_submitted'
    ? `/app/admin/tasks/${notification.entity_id}`
    : `/app/tasks/${notification.entity_id}`;
  if (notification.entity_type === 'v2_sop') return `/app/sops/${notification.entity_id}`;
  if (notification.entity_type === 'payroll_penalty') return '/app/payroll';
  if (notification.entity_type === 'payroll_overtime') return notification.type === 'payroll_overtime_approved' || notification.type === 'payroll_overtime_rejected' ? '/app/overtime?tab=records' : '/app/overtime?tab=submit';
  if (notification.entity_type === 'payroll_payslip') return `/app/payroll?tab=payslips&payslip=${notification.entity_id}`;
  if (notification.entity_type === 'operation_report') return `/app/operation-reports/${notification.entity_id}`;
  return '/app/todos';
};

const formatTodayLabel = () => {
  const iso = todayInChina();
  const date = new Date(`${iso}T12:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return iso;
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long' }).format(date);
  const [year, month, day] = iso.split('-');
  return `${year}年${Number(month)}月${Number(day)}日 · ${weekday}`;
};

export function DashboardPage() {
  return useAuth().profile?.role === 'admin' ? <AdminOperationBoard /> : <StaffDashboard />;
}

function StaffDashboard() {
  const auth = useAuth();
  const navigate = useNavigate();
  const todayLabel = useMemo(() => formatTodayLabel(), []);
  const [notices, setNotices] = useState<NoticeListItem[]>([]);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [tasks, setTasks] = useState<V2TaskListRow[]>([]);
  const [summary, setSummary] = useState<TodoSummary | null>(null);
  const [partTimePayroll, setPartTimePayroll] = useState<PayrollEstimate | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const loadRequestIdRef = useRef(0);
  const readingNotificationIdsRef = useRef(new Set<string>());
  const [dismissedNoticeId, setDismissedNoticeId] = useState<string | null>(() => window.localStorage.getItem(`dismissed-home-notice:${auth.profile?.id ?? 'anonymous'}`));

  const load = useCallback(async () => {
    if (!supabase || !auth.profile) return;
    const requestId = ++loadRequestIdRef.current;
    try {
      const [nextNotices, nextNotifications, nextTasks, nextSummary, nextPartTimePayroll] = await Promise.all([
        loadNotices(supabase),
        loadNotifications(supabase),
        loadV2Tasks(supabase, auth.store?.id),
        loadTodoSummary(supabase, { isAdmin: false, isManager: auth.profile.role === 'manager', profileId: auth.profile.id, storeId: auth.store?.id, storeIds: auth.availableStores.map((store) => store.id) }),
        auth.profile.employment_type === 'part_time' ? loadMyPayrollEstimate(supabase, auth.profile.id, todayInChina()) : Promise.resolve(null),
      ]);
      if (requestId !== loadRequestIdRef.current) return;
      const now = Date.now();
      setNotices(nextNotices.filter((notice) => notice.status === 'published' && !notice.isRead && (!notice.expires_at || new Date(notice.expires_at).getTime() > now)));
      setNotifications(nextNotifications);
      setTasks(nextTasks.filter((task) => ['pending', 'in_progress', 'rejected', 'overdue'].includes(task.status)).slice(0, 3));
      setSummary(nextSummary);
      setPartTimePayroll(nextPartTimePayroll);
      setMessage(null);
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) return;
      setMessage(error instanceof Error ? error.message : '首页信息加载失败。');
    }
  }, [auth.availableStores, auth.profile, auth.store?.id]);

  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('storehub:notifications-changed', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('storehub:notifications-changed', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [load]);

  const changeStore = async (storeId: string) => {
    setSwitching(true);
    try { await auth.switchStore(storeId); }
    catch (error) { setMessage(error instanceof Error ? error.message : '切换门店失败。'); }
    finally { setSwitching(false); }
  };

  const openNotification = async (notification: UserNotification) => {
    const destination = notificationLink(notification);
    if (!supabase || notification.is_read) {
      navigate(destination);
      return;
    }
    if (readingNotificationIdsRef.current.has(notification.id)) return;
    readingNotificationIdsRef.current.add(notification.id);
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, is_read: true, read_at: new Date().toISOString() } : item));
    try {
      await markNotificationRead(supabase, notification.id);
      window.dispatchEvent(new Event('storehub:notifications-changed'));
      navigate(destination);
    } catch (error) {
      readingNotificationIdsRef.current.delete(notification.id);
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, is_read: false, read_at: null } : item));
      setMessage(error instanceof Error ? error.message : '通知已读状态更新失败，请重试。');
    }
  };

  const visibleNotifications = notifications.slice(0, 3);
  const visibleUnreadNotificationCount = visibleNotifications.filter((notification) => !notification.is_read).length;
  const visibleTickerNotices = notices.filter((notice) => notice.id !== dismissedNoticeId);
  const dismissTicker = () => {
    const id = visibleTickerNotices[0]?.id;
    if (!id) return;
    window.localStorage.setItem(`dismissed-home-notice:${auth.profile?.id ?? 'anonymous'}`, id);
    setDismissedNoticeId(id);
  };

  const roleText = auth.profile?.employment_type === 'part_time' ? '兼职员工' : auth.profile?.role === 'manager' ? '店长' : '员工';

  return (
    <section className="app-page-min-height bg-canvas px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-3.5">
        <header className="ui-card relative overflow-hidden p-4 sm:p-5">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-700 via-brand-500 to-emerald-400" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="inline-flex items-center gap-1 text-xs font-bold tracking-wide text-brand-700">
                  <Store aria-hidden="true" className="h-3.5 w-3.5" />
                  门店运营系统 · 当前门店
                </p>
                <span className="text-xs text-slate-400">{todayLabel}</span>
              </div>
              {auth.availableStores.length > 1 ? (
                <select aria-label="切换当前门店" className="ui-input mt-2 max-w-md text-lg font-bold" disabled={switching} onChange={(event) => void changeStore(event.target.value)} value={auth.store?.id ?? ''}>
                  {auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              ) : <h1 className="mt-1.5 break-words text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{auth.store?.name ?? '未绑定门店'}</h1>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge tone="success">{roleText}</StatusBadge>
                <span className="text-sm font-medium text-slate-600">{auth.profile?.display_name ?? auth.user?.email}</span>
              </div>
            </div>
            <IconButton aria-label="退出登录" onClick={() => void auth.signOut()}><LogOut className="h-5 w-5" /></IconButton>
          </div>
        </header>

        {visibleTickerNotices.length ? (
          <div className="notice-ticker flex min-h-11 items-center gap-1 overflow-hidden rounded-2xl border border-brand-700 bg-gradient-to-r from-brand-700 to-brand-600 pl-3.5 text-sm font-semibold text-white shadow-sm">
            <Link className="flex min-w-0 flex-1 items-center gap-2" to="/app/notices"><Bell className="h-4 w-4 shrink-0" /><span className="notice-ticker-text">未读公告：{visibleTickerNotices.map((notice) => notice.title).join('　·　')}</span><ChevronRight className="ml-auto h-4 w-4 shrink-0" /></Link>
            <button aria-label="暂时关闭当前公告提示" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-white/10" onClick={dismissTicker} type="button"><X className="h-4 w-4" /></button>
          </div>
        ) : null}

        {message ? <FeedbackBanner tone="danger">{message}</FeedbackBanner> : null}

        {auth.profile?.employment_type === 'part_time' ? (
          <section className="grid grid-cols-2 gap-2.5">
            <MetricCard icon={CalendarClock} label="本月兼职工时" note="仅统计已审批工时" tone="brand" to="/app/overtime?tab=records" value={partTimePayroll ? `${partTimePayroll.partTimeHours} 小时` : '—'} />
            <MetricCard icon={CircleDollarSign} label="本月累计薪资" note="已扣预计个税" tone="brand" to="/app/payroll" value={partTimePayroll ? formatMoney(partTimePayroll.estimatedNetPayable ?? partTimePayroll.knownEstimatedNetPayable ?? partTimePayroll.accruedPartTimeWage) : '—'} />
          </section>
        ) : null}

        <section className="grid grid-cols-2 gap-2.5">
          <MetricCard icon={ListTodo} label="今日待办" note="任务及需确认公告" tone={(summary?.count ?? 0) > 0 ? 'warning' : 'brand'} to="/app/todos" value={summary?.count ?? '—'} />
          {auth.profile?.employment_type === 'part_time'
            ? <MetricCard icon={CalendarClock} label="工时填报" note="快速提交本次兼职工时" tone="info" to="/app/overtime?tab=submit" value="填报" />
            : <MetricCard icon={ClipboardList} label="工作台" note="点货、订货、到货与任务" tone="info" to="/app/workbench" value="进入" />}
        </section>

        <SectionCard>
          <SectionHeader action={<Link className="inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2 text-sm font-bold text-brand-700 hover:bg-brand-50" to="/app/todos">全部待办<ChevronRight aria-hidden="true" className="h-4 w-4" /></Link>} description="只展示即将截止或需要整改的任务。" icon={Clock3} title="近期任务" />
          <div className="mt-3 space-y-2.5">
            {tasks.map((task) => {
              const urgent = task.status === 'rejected' || task.status === 'overdue';
              return (
                <Link
                  className={`ui-interactive block rounded-xl border border-l-4 p-3.5 ${
                    urgent
                      ? 'border-red-200/80 border-l-red-500 bg-red-50/35 hover:bg-red-50/60'
                      : task.status === 'in_progress'
                        ? 'border-sky-200/70 border-l-sky-500 bg-sky-50/25 hover:bg-sky-50/50'
                        : 'border-slate-200/80 border-l-amber-400 bg-slate-50/70 hover:bg-slate-50'
                  }`}
                  key={task.id}
                  to={`/app/tasks/${task.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <b className="line-clamp-2 text-sm text-slate-900">{task.name}</b>
                    <StatusBadge tone={urgent ? 'danger' : task.status === 'in_progress' ? 'info' : 'warning'}>{v2TaskStatusLabel[task.status]}</StatusBadge>
                  </div>
                  <p className={task.status === 'rejected' ? 'mt-1.5 text-sm font-medium text-red-700' : 'mt-1.5 text-xs text-slate-500 sm:text-sm'}>
                    {task.status === 'rejected' ? `整改原因：${task.review_note || '请处理指定项目。'}` : `截止：${new Date(task.due_at).toLocaleString('zh-CN')}`}
                  </p>
                </Link>
              );
            })}
            {tasks.length === 0 ? <p className="rounded-xl bg-slate-50/70 py-4 text-center text-sm text-slate-500">当前没有待处理任务。</p> : null}
          </div>
        </SectionCard>

        <SectionCard>
          <SectionHeader action={<IconButton aria-label="刷新首页" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></IconButton>} description={`未读 ${visibleUnreadNotificationCount} 条`} icon={Bell} title="通知中心" />
          <div className="mt-2 divide-y divide-slate-100">
            {visibleNotifications.map((notification) => (
              <button className="ui-interactive block w-full rounded-xl px-2 py-3 text-left hover:bg-slate-50/90" key={notification.id} onClick={() => void openNotification(notification)} type="button">
                <div className="flex items-center gap-2">
                  <p className={`min-w-0 flex-1 truncate text-sm ${notification.is_read ? 'font-medium text-slate-700' : 'font-bold text-slate-900'}`}>{notification.title}</p>
                  {!notification.is_read ? <StatusBadge tone="success">未读</StatusBadge> : null}
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-slate-500">{notification.body} · {new Date(notification.created_at).toLocaleString('zh-CN')}</p>
              </button>
            ))}
            {notifications.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">暂无通知。</p> : null}
          </div>
        </SectionCard>
      </div>
    </section>
  );
}
