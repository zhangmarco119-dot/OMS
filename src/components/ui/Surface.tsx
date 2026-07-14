import type { LucideIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { cn } from '../../lib/cn';

export function SectionCard({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('ui-card p-4', className)} {...props} />;
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
        {Icon ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Icon className="h-5 w-5" aria-hidden="true" /></span> : null}
        <div className="min-w-0">
          <h2 className="text-base font-bold leading-6 text-slate-900">{title}</h2>
          {description ? <p className="mt-0.5 text-sm leading-5 text-slate-500">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function FeatureCard({ icon: Icon, label, note, to }: { icon: LucideIcon; label: string; note: string; to: string }) {
  return (
    <Link className="ui-interactive ui-card group grid min-h-32 grid-rows-[2.5rem_1.25rem_2rem] content-start gap-y-2 p-3.5 hover:border-brand-200 hover:bg-brand-50/30" to={to}>
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700 transition-colors group-hover:bg-brand-100">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <b className="line-clamp-1 block h-5 text-sm leading-5 text-slate-900">{label}</b>
      <span className="line-clamp-2 block h-8 text-xs leading-4 text-slate-500">{note}</span>
    </Link>
  );
}

export function MetricCard({ label, note, tone = 'brand', to, value }: {
  label: string;
  note?: string;
  tone?: 'brand' | 'danger' | 'info' | 'warning';
  to: string;
  value: ReactNode;
}) {
  const tones = {
    brand: 'text-brand-700 bg-brand-50',
    danger: 'text-red-700 bg-red-50',
    info: 'text-sky-700 bg-sky-50',
    warning: 'text-amber-800 bg-amber-50',
  } as const;
  return (
    <Link className="ui-interactive ui-card block min-w-0 p-3.5 hover:border-brand-200" to={to}>
      <span className={cn('inline-flex rounded-md px-2 py-1 text-xs font-bold', tones[tone])}>{label}</span>
      <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      {note ? <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-slate-500">{note}</p> : null}
    </Link>
  );
}
