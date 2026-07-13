import { ClipboardList, Home, ListTodo, UserRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../../features/auth/AuthContext';
import { supabase } from '../../lib/supabase';
import { loadTodoSummary } from '../../services/todo.service';

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

export function AppLayout() {
  const auth = useAuth();
  const location = useLocation();
  const [todoCount, setTodoCount] = useState(0);
  const navItems = auth.profile?.role === 'admin'
    ? adminNavItems
    : staffNavItems;
  const refreshTodoCount = useCallback(async () => {
    if (!supabase || !auth.profile) { setTodoCount(0); return; }
    try { const summary = await loadTodoSummary(supabase, { isAdmin: auth.profile.role === 'admin', profileId: auth.profile.id, storeId: auth.store?.id }); setTodoCount(summary.count); }
    catch { setTodoCount(0); }
  }, [auth.profile, auth.store?.id]);
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
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [auth.profile, refreshTodoCount]);

  return (
    <div className="min-h-screen bg-[#f4f7f3]">
      <main className="mx-auto min-h-screen w-full max-w-5xl pb-24">
        <Outlet />
      </main>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 border-t border-line bg-white/95 px-3 pt-2 shadow-panel backdrop-blur">
        <div
          className="mx-auto grid max-w-md gap-1"
          style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
        >
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                [
                  'flex min-h-14 flex-col items-center justify-center gap-1 rounded-md text-xs font-medium',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600',
                ].join(' ')
              }
            >
              <span className="relative"><Icon aria-hidden="true" className="h-5 w-5" />{to === '/app/todos' && todoCount > 0 ? <span aria-label={`${todoCount} 条待办`} className="absolute -right-3 -top-2 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 text-white">{todoCount > 99 ? '99+' : todoCount}</span> : null}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
