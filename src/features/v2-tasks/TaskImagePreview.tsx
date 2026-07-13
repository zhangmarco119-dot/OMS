import { Loader2, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import type { V2TaskImageRow } from '../../services/v2-tasks.service';

export function TaskImagePreview({ deletableImageIds, deletingImageIds = [], images, imageUrls, onDelete, pendingImageUrls = [] }: { deletableImageIds?: string[]; deletingImageIds?: string[]; images: V2TaskImageRow[]; imageUrls: Record<string, string>; onDelete?: (image: V2TaskImageRow) => void; pendingImageUrls?: string[] }) {
  const [activeImage, setActiveImage] = useState<{ alt: string; url: string } | null>(null);
  if (images.length === 0 && pendingImageUrls.length === 0) return null;
  return <><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{pendingImageUrls.map((url, index) => <button aria-label={`全屏查看上传中的图片 ${index + 1}`} className="block overflow-hidden rounded-lg border bg-slate-50 text-left" key={url} onClick={() => setActiveImage({ alt: `上传中的图片 ${index + 1}`, url })} type="button"><img alt={`上传中的图片 ${index + 1}`} className="aspect-square w-full object-cover" src={url} /><span className="block truncate px-2 py-1 text-xs text-slate-600">正在上传</span></button>)}{images.map((image, index) => {
    const url = imageUrls[image.id]; const alt = `已上传图片 ${index + 1}`;
    if (!url) return <div className="flex aspect-square items-center justify-center rounded-lg border bg-slate-50 p-2 text-center text-xs text-slate-500" key={image.id}>图片预览加载失败</div>;
    const deleting = deletingImageIds.includes(image.id);
    const canDelete = onDelete && !image.id.startsWith('local-') && (!deletableImageIds || deletableImageIds.includes(image.id));
    return <div className="overflow-hidden rounded-lg border bg-slate-50" key={image.id}><button aria-label={`全屏查看${alt}`} className="block w-full text-left" onClick={() => setActiveImage({ alt, url })} type="button"><img alt={alt} className="aspect-square w-full object-cover" src={url} /></button><div className="flex min-h-10 items-center justify-between gap-2 px-2 py-1"><span className="truncate text-xs text-slate-600">点击放大查看</span>{canDelete ? <button aria-label={`删除${alt}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700 disabled:opacity-50" disabled={deleting} onClick={() => onDelete(image)} type="button">{deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button> : null}</div></div>;
  })}</div>{activeImage ? <div aria-label="图片全屏预览" className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setActiveImage(null)} role="dialog"><button aria-label="关闭图片预览" className="absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white" onClick={() => setActiveImage(null)} type="button"><X className="h-6 w-6" /></button><img alt={activeImage.alt} className="max-h-full max-w-full object-contain" onClick={() => setActiveImage(null)} src={activeImage.url} /></div> : null}</>;
}
