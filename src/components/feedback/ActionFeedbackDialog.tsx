import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

export type ActionFeedbackTone = 'danger' | 'info' | 'success' | 'warning';

const toneStyle: Record<ActionFeedbackTone, { icon: typeof Info; iconClass: string; panelClass: string }> = {
  danger: { icon: AlertCircle, iconClass: 'bg-red-50 text-red-600', panelClass: 'border-red-100' },
  info: { icon: Info, iconClass: 'bg-blue-50 text-blue-600', panelClass: 'border-blue-100' },
  success: { icon: CheckCircle2, iconClass: 'bg-emerald-50 text-emerald-600', panelClass: 'border-emerald-100' },
  warning: { icon: TriangleAlert, iconClass: 'bg-amber-50 text-amber-700', panelClass: 'border-amber-100' },
};

export function ActionFeedbackDialog({ buttonLabel = '我知道了', message, onClose, open, title, tone = 'info' }: {
  buttonLabel?: string;
  message: string;
  onClose: () => void;
  open: boolean;
  title: string;
  tone?: ActionFeedbackTone;
}) {
  if (!open) return null;
  const style = toneStyle[tone];
  const Icon = style.icon;
  return <div className="ui-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="action-feedback-title">
    <section className={`ui-dialog-panel max-w-sm border p-5 ${style.panelClass}`}>
      <div className="flex items-start justify-between gap-3"><div className={`flex h-12 w-12 items-center justify-center rounded-full ${style.iconClass}`}><Icon className="h-7 w-7" aria-hidden="true" /></div><button aria-label="关闭操作提示" className="ui-icon-button" onClick={onClose} type="button"><X className="h-5 w-5" /></button></div>
      <h2 className="mt-4 text-xl font-bold text-slate-900" id="action-feedback-title">{title}</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{message}</p>
      <button className={tone === 'danger' ? 'ui-button-danger mt-5 w-full' : 'ui-button-primary mt-5 w-full'} onClick={onClose} type="button">{buttonLabel}</button>
    </section>
  </div>;
}
