import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Link, useRouteError } from 'react-router-dom';

import { FeedbackBanner } from '../components/ui/Feedback';

export function RouteErrorPage() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : '页面加载时发生了未知错误。';

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="ui-card w-full max-w-md p-6 text-center">
        <AlertTriangle className="mx-auto size-10 text-amber-600" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-bold text-slate-900">页面暂时无法打开</h1>
        <FeedbackBanner className="mt-4 text-left" tone="danger">{message}</FeedbackBanner>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            className="ui-button-primary"
            onClick={() => window.location.reload()}
            type="button"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            重新加载
          </button>
          <Link
            className="ui-button-secondary"
            to="/app"
          >
            返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
