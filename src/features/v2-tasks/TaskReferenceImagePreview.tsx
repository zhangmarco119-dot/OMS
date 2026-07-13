import { X } from 'lucide-react';
import { useState } from 'react';

export function TaskReferenceImagePreview({ urls }: { urls: string[] }) {
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  if (urls.length === 0) return null;
  return <section className="mt-3 rounded-lg border border-brand-100 bg-brand-50 p-2.5"><p className="text-xs font-bold text-brand-800">参考图片</p><div className="mt-2 flex flex-wrap gap-2">{urls.map((url, index) => <button aria-label={`全屏查看参考图片 ${index + 1}`} className="block overflow-hidden rounded-lg border bg-white" key={url} onClick={() => setActiveUrl(url)} type="button"><img alt={`参考图片 ${index + 1}`} className="h-24 w-24 object-cover" src={url} /></button>)}</div><p className="mt-1 text-xs text-brand-700">点击图片可放大查看</p>{activeUrl ? <div aria-label="参考图片全屏预览" className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setActiveUrl(null)} role="dialog"><button aria-label="关闭参考图片预览" className="absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white" onClick={() => setActiveUrl(null)} type="button"><X className="h-6 w-6" /></button><img alt="参考图片大图" className="max-h-full max-w-full object-contain" onClick={() => setActiveUrl(null)} src={activeUrl} /></div> : null}</section>;
}
