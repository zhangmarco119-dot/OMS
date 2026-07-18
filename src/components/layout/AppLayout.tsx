import { ClipboardList, Home, ListTodo, UserRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../../features/auth/AuthContext';
import { supabase } from '../../lib/supabase';
import { loadTodoSummary } from '../../services/todo.service';
import { HierarchicalBackGuard } from './HierarchicalBackGuard';
import { RouteScrollReset } from './RouteScrollReset';

const staffNavItems = [
  { to: '/app', label: '首页', icon: Home },
  { to: '/app/workbench', label: '工作台', icon: ClipboardList },
  { to: '/app/todos', label: '待办', icon: ListTodo },
  { to: '/app/account', label: '我的', icon: UserRound },
];

const adminNavItems = [
  { to: '/app', label: '首页', icon: Home },
  { to: '/app/workbench', label: '工作台', icon: ClipboardList },
  { to: '/app/todos', label: '待办', icon: ListTodo },
  { to: '/app/account', label: '我的', icon: UserRound },
];

const isItemActive = (pathname: string, to: string) => {
  if (to === '/app') return pathname === '/app' || pathname === '/app/messages';
  if (to === '/app/todos') return pathname.startsWith('/app/todos');
  if (to === '/app/account') return pathname.startsWith('/app/account');
  return !['/app', '/app/messages'].includes(pathname)
    && !pathname.startsWith('/app/todos')
    && !pathname.startsWith('/app/account');
};

export function AppLayout() {
  const auth = useAuth();
  const location = useLocation();
  const [todoCount, setTodoCount] = useState(0);
  const navItems = auth.profile?.role === 'admin'
    ? adminNavItems
    : staffNavItems;
  const refreshTodoCount = useCallback(async () => {
    if (!supabase || !auth.profile) { setTodoCount(0); return; }
    try { const summary = await loadTodoSummary(supabase, { isAdmin: auth.profile.role === 'admin', isManager: auth.profile.role === 'manager', profileId: auth.profile.id, storeId: auth.store?.id, storeIds: auth.availableStores.map((store) => store.id) }); setTodoCount(summary.count); }
    catch { setTodoCount(0); }
  }, [auth.availableStores, auth.profile, auth.store?.id]);
  useEffect(() => { void refreshTodoCount(); }, [location.key, refreshTodoCount]);
  useEffect(() => {
    const onFocus = () => { void refreshTodoCount(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshTodoCount]);
  useEffect(() => {
    const onTodoChanged = () => { void refreshTodoCount(); };
    window.addEventListener('storehub:todos-changed', onTodoChanged);
    return () => window.removeEventListener('storehub:todos-changed', onTodoChanged);
  }, [refreshTodoCount]);
  useEffect(() => {
    const client = supabase;
    if (!client || !auth.profile) return undefined;
    const channel = client.channel(`todo-badge:${auth.profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'v2_tasks' }, () => void refreshTodoCount())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_feedback' }, () => void refreshTodoCount())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'v2_notice_recipients' }, () => void refreshTodoCount())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payroll_overtime_requests' }, () => void refreshTodoCount())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_missing_punch_todos' }, () => void refreshTodoCount())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [auth.profile, refreshTodoCount]);

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <RouteScrollReset />
      <HierarchicalBackGuard />
      <main className="app-content mx-auto w-full max-w-5xl">
        <Outlet />
      </main>
      <nav aria-label="主导航" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-3 pt-1.5 shadow-[0_-6px_24px_rgba(15,23,42,0.06)] backdrop-blur">
        <div
          className="mx-auto grid max-w-md gap-1"
          style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
        >
          {navItems.map(({ to, label, icon: Icon }) => {
            const active = isItemActive(location.pathname, to);
            return (
            <Link
              aria-current={active ? 'page' : undefined}
              key={to}
              to={to}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-semibold transition ${active ? 'text-brand-700' : 'text-slate-500'}`}
            >
              <span className={`relative flex h-7 min-w-11 items-center justify-center rounded-full transition ${active ? 'bg-brand-50' : ''}`}><Icon aria-hidden="true" className="h-5 w-5" />{to === '/app/todos' && todoCount > 0 ? <span aria-label={`${todoCount} 条待办`} className="absolute -right-0.5 -top-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white ring-2 ring-white">{todoCount > 99 ? '99+' : todoCount}</span> : null}</span>
              <span>{label}</span>
            </Link>
          );})}
        </div>
      </nav>
    </div>
  );
}
