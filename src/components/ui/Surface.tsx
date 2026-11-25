import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { cn } from '../../lib/cn';

export function SectionCard({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('ui-card p-4 sm:p-5', className)} {...props} />;
}

export function SectionHeader({ action, description, icon: Icon, title }: {
  action?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  title: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100"><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span> : null}
        <div className="min-w-0">
          <h2 className="text-base font-bold leading-6 tracking-tight text-slate-900">{title}</h2>
          {description ? <p className="mt-0.5 text-xs leading-5 text-slate-500 sm:text-sm">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function FeatureCard({ icon: Icon, label, to }: { icon: LucideIcon; label: string; note?: string; to: string }) {
  return (
    <Link className="ui-interactive ui-card group grid min-h-24 grid-rows-[2.5rem_1.25rem] content-start gap-y-2.5 p-3.5 hover:border-brand-200 hover:bg-brand-50/25 hover:shadow-card-hover" to={to}>
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100/80 transition-colors group-hover:bg-brand-100/90 group-hover:ring-brand-200">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <b className="line-clamp-1 block h-5 text-sm leading-5 text-slate-900">{label}</b>
    </Link>
  );
}

export function MetricCard({ badge, icon: Icon, label, note, tone = 'brand', to, value }: {
  badge?: ReactNode;
  icon?: LucideIcon;
  label: string;
  note?: string;
  tone?: 'brand' | 'danger' | 'info' | 'warning';
  to: string;
  value: ReactNode;
}) {
  const tones = {
    brand: { pill: 'text-brand-700 bg-brand-50 ring-brand-100', bar: 'bg-brand-500', icon: 'text-brand-700 bg-brand-50' },
    danger: { pill: 'text-red-700 bg-red-50 ring-red-100', bar: 'bg-red-500', icon: 'text-red-700 bg-red-50' },
    info: { pill: 'text-sky-700 bg-sky-50 ring-sky-100', bar: 'bg-sky-500', icon: 'text-sky-700 bg-sky-50' },
    warning: { pill: 'text-amber-800 bg-amber-50 ring-amber-100', bar: 'bg-amber-500', icon: 'text-amber-700 bg-amber-50' },
  } as const;
  const style = tones[tone];
  return (
    <Link className="ui-interactive ui-card group relative flex min-w-0 flex-col justify-between overflow-hidden p-3.5 hover:border-brand-200 hover:shadow-card-hover sm:p-4" to={to}>
      <span aria-hidden="true" className={cn('absolute inset-x-0 top-0 h-[3px]', style.bar)} />
      <div className="flex items-center justify-between gap-2">
        <span className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-bold ring-1', style.pill)}>
          {Icon ? <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : null}
          <span className="truncate">{label}</span>
        </span>
        {badge ? <span className="shrink-0">{badge}</span> : <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />}
      </div>
      <p className="mt-2.5 truncate text-2xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      {note ? <p className="mt-1 line-clamp-2 text-xs leading-4 text-slate-500">{note}</p> : null}
    </Link>
  );
}
