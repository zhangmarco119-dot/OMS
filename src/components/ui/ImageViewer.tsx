import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useEffect, useRef, useState, type TouchEvent } from 'react';

export interface ImageViewerItem {
  alt: string;
  url: string;
}

type View = { scale: number; x: number; y: number };
type Point = { x: number; y: number };
type Gesture = { start: Point; current: Point; startView: View; distance: number; multi: boolean; moved: boolean };
const initialView: View = { scale: 1, x: 0, y: 0 };
const tapDelay = 300;
const point = (touch: { clientX: number; clientY: number }): Point => ({ x: touch.clientX, y: touch.clientY });
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function ImageViewer({ actionLabel, activeIndex, images, label = '图片全屏预览', onAction, onClose, onIndexChange }: {
  actionLabel?: string;
  activeIndex: number;
  images: ImageViewerItem[];
  label?: string;
  onAction?: (index: number) => void;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const [view, setView] = useState<View>(initialView);
  const viewRef = useRef(view);
  const imageRef = useRef<HTMLImageElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickUntil = useRef(0);
  const index = Math.min(Math.max(activeIndex, 0), Math.max(images.length - 1, 0));
  const active = images[index];
  const updateView = (next: View) => {
    const scale = Math.max(1, Math.min(4, next.scale));
    const image = imageRef.current;
    const maxX = image ? Math.max(0, (image.offsetWidth * scale - window.innerWidth) / 2) : 0;
    const maxY = image ? Math.max(0, (image.offsetHeight * scale - window.innerHeight) / 2) : 0;
    const bounded = { scale, x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
    viewRef.current = bounded;
    setView(bounded);
  };
  const clearTap = () => { if (tapTimer.current) clearTimeout(tapTimer.current); tapTimer.current = null; };
  const change = (offset: number) => {
    if (images.length < 2) return;
    clearTap();
    updateView(initialView);
    onIndexChange((index + offset + images.length) % images.length);
  };
  useEffect(() => {
    viewRef.current = initialView;
    setView(initialView);
    clearTap();
  }, [index]);
  useEffect(() => () => clearTap(), []);
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

  const tap = (location: Point) => {
    if (tapTimer.current) {
      clearTap();
      const scale = viewRef.current.scale > 1 ? 1 : 2;
      updateView({ scale, x: (window.innerWidth / 2 - location.x) * (scale - 1), y: (window.innerHeight / 2 - location.y) * (scale - 1) });
      return;
    }
    tapTimer.current = setTimeout(() => { tapTimer.current = null; onClose(); }, tapDelay);
  };
  const touchStart = (event: TouchEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('button')) return;
    const touches = event.touches;
    if (touches.length >= 2) {
      clearTap();
      const a = point(touches[0]); const b = point(touches[1]);
      gesture.current = { start: midpoint(a, b), current: midpoint(a, b), startView: viewRef.current, distance: distance(a, b), multi: true, moved: false };
    } else if (touches.length === 1) {
      const start = point(touches[0]);
      gesture.current = { start, current: start, startView: viewRef.current, distance: 0, multi: false, moved: false };
    }
  };
  const touchMove = (event: TouchEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || !event.touches.length) return;
    if (g.multi && event.touches.length >= 2) {
      const a = point(event.touches[0]); const b = point(event.touches[1]);
      const middle = midpoint(a, b);
      const scale = g.startView.scale * distance(a, b) / Math.max(g.distance, 1);
      const ratio = Math.max(1, Math.min(4, scale)) / g.startView.scale;
      updateView({ scale, x: (g.startView.x + window.innerWidth / 2 - g.start.x) * ratio + middle.x - window.innerWidth / 2, y: (g.startView.y + window.innerHeight / 2 - g.start.y) * ratio + middle.y - window.innerHeight / 2 });
      g.moved = true;
    } else if (!g.multi && event.touches.length === 1) {
      g.current = point(event.touches[0]);
      const dx = g.current.x - g.start.x; const dy = g.current.y - g.start.y;
      if (Math.hypot(dx, dy) > 8) { g.moved = true; clearTap(); }
      if (g.startView.scale > 1) updateView({ ...g.startView, x: g.startView.x + dx, y: g.startView.y + dy });
    }
  };
  const touchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || event.touches.length > 0) return;
    gesture.current = null;
    suppressClickUntil.current = Date.now() + 800;
    if (g.multi) return;
    const end = event.changedTouches.length ? point(event.changedTouches[0]) : g.current;
    const dx = end.x - g.start.x; const dy = end.y - g.start.y;
    if (viewRef.current.scale === 1 && Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy)) { change(dx > 0 ? -1 : 1); return; }
    if (!g.moved && Math.hypot(dx, dy) < 10) tap(end);
  };

  return <div
    aria-label={label}
    aria-modal="true"
    className="fixed inset-0 z-[100] flex touch-none items-center justify-center overflow-hidden bg-black/95 p-3"
    onClick={(event) => { if (Date.now() >= suppressClickUntil.current) tap({ x: event.clientX, y: event.clientY }); }}
    onTouchEnd={touchEnd}
    onTouchMove={touchMove}
    onTouchStart={touchStart}
    role="dialog"
  >
    {actionLabel && onAction ? <button aria-label={actionLabel} className="absolute left-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-10 flex min-h-12 items-center gap-2 rounded-full bg-white/15 px-4 text-sm font-semibold text-white" onClick={(event) => { event.stopPropagation(); clearTap(); onAction(index); }} type="button"><Download className="h-5 w-5" />{actionLabel}</button> : null}
    <button aria-label="关闭图片预览" className="absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white" onClick={(event) => { event.stopPropagation(); clearTap(); onClose(); }} type="button"><X className="h-6 w-6" /></button>
    {images.length > 1 ? <>
      <button aria-label="上一张图片" className="absolute left-2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white" onClick={(event) => { event.stopPropagation(); change(-1); }} type="button"><ChevronLeft className="h-7 w-7" /></button>
      <button aria-label="下一张图片" className="absolute right-2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white" onClick={(event) => { event.stopPropagation(); change(1); }} type="button"><ChevronRight className="h-7 w-7" /></button>
      <p className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] rounded-full bg-black/60 px-3 py-1 text-sm font-semibold text-white">{index + 1} / {images.length}</p>
    </> : null}
    <img alt={active.alt} className="max-h-[88dvh] max-w-full select-none object-contain" draggable={false} ref={imageRef} src={active.url} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, willChange: 'transform' }} />
  </div>;
}
