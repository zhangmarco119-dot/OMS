import { X } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../lib/cn';

export function IconButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn('ui-icon-button', className)} type="button" {...props} />;
}

export function MobileActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('safe-bottom sticky bottom-20 z-20 rounded-xl border border-slate-200 bg-white/95 p-2.5 shadow-floating backdrop-blur', className)}>{children}</div>;
}

export function ConfirmDialog({ children, confirmLabel = '确认', danger = false, onCancel, onConfirm, open, title }: {
  children?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-slate-950/45 p-3 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-dialog">
        <div className="flex items-start justify-between gap-3"><h2 className="text-lg font-bold text-slate-900" id="confirm-dialog-title">{title}</h2><IconButton aria-label="关闭弹窗" className="-mr-1 -mt-1" onClick={onCancel}><X className="h-5 w-5" /></IconButton></div>
        {children ? <div className="mt-3 text-sm leading-6 text-slate-600">{children}</div> : null}
        <div className="mt-5 grid grid-cols-2 gap-2.5"><button className="ui-button-secondary" onClick={onCancel} type="button">取消</button><button className={danger ? 'ui-button-danger' : 'ui-button-primary'} onClick={onConfirm} type="button">{confirmLabel}</button></div>
      </div>
    </div>
  );
}
