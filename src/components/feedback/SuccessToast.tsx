import { CheckCircle2, X } from 'lucide-react';

export function SuccessToast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return <div className="safe-bottom fixed inset-x-4 bottom-4 z-[70] mx-auto max-w-md rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-xl" role="status"><div className="flex items-center gap-3"><CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-600" /><p className="flex-1 font-bold text-emerald-900">{message}</p><button aria-label="关闭成功提示" className="rounded-full p-1 text-emerald-700" onClick={onClose} type="button"><X className="h-5 w-5" /></button></div></div>;
}
