import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Link, useRouteError } from 'react-router-dom';

export function RouteErrorPage() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : '页面加载时发生了未知错误。';

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f7f3] px-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-white p-6 text-center shadow-panel">
        <AlertTriangle className="mx-auto size-10 text-amber-600" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-bold text-slate-900">页面暂时无法打开</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand-600 px-5 font-semibold text-white"
            onClick={() => window.location.reload()}
            type="button"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            重新加载
          </button>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-line px-5 font-semibold text-slate-700"
            to="/app"
          >
            返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
