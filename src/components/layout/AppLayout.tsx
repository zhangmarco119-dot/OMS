import { ClipboardList, History, Home, PackageCheck, PackagePlus, Settings, UserRound } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

import { featureFlags } from '../../config/featureFlags';
import { canOperateV2Modules } from '../../features/access/roleCapabilities';
import { useAuth } from '../../features/auth/AuthContext';

const staffNavItems = [
  { to: '/app', label: '首页', icon: Home },
  { to: '/app/inventory', label: '点货', icon: ClipboardList },
  { to: '/app/order', label: '订货', icon: PackagePlus },
  { to: '/app/history', label: '记录', icon: History },
  { to: '/app/account', label: '账号', icon: UserRound },
];

const adminNavItems = [
  { to: '/app', label: '消息', icon: Home },
  { to: '/app/history', label: '记录', icon: History },
  { to: '/app/admin', label: '后台', icon: Settings },
  { to: '/app/account', label: '账号', icon: UserRound },
];

const arrivalNavItem = { to: '/app/arrivals', label: '到货', icon: PackageCheck };

export function AppLayout() {
  const auth = useAuth();
  const navItems = auth.profile?.role === 'admin'
    ? adminNavItems
    : featureFlags.arrivalEntry && canOperateV2Modules(auth.profile?.role)
      ? [...staffNavItems.slice(0, 3), arrivalNavItem, ...staffNavItems.slice(3)]
      : staffNavItems;

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
              end={to === '/app'}
              className={({ isActive }) =>
                [
                  'flex min-h-14 flex-col items-center justify-center gap-1 rounded-md text-xs font-medium',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600',
                ].join(' ')
              }
            >
              <Icon aria-hidden="true" className="h-5 w-5" />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
