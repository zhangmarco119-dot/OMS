import { Bell, ChevronRight, ClipboardCheck, LogOut, RefreshCw, Store, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadAdminOperationOverview, type AdminOperationOverview } from '../services/admin-operation-overview.service';
import { loadNotifications, markNotificationRead, type UserNotification } from '../services/notifications.service';
import { loadTodoSummary, type TodoSummary } from '../services/todo.service';
import { loadNotices, type NoticeListItem } from '../services/v2-content.service';
import { loadV2Tasks, type V2TaskRow } from '../services/v2-tasks.service';

const notificationLink = (notification: UserNotification) => {
  if (notification.entity_type === 'v2_notice') return `/app/notices/${notification.entity_id}`;
  if (notification.entity_type === 'v2_task') return `/app/tasks/${notification.entity_id}`;
  if (notification.entity_type === 'v2_sop') return '/app/sops';
  return '/app/todos';
};

export function DashboardPage() {
  return useAuth().profile?.role === 'admin' ? <AdminDashboard /> : <StaffDashboard />;
}

function StaffDashboard() {
  const auth = useAuth();
  const [notices, setNotices] = useState<NoticeListItem[]>([]);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [tasks, setTasks] = useState<V2TaskRow[]>([]);
  const [summary, setSummary] = useState<TodoSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [dismissedNoticeId, setDismissedNoticeId] = useState<string | null>(() => window.localStorage.getItem(`dismissed-home-notice:${auth.profile?.id ?? 'anonymous'}`));
  const load = useCallback(async () => {
    if (!supabase || !auth.profile) return;
    try {
      const [nextNotices, nextNotifications, nextTasks, nextSummary] = await Promise.all([
        loadNotices(supabase), loadNotifications(supabase), loadV2Tasks(supabase, auth.store?.id), loadTodoSummary(supabase, { isAdmin: false, profileId: auth.profile.id, storeId: auth.store?.id }),
      ]);
      const now = Date.now();
      setNotices(nextNotices.filter((notice) => notice.status === 'published' && (!notice.expires_at || new Date(notice.expires_at).getTime() > now)));
      setNotifications(nextNotifications); setTasks(nextTasks.filter((task) => ['pending', 'in_progress', 'rejected', 'overdue'].includes(task.status)).slice(0, 3)); setSummary(nextSummary); setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : '首页信息加载失败。'); }
  }, [auth.profile, auth.store?.id]);
  useEffect(() => { void load(); }, [load]);
  const changeStore = async (storeId: string) => { setSwitching(true); try { await auth.switchStore(storeId); } catch (error) { setMessage(error instanceof Error ? error.message : '切换门店失败。'); } finally { setSwitching(false); } };
  const openNotification = (notification: UserNotification) => { if (supabase && !notification.is_read) void markNotificationRead(supabase, notification.id).then(load).catch(() => undefined); };
  const visibleTickerNotices = notices.filter((notice) => notice.id !== dismissedNoticeId);
  const dismissTicker = () => { const id = visibleTickerNotices[0]?.id; if (!id) return; window.localStorage.setItem(`dismissed-home-notice:${auth.profile?.id ?? 'anonymous'}`, id); setDismissedNoticeId(id); };
  return <section className="min-h-screen bg-slate-50 px-4 py-5"><div className="mx-auto flex max-w-5xl flex-col gap-4"><header className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-xs font-bold text-brand-700">门店运营系统 · 当前门店</p>{auth.availableStores.length > 1 ? <select aria-label="切换当前门店" className="mt-1 min-h-11 w-full max-w-md rounded-lg border border-slate-200 bg-slate-50 px-3 text-lg font-bold text-slate-900" disabled={switching} onChange={(event) => void changeStore(event.target.value)} value={auth.store?.id ?? ''}>{auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select> : <h1 className="mt-1 break-words text-xl font-bold text-slate-900">{auth.store?.name ?? '未绑定门店'}</h1>}<p className="mt-1 text-sm text-slate-500">{auth.profile?.role === 'manager' ? '店长' : '员工'} · {auth.profile?.display_name ?? auth.user?.email}</p></div><button aria-label="退出登录" className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-600" onClick={() => void auth.signOut()} type="button"><LogOut className="h-5 w-5" /></button></div></header>{visibleTickerNotices.length ? <div className="notice-ticker flex min-h-12 items-center gap-2 overflow-hidden rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white shadow-sm"><Link className="flex min-w-0 flex-1 items-center gap-2" to={`/app/notices/${visibleTickerNotices[0].id}`}><Bell className="h-4 w-4 shrink-0" /><span className="notice-ticker-text">最新公告：{visibleTickerNotices.map((notice) => notice.title).join('　·　')}</span><ChevronRight className="ml-auto h-4 w-4 shrink-0" /></Link><button aria-label="关闭当前公告提示" className="h-10 w-10 shrink-0 rounded-lg" onClick={dismissTicker} type="button"><X className="mx-auto h-4 w-4" /></button></div> : null}{message ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p> : null}<section className="grid grid-cols-2 gap-3"><Link className="rounded-xl bg-white p-4 shadow-sm" to="/app/todos"><p className="text-sm font-bold text-brand-700">今日待办</p><p className="mt-1 text-3xl font-bold text-slate-900">{summary?.count ?? '—'}</p><p className="mt-1 text-xs text-slate-500">任务及需确认公告</p></Link><Link className="rounded-xl bg-white p-4 shadow-sm" to="/app/workbench"><p className="text-sm font-bold text-brand-700">工作台</p><p className="mt-1 text-lg font-bold text-slate-900">进入业务功能</p><p className="mt-1 text-xs text-slate-500">点货、订货、到货与任务</p></Link></section><section className="rounded-xl bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><p className="font-bold text-slate-900">即将截止 / 需整改</p><p className="mt-1 text-sm text-slate-500">只展示需要处理的任务</p></div><Link className="text-sm font-bold text-brand-700" to="/app/todos">全部待办</Link></div><div className="mt-3 space-y-2">{tasks.map((task) => <Link className="block rounded-lg bg-slate-50 p-3" key={task.id} to={`/app/tasks/${task.id}`}><b>{task.name}</b><p className={task.status === 'rejected' ? 'mt-1 text-sm text-red-700' : 'mt-1 text-sm text-slate-500'}>{task.status === 'rejected' ? `需整改：${task.review_note || '请处理指定项目。'}` : `截止：${new Date(task.due_at).toLocaleString('zh-CN')}`}</p></Link>)}{tasks.length === 0 ? <p className="py-3 text-sm text-slate-500">当前没有待处理任务。</p> : null}</div></section><section className="rounded-xl bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><p className="font-bold text-slate-900">通知中心（未读 {notifications.filter((notification) => !notification.is_read).length}）</p><button aria-label="刷新首页" className="h-10 w-10 rounded-lg border" onClick={() => void load()} type="button"><RefreshCw className="mx-auto h-4 w-4" /></button></div><div className="mt-2 divide-y">{notifications.slice(0, 3).map((notification) => <Link className="block py-3" key={notification.id} onClick={() => openNotification(notification)} to={notificationLink(notification)}><p className="text-sm font-semibold text-slate-800">{notification.is_read ? '' : '未读 · '}{notification.title}</p><p className="mt-1 line-clamp-1 text-xs text-slate-500">{notification.body} · {new Date(notification.created_at).toLocaleString('zh-CN')}</p></Link>)}{notifications.length === 0 ? <p className="py-3 text-sm text-slate-500">暂无通知。</p> : null}</div></section></div></section>;
}

function AdminDashboard() {
  const auth = useAuth(); const [overview, setOverview] = useState<AdminOperationOverview | null>(null); const [summary, setSummary] = useState<TodoSummary | null>(null); const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => { if (!supabase || !auth.profile) return; try { const [nextOverview, nextSummary] = await Promise.all([loadAdminOperationOverview(supabase), loadTodoSummary(supabase, { isAdmin: true, profileId: auth.profile.id })]); setOverview(nextOverview); setSummary(nextSummary); setMessage(null); } catch (error) { setMessage(error instanceof Error ? error.message : '运营概览加载失败。'); } }, [auth.profile]);
  useEffect(() => { void load(); }, [load]);
  return <section className="min-h-screen bg-slate-50 px-4 py-5"><div className="mx-auto flex max-w-5xl flex-col gap-4"><header className="flex items-start justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div><p className="text-sm font-bold text-brand-700">门店运营系统 · 管理员</p><h1 className="mt-1 text-2xl font-bold text-slate-900">运营概览</h1><p className="mt-1 text-sm text-slate-500">异常与待处理事项集中显示。</p></div><button aria-label="退出登录" className="h-11 w-11 rounded-lg bg-slate-100" onClick={() => void auth.signOut()} type="button"><LogOut className="mx-auto h-5 w-5" /></button></header>{message ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p> : null}<section className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Link className="rounded-xl bg-white p-4 shadow-sm" to="/app/todos"><p className="text-xs font-bold text-red-700">待处理</p><p className="mt-1 text-3xl font-bold">{summary?.count ?? '—'}</p><p className="text-xs text-slate-500">商品申请与任务审核</p></Link><Link className="rounded-xl bg-white p-4 shadow-sm" to="/app/admin/arrivals"><p className="text-xs font-bold text-amber-700">到货待看</p><p className="mt-1 text-3xl font-bold">{overview?.arrival_pending ?? '—'}</p><p className="text-xs text-slate-500">今日到货 {overview?.arrival_today ?? '—'}</p></Link><Link className="rounded-xl bg-white p-4 shadow-sm" to="/app/history"><p className="text-xs font-bold text-sky-700">盘点</p><p className="mt-1 text-3xl font-bold">{overview?.inventory_completed_today ?? '—'}</p><p className="text-xs text-slate-500">进行中 {overview?.inventory_pending ?? '—'}</p></Link><Link className="rounded-xl bg-white p-4 shadow-sm" to="/app/admin/tasks"><p className="text-xs font-bold text-brand-700">任务</p><p className="mt-1 text-3xl font-bold">{overview?.v2_task_active ?? '—'}</p><p className="text-xs text-slate-500">已完成 {overview?.v2_task_completed ?? '—'}</p></Link></section><Link className="flex min-h-14 items-center gap-3 rounded-xl bg-white px-4 font-bold text-slate-800 shadow-sm" to="/app/workbench"><Store className="h-5 w-5 text-brand-700" />所有管理功能已归入工作台<ChevronRight className="ml-auto h-5 w-5 text-slate-400" /></Link><Link className="flex min-h-14 items-center gap-3 rounded-xl bg-white px-4 font-bold text-slate-800 shadow-sm" to="/app/todos"><ClipboardCheck className="h-5 w-5 text-brand-700" />查看需要审核或同意的事项<ChevronRight className="ml-auto h-5 w-5 text-slate-400" /></Link></div></section>;
}
