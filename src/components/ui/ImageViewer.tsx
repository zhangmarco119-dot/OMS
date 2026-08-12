import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

export interface ImageViewerItem {
  alt: string;
  url: string;
}

export function ImageViewer({ actionLabel, activeIndex, images, label = '图片全屏预览', onAction, onClose, onIndexChange }: {
  actionLabel?: string;
  activeIndex: number;
  images: ImageViewerItem[];
  label?: string;
  onAction?: (index: number) => void;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const touchStartX = useRef<number | null>(null);
  const swiped = useRef(false);
  const index = Math.min(Math.max(activeIndex, 0), Math.max(images.length - 1, 0));
  const active = images[index];
  const change = (offset: number) => {
    if (images.length < 2) return;
    onIndexChange((index + offset + images.length) % images.length);
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') change(-1);
      if (event.key === 'ArrowRight') change(1);
    };
    window.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', keydown);
    };
  });

  if (!active) return null;

  const closeFromTap = () => {
    if (swiped.current) { swiped.current = false; return; }
    onClose();
  };
  const finishTouch = (clientX: number) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start == null || images.length < 2) return;
    const distance = clientX - start;
    if (Math.abs(distance) < 45) return;
    swiped.current = true;
    change(distance > 0 ? -1 : 1);
  };

  return <div
    aria-label={label}
    aria-modal="true"
    className="fixed inset-0 z-[100] flex touch-pan-y items-center justify-center bg-black/95 p-3"
    onClick={closeFromTap}
    onTouchEnd={(event) => finishTouch(event.changedTouches[0]?.clientX ?? 0)}
    onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; swiped.current = false; }}
    role="dialog"
  >
    {actionLabel && onAction ? <button aria-label={actionLabel} className="absolute left-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-10 flex min-h-12 items-center gap-2 rounded-full bg-white/15 px-4 text-sm font-semibold text-white" onClick={(event) => { event.stopPropagation(); onAction(index); }} type="button"><Download className="h-5 w-5" />{actionLabel}</button> : null}
    <button aria-label="关闭图片预览" className="absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white" onClick={(event) => { event.stopPropagation(); onClose(); }} type="button"><X className="h-6 w-6" /></button>
    {images.length > 1 ? <>
      <button aria-label="上一张图片" className="absolute left-2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white" onClick={(event) => { event.stopPropagation(); change(-1); }} type="button"><ChevronLeft className="h-7 w-7" /></button>
      <button aria-label="下一张图片" className="absolute right-2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white" onClick={(event) => { event.stopPropagation(); change(1); }} type="button"><ChevronRight className="h-7 w-7" /></button>
      <p className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] rounded-full bg-black/60 px-3 py-1 text-sm font-semibold text-white">{index + 1} / {images.length}</p>
    </> : null}
    <img alt={active.alt} className="max-h-[88dvh] max-w-full select-none object-contain" draggable={false} onClick={(event) => { event.stopPropagation(); closeFromTap(); }} src={active.url} />
  </div>;
}
