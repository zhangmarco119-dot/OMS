import { Bell, ChevronRight, Clock3, LogOut, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { IconButton } from '../components/ui/Actions';
import { EmptyState, FeedbackBanner, StatusBadge } from '../components/ui/Feedback';
import { MetricCard, SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { v2TaskStatusLabel } from '../features/v2-tasks/taskPresentation';
import { supabase } from '../lib/supabase';
import { loadAdminOperationOverview, type AdminOperationOverview } from '../services/admin-operation-overview.service';
import { loadNotifications, markNotificationRead, type UserNotification } from '../services/notifications.service';
import { loadTodoSummary, type TodoSummary } from '../services/todo.service';
import { loadNotices, type NoticeListItem } from '../services/v2-content.service';
import { loadV2Tasks, type V2TaskRow } from '../services/v2-tasks.service';

const notificationLink = (notification: UserNotification) => {
  if (notification.entity_type === 'v2_notice') return `/app/notices/${notification.entity_id}`;
  if (notification.entity_type === 'v2_task') return `/app/tasks/${notification.entity_id}`;
  if (notification.entity_type === 'v2_sop') return `/app/sops/${notification.entity_id}`;
  if (notification.entity_type === 'payroll_penalty') return '/app/payroll';
  if (notification.entity_type === 'payroll_overtime') return '/app/overtime';
  return '/app/todos';
};

export function DashboardPage() {
  return useAuth().profile?.role === 'admin' ? <AdminDashboard /> : <StaffDashboard />;
}

function StaffDashboard() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [notices, setNotices] = useState<NoticeListItem[]>([]);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [tasks, setTasks] = useState<V2TaskRow[]>([]);
  const [summary, setSummary] = useState<TodoSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const loadRequestIdRef = useRef(0);
  const readingNotificationIdsRef = useRef(new Set<string>());
  const [dismissedNoticeId, setDismissedNoticeId] = useState<string | null>(() => window.localStorage.getItem(`dismissed-home-notice:${auth.profile?.id ?? 'anonymous'}`));

  const load = useCallback(async () => {
    if (!supabase || !auth.profile) return;
    const requestId = ++loadRequestIdRef.current;
    try {
      const [nextNotices, nextNotifications, nextTasks, nextSummary] = await Promise.all([
        loadNotices(supabase),
        loadNotifications(supabase),
        loadV2Tasks(supabase, auth.store?.id),
        loadTodoSummary(supabase, { isAdmin: false, isManager: auth.profile.role === 'manager', profileId: auth.profile.id, storeId: auth.store?.id, storeIds: auth.availableStores.map((store) => store.id) }),
      ]);
      if (requestId !== loadRequestIdRef.current) return;
      const now = Date.now();
      setNotices(nextNotices.filter((notice) => notice.status === 'published' && !notice.isRead && (!notice.expires_at || new Date(notice.expires_at).getTime() > now)));
      setNotifications(nextNotifications);
      setTasks(nextTasks.filter((task) => ['pending', 'in_progress', 'rejected', 'overdue'].includes(task.status)).slice(0, 3));
      setSummary(nextSummary);
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

  return (
    <section className="app-page-min-height bg-canvas px-4 pb-8 pt-4 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-3">
        <header className="ui-card flex items-start justify-between gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-brand-700">门店运营系统 · 当前门店</p>
            {auth.availableStores.length > 1 ? (
              <select aria-label="切换当前门店" className="ui-input mt-1 max-w-md text-lg font-bold" disabled={switching} onChange={(event) => void changeStore(event.target.value)} value={auth.store?.id ?? ''}>
                {auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            ) : <h1 className="mt-1 break-words text-xl font-bold tracking-tight text-slate-900">{auth.store?.name ?? '未绑定门店'}</h1>}
            <p className="mt-1 text-sm text-slate-500">{auth.profile?.role === 'manager' ? '店长' : '员工'} · {auth.profile?.display_name ?? auth.user?.email}</p>
          </div>
          <IconButton aria-label="退出登录" onClick={() => void auth.signOut()}><LogOut className="h-5 w-5" /></IconButton>
        </header>

        {visibleTickerNotices.length ? (
          <div className="notice-ticker flex min-h-11 items-center gap-1 overflow-hidden rounded-xl border border-brand-700 bg-brand-700 pl-3 text-sm font-semibold text-white">
            <Link className="flex min-w-0 flex-1 items-center gap-2" to="/app/notices"><Bell className="h-4 w-4 shrink-0" /><span className="notice-ticker-text">未读公告：{visibleTickerNotices.map((notice) => notice.title).join('　·　')}</span><ChevronRight className="ml-auto h-4 w-4 shrink-0" /></Link>
            <button aria-label="暂时关闭当前公告提示" className="flex h-11 w-11 shrink-0 items-center justify-center" onClick={dismissTicker} type="button"><X className="h-4 w-4" /></button>
          </div>
        ) : null}

        {message ? <FeedbackBanner tone="danger">{message}</FeedbackBanner> : null}

        <section className="grid grid-cols-2 gap-2.5">
          <MetricCard label="今日待办" note="任务及需确认公告" to="/app/todos" value={summary?.count ?? '—'} />
          <MetricCard label="工作台" note="点货、订货、到货与任务" to="/app/workbench" value="进入" />
        </section>

        <SectionCard>
          <SectionHeader action={<Link className="text-sm font-bold text-brand-700" to="/app/todos">全部待办</Link>} description="只展示即将截止或需要整改的任务。" icon={Clock3} title="近期任务" />
          <div className="mt-3 space-y-2">
            {tasks.map((task) => (
              <Link className="ui-interactive block rounded-lg border border-slate-100 bg-slate-50 p-3" key={task.id} to={`/app/tasks/${task.id}`}>
                <div className="flex items-start justify-between gap-3"><b className="line-clamp-2 text-sm text-slate-900">{task.name}</b><StatusBadge tone={task.status === 'rejected' || task.status === 'overdue' ? 'danger' : task.status === 'in_progress' ? 'info' : 'warning'}>{v2TaskStatusLabel[task.status]}</StatusBadge></div>
                <p className={task.status === 'rejected' ? 'mt-1.5 text-sm text-red-700' : 'mt-1.5 text-sm text-slate-500'}>{task.status === 'rejected' ? `整改原因：${task.review_note || '请处理指定项目。'}` : `截止：${new Date(task.due_at).toLocaleString('zh-CN')}`}</p>
              </Link>
            ))}
            {tasks.length === 0 ? <p className="py-2 text-sm text-slate-500">当前没有待处理任务。</p> : null}
          </div>
        </SectionCard>

        <SectionCard>
          <SectionHeader action={<IconButton aria-label="刷新首页" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></IconButton>} description={`未读 ${visibleUnreadNotificationCount} 条`} icon={Bell} title="通知中心" />
          <div className="mt-2 divide-y divide-slate-100">
            {visibleNotifications.map((notification) => (
              <button className="ui-interactive block w-full py-3 text-left" key={notification.id} onClick={() => void openNotification(notification)} type="button">
                <div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{notification.title}</p>{!notification.is_read ? <StatusBadge tone="success">未读</StatusBadge> : null}</div>
                <p className="mt-1 line-clamp-1 text-xs text-slate-500">{notification.body} · {new Date(notification.created_at).toLocaleString('zh-CN')}</p>
              </button>
            ))}
            {notifications.length === 0 ? <p className="py-3 text-sm text-slate-500">暂无通知。</p> : null}
          </div>
        </SectionCard>
      </div>
    </section>
  );
}

function AdminDashboard() {
  const auth = useAuth();
  const [overview, setOverview] = useState<AdminOperationOverview | null>(null);
  const [summary, setSummary] = useState<TodoSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase || !auth.profile) return;
    try {
      const [nextOverview, nextSummary] = await Promise.all([
        loadAdminOperationOverview(supabase),
        loadTodoSummary(supabase, { isAdmin: true, profileId: auth.profile.id }),
      ]);
      setOverview(nextOverview);
      setSummary(nextSummary);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '运营概览加载失败。');
    }
  }, [auth.profile]);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="app-page-min-height bg-canvas px-4 pb-8 pt-4 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-3">
        <header className="ui-card flex items-start justify-between p-4">
          <div><p className="text-xs font-bold text-brand-700">门店运营系统 · 管理员</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">运营概览</h1><p className="mt-1 text-sm text-slate-500">优先查看异常和待处理事项。</p></div>
          <IconButton aria-label="退出登录" onClick={() => void auth.signOut()}><LogOut className="h-5 w-5" /></IconButton>
        </header>
        {message ? <FeedbackBanner tone="danger">{message}</FeedbackBanner> : null}
        <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <MetricCard label="待处理" note="货品申请与任务审核" tone="danger" to="/app/todos" value={summary?.count ?? '—'} />
          <MetricCard label="到货待看" note={`今日到货 ${overview?.arrival_today ?? '—'}`} tone="warning" to="/app/admin/arrivals" value={overview?.arrival_pending ?? '—'} />
          <MetricCard label="今日盘点" note={`进行中 ${overview?.inventory_pending ?? '—'}`} tone="info" to="/app/history" value={overview?.inventory_completed_today ?? '—'} />
          <MetricCard label="执行中任务" note={`已完成 ${overview?.v2_task_completed ?? '—'}`} to="/app/admin/tasks" value={overview?.v2_task_active ?? '—'} />
        </section>
        <Link className="ui-card ui-interactive flex min-h-14 items-center justify-between px-4 font-bold text-slate-800 hover:border-brand-200" to="/app/admin/analytics"><span>查看运营统计</span><ChevronRight className="h-5 w-5 text-slate-400" /></Link>
        {!message && !overview ? <EmptyState description="数据加载完成后会显示门店运营摘要。" title="正在准备运营数据" /> : null}
      </div>
    </section>
  );
}
