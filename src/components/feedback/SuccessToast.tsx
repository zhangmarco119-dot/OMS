import { CheckCircle2, X } from 'lucide-react';

export function SuccessToast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return <div className="safe-bottom fixed inset-x-4 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-[70] mx-auto max-w-md rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 shadow-floating" role="status"><div className="flex items-center gap-3"><CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" /><p className="flex-1 text-sm font-bold text-emerald-900">{message}</p><button aria-label="关闭成功提示" className="ui-icon-button h-10 w-10 border-transparent bg-transparent text-emerald-700" onClick={onClose} type="button"><X className="h-5 w-5" /></button></div></div>;
}
