import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export function FormField({ children, error, hint, label, required }: { children: ReactNode; error?: ReactNode; hint?: ReactNode; label: ReactNode; required?: boolean }) {
  return <label className="block text-sm font-semibold text-slate-700"><span>{label}{required ? <span className="ml-1 text-red-600" aria-label="必填">*</span> : null}</span><div className="mt-1.5">{children}</div>{error ? <p className="mt-1.5 text-xs leading-5 text-red-700">{error}</p> : hint ? <p className="mt-1.5 text-xs leading-5 text-slate-500">{hint}</p> : null}</label>;
}

export function SegmentedControl({ className, items }: { className?: string; items: Array<{ active: boolean; disabled?: boolean; label: ReactNode; onClick: () => void }> }) {
  return <div className={cn('grid gap-1 rounded-lg bg-slate-100 p-1', className)} role="tablist">{items.map((item, index) => <button aria-selected={item.active} className={cn('min-h-10 rounded-md px-3 text-sm font-bold transition', item.active ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900', item.disabled && 'cursor-not-allowed opacity-45')} disabled={item.disabled} key={index} onClick={item.onClick} role="tab" type="button">{item.label}</button>)}</div>;
}
