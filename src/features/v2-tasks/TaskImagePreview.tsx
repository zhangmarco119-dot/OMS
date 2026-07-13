import { X } from 'lucide-react';
import { useState } from 'react';

import type { V2TaskImageRow } from '../../services/v2-tasks.service';

export function TaskImagePreview({ images, imageUrls, pendingImageUrls = [] }: { images: V2TaskImageRow[]; imageUrls: Record<string, string>; pendingImageUrls?: string[] }) {
  const [activeImage, setActiveImage] = useState<{ alt: string; url: string } | null>(null);
  if (images.length === 0 && pendingImageUrls.length === 0) return null;
  return <><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{pendingImageUrls.map((url, index) => <button aria-label={`全屏查看上传中的图片 ${index + 1}`} className="block overflow-hidden rounded-lg border bg-slate-50 text-left" key={url} onClick={() => setActiveImage({ alt: `上传中的图片 ${index + 1}`, url })} type="button"><img alt={`上传中的图片 ${index + 1}`} className="aspect-square w-full object-cover" src={url} /><span className="block truncate px-2 py-1 text-xs text-slate-600">正在上传</span></button>)}{images.map((image, index) => {
    const url = imageUrls[image.id]; const alt = `已上传图片 ${index + 1}`;
    return url ? <button aria-label={`全屏查看${alt}`} className="block overflow-hidden rounded-lg border bg-slate-50 text-left" key={image.id} onClick={() => setActiveImage({ alt, url })} type="button"><img alt={alt} className="aspect-square w-full object-cover" src={url} /><span className="block truncate px-2 py-1 text-xs text-slate-600">点击放大查看</span></button> : <div className="flex aspect-square items-center justify-center rounded-lg border bg-slate-50 p-2 text-center text-xs text-slate-500" key={image.id}>图片预览加载失败</div>;
  })}</div>{activeImage ? <div aria-label="图片全屏预览" className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setActiveImage(null)} role="dialog"><button aria-label="关闭图片预览" className="absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white" onClick={() => setActiveImage(null)} type="button"><X className="h-6 w-6" /></button><img alt={activeImage.alt} className="max-h-full max-w-full object-contain" onClick={() => setActiveImage(null)} src={activeImage.url} /></div> : null}</>;
}
