import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from './AuthContext';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f7f3] px-4">
        <div className="rounded-lg border border-line bg-white p-5 text-sm font-semibold text-slate-700 shadow-panel">
          正在加载账号和门店信息
        </div>
      </main>
    );
  }

  if (auth.status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (requireAdmin && auth.profile?.role !== 'admin') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f7f3] px-4">
        <div className="rounded-lg border border-line bg-white p-6 shadow-panel">
          <h1 className="text-xl font-bold text-ink">无权访问后台</h1>
          <p className="mt-2 text-sm leading-6 text-slate-700">当前账号没有管理员权限。</p>
        </div>
      </main>
    );
  }

  return children;
}
