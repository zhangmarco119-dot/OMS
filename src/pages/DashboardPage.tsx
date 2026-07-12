import { Bell, CheckCheck, ClipboardList, History, LogOut, PackageCheck, PackagePlus, Settings, Store, UserRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { featureFlags } from '../config/featureFlags';
import { canOperateV2Modules } from '../features/access/roleCapabilities';
import { AdminArrivalOverview } from '../features/arrivals/AdminArrivalOverview';
import { useAuth } from '../features/auth/AuthContext';
import { loadUnreadSubmittedTasks, markSubmittedTasksRead, type HistoryTask } from '../features/history/historyService';
import { supabase } from '../lib/supabase';
import type { TaskType } from '../types/domain';

const actions = [
  {
    to: '/app/inventory',
    label: '点货',
    description: '逐项录入实际库存，自动保存草稿',
    icon: ClipboardList,
    className: 'from-[#2f6f7e] to-[#184c5c]',
  },
  {
    to: '/app/order',
    label: '订货',
    description: '填写订货数量，支持标记无需订货',
    icon: PackagePlus,
    className: 'from-[#5f7f3a] to-[#38541f]',
  },
];

const arrivalAction = {
  to: '/app/arrivals',
  label: '到货上报',
  description: '拍摄面单和货品，登记本次到货',
  icon: PackageCheck,
  className: 'from-[#7b5a35] to-[#50381f]',
};

const taskTypeLabel: Record<TaskType, string> = {
  inventory: '点货',
  order: '订货',
};

const seenStorageKey = (profileId: string) => `admin-seen-submitted-tasks:${profileId}`;

const formatDateTime = (value: string | null) => {
  if (!value) {
    return '未记录时间';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

export function DashboardPage() {
  const auth = useAuth();
  const isAdmin = auth.profile?.role === 'admin';

  if (isAdmin) {
    return <AdminDashboard />;
  }

  return <StaffDashboard />;
}

function StaffDashboard() {
  const auth = useAuth();
  const [switchingStore, setSwitchingStore] = useState(false);
  const [storeMessage, setStoreMessage] = useState<string | null>(null);
  const dashboardActions = featureFlags.arrivalEntry && canOperateV2Modules(auth.profile?.role)
    ? [...actions, arrivalAction]
    : actions;

  const handleSignOut = () => {
    void auth.signOut();
  };

  const changeStore = async (storeId: string) => {
    setSwitchingStore(true);
    setStoreMessage(null);
    try {
      await auth.switchStore(storeId);
    } catch (error) {
      setStoreMessage(error instanceof Error ? error.message : '切换门店失败。');
    } finally {
      setSwitchingStore(false);
    }
  };

  return (
    <section className="min-h-screen bg-slate-50 px-4 py-5">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="rounded-lg bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-slate-500">当前门店</p>
              <select aria-label="切换当前门店" className="mt-1 min-h-11 max-w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-lg font-bold text-slate-900" disabled={switchingStore} onChange={(event) => void changeStore(event.target.value)} value={auth.store?.id ?? ''}>
                {auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
              <p className="mt-2 truncate text-sm text-slate-600">{auth.profile?.display_name ?? auth.user?.email ?? '未识别账号'}</p>
              {storeMessage ? <p className="mt-2 text-sm text-red-700">{storeMessage}</p> : null}
            </div>
            <button
              aria-label="退出登录"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition active:scale-95"
              onClick={handleSignOut}
              type="button"
            >
              <LogOut className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {dashboardActions.map(({ to, label, description, icon: Icon, className }) => (
            <Link
              key={to}
              to={to}
              className={`flex aspect-square min-h-40 flex-col items-center justify-center rounded-lg bg-gradient-to-br p-5 text-center text-white shadow-lg transition active:scale-95 ${className}`}
            >
              <Icon className="mb-4 h-14 w-14" aria-hidden="true" />
              <span className="text-2xl font-bold">{label}</span>
              <span className="mt-2 max-w-36 text-sm leading-5 text-white/85">{description}</span>
            </Link>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Link className="flex min-h-14 items-center gap-3 rounded-lg bg-white px-4 font-semibold text-slate-800 shadow-sm active:scale-[0.99]" to="/app/history">
            <History className="h-5 w-5 text-slate-500" aria-hidden="true" />
            我的记录
          </Link>
          <Link className="flex min-h-14 items-center gap-3 rounded-lg bg-white px-4 font-semibold text-slate-800 shadow-sm active:scale-[0.99]" to="/app/account">
            <UserRound className="h-5 w-5 text-slate-500" aria-hidden="true" />
            账号设置
          </Link>
          <div className="flex min-h-14 items-center gap-3 rounded-lg bg-white px-4 font-semibold text-slate-800 shadow-sm">
            <Store className="h-5 w-5 text-slate-500" aria-hidden="true" />
            {auth.store?.short_name ?? '门店'}
          </div>
        </div>
      </div>
    </section>
  );
}

function AdminDashboard() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<HistoryTask[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  const loadMessages = useCallback(async () => {
    if (!supabase || !auth.profile) {
      setStatus('error');
      setMessage('需要先登录并配置 Supabase。');
      return;
    }

    setStatus('loading');
    setMessage(null);
    try {
      const legacySeenIds = JSON.parse(window.localStorage.getItem(seenStorageKey(auth.profile.id)) ?? '[]') as string[];
      if (legacySeenIds.length > 0) {
        await markSubmittedTasksRead(supabase, auth.profile.id, legacySeenIds);
        window.localStorage.removeItem(seenStorageKey(auth.profile.id));
      }
      const loaded = await loadUnreadSubmittedTasks(supabase, auth.profile, 12);
      setMessages(loaded);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '加载消息失败。');
    }
  }, [auth.profile]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const markAllSeen = async () => {
    if (!auth.profile || !supabase) {
      return;
    }
    try {
      const allUnread = await loadUnreadSubmittedTasks(supabase, auth.profile);
      await markSubmittedTasksRead(supabase, auth.profile.id, allUnread.map((item) => item.task.id));
      setMessages([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '标记已查看失败。');
    }
  };

  const openMessage = async (taskId: string) => {
    if (!auth.profile || !supabase) {
      return;
    }
    try {
      await markSubmittedTasksRead(supabase, auth.profile.id, [taskId]);
      setMessages((current) => current.filter((item) => item.task.id !== taskId));
      navigate('/app/history');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '打开提交记录失败。');
    }
  };

  const handleSignOut = () => {
    void auth.signOut();
  };

  return (
    <section className="min-h-screen bg-slate-50 px-4 py-5">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="rounded-lg bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-700">管理员消息中心</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">最近提交提醒</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                员工完成点货或订货后，会在这里形成一条提交消息。
              </p>
            </div>
            <button
              aria-label="退出登录"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition active:scale-95"
              onClick={handleSignOut}
              type="button"
            >
              <LogOut className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </header>

        {featureFlags.arrivalEntry ? (
          <AdminArrivalOverview />
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <Link className="flex min-h-14 items-center gap-3 rounded-lg bg-white px-4 font-semibold text-slate-800 shadow-sm active:scale-[0.99]" to="/app/history">
            <History className="h-5 w-5 text-slate-500" aria-hidden="true" />
            查看全部记录
          </Link>
          <Link className="flex min-h-14 items-center gap-3 rounded-lg bg-white px-4 font-semibold text-slate-800 shadow-sm active:scale-[0.99]" to="/app/admin">
            <Settings className="h-5 w-5 text-slate-500" aria-hidden="true" />
            商品与账号后台
          </Link>
          <button className="flex min-h-14 items-center gap-3 rounded-lg bg-white px-4 font-semibold text-slate-800 shadow-sm active:scale-[0.99] disabled:text-slate-300" disabled={messages.length === 0} onClick={() => void markAllSeen()} type="button">
            <CheckCheck className="h-5 w-5 text-slate-500" aria-hidden="true" />
            点货/订货全部已读
          </button>
        </div>

        <div className="rounded-lg bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-brand-700" aria-hidden="true" />
              <div>
                <h2 className="font-bold text-slate-900">待查看提交</h2>
                <p className="text-sm text-slate-500">{messages.length ? `${messages.length} 条待查看` : '暂无待查看提交'}</p>
              </div>
            </div>
            <button className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700" onClick={() => void loadMessages()} type="button">
              刷新
            </button>
          </div>
        </div>

        {status === 'loading' ? (
          <div className="rounded-lg bg-white p-5 text-sm font-semibold text-slate-700 shadow-sm">正在加载消息</div>
        ) : null}

        {status === 'error' ? (
          <div className="rounded-lg bg-white p-5 text-sm leading-6 text-red-700 shadow-sm">{message ?? '消息加载失败。'}</div>
        ) : null}

        {status === 'ready' && messages.length === 0 ? (
          <div className="rounded-lg bg-white p-8 text-center shadow-sm">
            <Bell className="mx-auto h-12 w-12 text-slate-300" aria-hidden="true" />
            <p className="mt-4 font-bold text-slate-900">暂无待查看提交</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">新的点货或订货提交会出现在这里，查看后自动移出列表。</p>
          </div>
        ) : null}

        {status === 'ready' && messages.length > 0 ? (
          <div className="space-y-3">
            {messages.map(({ itemCount, storeShortName, submitterName, task }) => (
              <button className="w-full rounded-lg bg-white p-4 text-left shadow-sm active:scale-[0.99]" key={task.id} onClick={() => void openMessage(task.id)} type="button">
                <p className="text-sm font-semibold text-brand-700">{storeShortName} · {taskTypeLabel[task.task_type]}提交</p>
                <h2 className="mt-1 text-lg font-bold text-slate-900">{formatDateTime(task.submitted_at)}</h2>
                <p className="mt-2 text-sm text-slate-500">{submitterName} · {itemCount} 个商品 · 单号 {task.id.slice(0, 8)}</p>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
