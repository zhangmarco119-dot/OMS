import { Loader2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ImageViewer } from '../../components/ui/ImageViewer';
import type { V2TaskImageRow } from '../../services/v2-tasks.service';

interface TaskImagePreviewProps {
  deletableImageIds?: string[];
  deletingImageIds?: string[];
  images: V2TaskImageRow[];
  imageUrls: Record<string, string>;
  loading?: boolean;
  onDelete?: (image: V2TaskImageRow) => void;
  pendingImageUrls?: string[];
}

export function TaskImagePreview({
  deletableImageIds,
  deletingImageIds = [],
  images,
  imageUrls,
  loading = false,
  onDelete,
  pendingImageUrls = [],
}: TaskImagePreviewProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  if (images.length === 0 && pendingImageUrls.length === 0) return null;
  const viewerImages = [
    ...pendingImageUrls.map((url, index) => ({ alt: `上传中的图片 ${index + 1}`, url })),
    ...images.flatMap((image, index) => imageUrls[image.id] ? [{ alt: `已上传图片 ${index + 1}`, url: imageUrls[image.id] }] : []),
  ];
  const activate = (alt: string, url: string) => {
    const index = viewerImages.findIndex((image) => image.url === url && image.alt === alt);
    if (index >= 0) setActiveIndex(index);
  };

  return <>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {pendingImageUrls.map((url, index) => <button aria-label={`全屏查看上传中的图片 ${index + 1}`} className="block overflow-hidden rounded-lg border bg-slate-50 text-left" key={url} onClick={() => activate(`上传中的图片 ${index + 1}`, url)} type="button">
        <img alt={`上传中的图片 ${index + 1}`} className="aspect-square w-full object-cover" src={url} />
        <span className="block truncate px-2 py-1 text-xs text-slate-600">正在上传</span>
      </button>)}
      {images.map((image, index) => {
        const url = imageUrls[image.id];
        return <UploadedImageCard
          deleting={deletingImageIds.includes(image.id)}
          image={image}
          index={index}
          key={image.id}
          loadingUrl={loading}
          onActivate={activate}
          onDelete={onDelete && (!deletableImageIds || deletableImageIds.includes(image.id)) ? onDelete : undefined}
          url={url}
        />;
      })}
    </div>
    {activeIndex != null ? <ImageViewer activeIndex={activeIndex} images={viewerImages} onClose={() => setActiveIndex(null)} onIndexChange={setActiveIndex} /> : null}
  </>;
}

function UploadedImageCard({ deleting, image, index, loadingUrl, onActivate, onDelete, url }: {
  deleting: boolean;
  image: V2TaskImageRow;
  index: number;
  loadingUrl: boolean;
  onActivate: (alt: string, url: string) => void;
  onDelete?: (image: V2TaskImageRow) => void;
  url?: string;
}) {
  const [previewState, setPreviewState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  useEffect(() => setPreviewState('loading'), [url]);
  const alt = `已上传图片 ${index + 1}`;
  const stagedProgress = (image as V2TaskImageRow & { upload_progress?: number }).upload_progress;
  const uploading = image.id.startsWith('local-') || typeof stagedProgress === 'number';
  const uploadProgress = Math.max(0, Math.min(100, stagedProgress ?? 5));

  if (!url) return <ImageStatePlaceholder failed={!loadingUrl} />;

  return <div className="overflow-hidden rounded-lg border bg-slate-50">
    <button aria-label={`全屏查看${alt}`} className="relative block w-full text-left" onClick={() => { if (previewState === 'loaded') onActivate(alt, url); }} type="button">
      <img
        alt={alt}
        className={`aspect-square w-full object-cover transition-opacity ${previewState === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
        onError={() => setPreviewState('failed')}
        onLoad={() => setPreviewState('loaded')}
        src={url}
      />
      {previewState !== 'loaded' ? <ImageStateOverlay failed={previewState === 'failed'} /> : null}
      {uploading && previewState === 'loaded' ? <div aria-label={`${alt}上传进度`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={uploadProgress} className="absolute inset-x-2 bottom-2 rounded-md bg-slate-950/75 px-2 py-1.5 text-white" role="progressbar">
        <div className="flex items-center justify-between gap-2 text-[11px] font-semibold"><span>正在上传</span><span>{uploadProgress}%</span></div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/30"><div className="h-full rounded-full bg-emerald-400 transition-[width] duration-300" style={{ width: `${uploadProgress}%` }} /></div>
      </div> : null}
    </button>
    <div className="flex min-h-10 items-center justify-between gap-2 px-2 py-1">
      <span className="truncate text-xs text-slate-600">{previewState === 'failed' ? '可稍后刷新重试' : previewState === 'loading' ? '请稍候' : uploading ? '上传完成后即可提交' : '点击放大查看'}</span>
      {onDelete && !uploading ? <button aria-label={`删除${alt}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700 disabled:opacity-50" disabled={deleting} onClick={() => onDelete(image)} type="button">{deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button> : null}
    </div>
  </div>;
}

function ImageStatePlaceholder({ failed }: { failed: boolean }) {
  return <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border bg-slate-50 p-2 text-center text-xs text-slate-500" role={failed ? undefined : 'status'}>
    {failed ? null : <Loader2 className="h-5 w-5 animate-spin text-brand-600" />}
    <span>{failed ? '图片预览加载失败' : '正在加载图片'}</span>
  </div>;
}

function ImageStateOverlay({ failed }: { failed: boolean }) {
  return <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50 p-2 text-center text-xs text-slate-500" role={failed ? undefined : 'status'}>
    {failed ? null : <Loader2 className="h-5 w-5 animate-spin text-brand-600" />}
    <span>{failed ? '图片预览加载失败' : '正在加载图片'}</span>
  </div>;
}
