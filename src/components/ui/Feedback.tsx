import { AlertCircle, CheckCircle2, Inbox, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

const badgeTone = {
  danger: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  neutral: 'border-slate-200 bg-slate-100 text-slate-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
} as const;

export function StatusBadge({ children, className, tone = 'neutral' }: { children: ReactNode; className?: string; tone?: keyof typeof badgeTone }) {
  return <span className={cn('inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs font-bold leading-5', badgeTone[tone], className)}>{children}</span>;
}

export function FeedbackBanner({ children, className, title, tone = 'info' }: {
  children?: ReactNode;
  className?: string;
  title?: ReactNode;
  tone?: 'danger' | 'info' | 'success' | 'warning';
}) {
  const icon = tone === 'success' ? CheckCircle2 : tone === 'danger' ? AlertCircle : tone === 'warning' ? TriangleAlert : AlertCircle;
  const Icon = icon;
  return (
    <div className={cn('rounded-2xl border p-3.5 text-sm leading-6', badgeTone[tone], className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">{title ? <p className="font-bold">{title}</p> : null}{children ? <div className={title ? 'mt-0.5' : ''}>{children}</div> : null}</div>
      </div>
    </div>
  );
}

export function EmptyState({ action, description, icon: Icon = Inbox, title }: { action?: ReactNode; description?: ReactNode; icon?: LucideIcon; title: ReactNode }) {
  return <div className="ui-card px-5 py-9 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200/70"><Icon className="h-6 w-6" aria-hidden="true" /></span><h2 className="mt-3 text-base font-bold text-slate-900">{title}</h2>{description ? <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">{description}</p> : null}{action ? <div className="mt-4">{action}</div> : null}</div>;
}

export function LoadingState({ label = '正在加载' }: { label?: string }) {
  return <div className="ui-card flex min-h-24 items-center justify-center gap-2.5 p-5 text-sm font-semibold text-slate-600" role="status"><Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden="true" /><span>{label}</span></div>;
}

export function SkeletonCard({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div aria-hidden="true" className={cn('ui-card space-y-3 p-4 sm:p-5', className)}>
      <div className="ui-skeleton h-4 w-28" />
      <div className="ui-skeleton h-7 w-40" />
      {Array.from({ length: Math.max(0, lines - 2) }).map((_, index) => (
        <div className={cn('ui-skeleton h-3.5', index % 2 === 0 ? 'w-full' : 'w-3/4')} key={index} />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry, title = '暂时无法加载' }: { message: ReactNode; onRetry?: () => void; title?: ReactNode }) {
  return <div className="ui-card p-4 sm:p-5"><FeedbackBanner title={title} tone="danger">{message}</FeedbackBanner>{onRetry ? <button className="ui-button-secondary mt-3.5 w-full" onClick={onRetry} type="button"><RefreshCw className="h-4 w-4" aria-hidden="true" />重新加载</button> : null}</div>;
}
