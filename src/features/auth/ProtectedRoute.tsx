import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { FeedbackBanner, LoadingState } from '../../components/ui/Feedback';
import { useAuth } from './AuthContext';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
  requireTaskReviewer?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false, requireTaskReviewer = false }: ProtectedRouteProps) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-sm"><LoadingState label="正在加载账号和门店信息" /></div>
      </main>
    );
  }

  if (auth.status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (requireAdmin && auth.profile?.role !== 'admin') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="ui-card w-full max-w-sm p-5"><FeedbackBanner title="无权访问后台" tone="warning">当前账号没有管理员权限。</FeedbackBanner></div>
      </main>
    );
  }

  if (requireTaskReviewer && !['admin', 'manager'].includes(auth.profile?.role ?? '')) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="ui-card w-full max-w-sm p-5"><FeedbackBanner title="无权审核任务" tone="warning">当前账号没有任务审核权限。</FeedbackBanner></div>
      </main>
    );
  }

  return children;
}
