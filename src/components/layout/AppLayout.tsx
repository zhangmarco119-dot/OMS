import { ClipboardList, Home, ListTodo, UserRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

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
  const [todoCount, setTodoCount] = useState(0);
  const navItems = auth.profile?.role === 'admin'
    ? adminNavItems
    : staffNavItems;
  const refreshTodoCount = useCallback(async () => {
    if (!supabase || !auth.profile) { setTodoCount(0); return; }
    try { const summary = await loadTodoSummary(supabase, { isAdmin: auth.profile.role === 'admin', profileId: auth.profile.id, storeId: auth.store?.id }); setTodoCount(summary.count); }
    catch { setTodoCount(0); }
  }, [auth.profile, auth.store?.id]);
  useEffect(() => { void refreshTodoCount(); }, [refreshTodoCount]);
  useEffect(() => {
    const onFocus = () => { void refreshTodoCount(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshTodoCount]);

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
