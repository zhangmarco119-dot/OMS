import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
  const goBack = () => {
    if (onBack) { onBack(); return; }
    if (window.history.state?.idx > 0) { navigate(-1); return; }
    if (backTo) navigate(backTo);
  };
  return (
    <section className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className={`mx-auto flex max-w-5xl flex-col ${contentGapClassName}`}>
        <header className="relative flex min-h-16 items-center justify-center border-b border-line pb-4 text-center">
          {onBack || backTo ? (
            <button aria-label="返回" className="absolute left-0 flex h-11 w-11 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm" onClick={goBack} type="button">
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
          <div className="min-w-0 px-14">
            {eyebrow ? <p className="text-xs font-semibold text-brand-700">{eyebrow}</p> : null}
            <h1 className="mt-1 text-xl font-bold leading-tight text-ink sm:text-2xl">{title}</h1>
          </div>
        </header>
        {children}
      </div>
    </section>
  );
}
