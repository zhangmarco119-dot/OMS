import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { cn } from '../../lib/cn';
import { queryDetailParentRoute, rememberedParentRoute, rememberedRoute } from '../../lib/navigationHierarchy';

interface PageShellProps {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  backTo?: string;
  contentGapClassName?: string;
  onBack?: () => void;
}

export function PageShell({ eyebrow, title, children, backTo, contentGapClassName = 'gap-5', onBack }: PageShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = () => {
    if (onBack) { onBack(); return; }
    const historyIndex = Number(window.history.state?.idx ?? 0);
    if (historyIndex > 0) { navigate(-1); return; }
    const queryParent = queryDetailParentRoute(location.pathname, location.search);
    const fallback = queryParent ?? rememberedParentRoute(location.pathname) ?? (backTo ? rememberedRoute(backTo) : null);
    if (fallback) navigate(fallback, { replace: true, state: { from: location.pathname } });
  };
  return (
    <section className="app-page-min-height px-4 pb-8 pt-4 sm:px-6 sm:pt-5 lg:px-8">
      <div className={cn('mx-auto flex max-w-5xl flex-col', contentGapClassName)}>
        <header className="relative flex min-h-14 items-center justify-center border-b border-slate-200 pb-3 text-center">
          {onBack || backTo ? (
            <button aria-label="返回" className="ui-icon-button absolute left-0 border-transparent bg-transparent" onClick={goBack} type="button">
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
          <div className="min-w-0 px-14">
            {eyebrow ? <p className="truncate text-xs font-semibold text-brand-700">{eyebrow}</p> : null}
            <h1 className="mt-0.5 text-xl font-bold leading-tight tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
          </div>
        </header>
        {children}
      </div>
    </section>
  );
}
