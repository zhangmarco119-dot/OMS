import { useState } from 'react';
import { ImageViewer } from '../../components/ui/ImageViewer';
import { ProgressiveImage } from '../../components/ui/ProgressiveImage';

export function TaskReferenceImagePreview({ loading = false, urls }: { loading?: boolean; urls: string[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const images = urls.filter(Boolean).map((url, index) => ({ alt: `参考图片 ${index + 1}`, url }));
  if (urls.length === 0 && !loading) return null;
  return <section className="mt-3 rounded-lg border border-brand-100 bg-brand-50 p-2.5"><p className="text-xs font-bold text-brand-800">参考图片</p><div className="mt-2 flex flex-wrap gap-2">{loading && urls.length === 0 ? <ProgressiveImage alt="参考图片" containerClassName="h-24 w-24 rounded-lg border bg-white" resourceLoading /> : images.map((image, index) => <button aria-label={`全屏查看参考图片 ${index + 1}`} className="block overflow-hidden rounded-lg border bg-white" key={`${index}-${image.url}`} onClick={() => setActiveIndex(index)} type="button"><ProgressiveImage alt={image.alt} className="h-24 w-24 object-cover" containerClassName="h-24 w-24" src={image.url} /></button>)}</div>{images.length ? <p className="mt-1 text-xs text-brand-700">点击图片可放大查看，多张图片可左右滑动切换</p> : null}{activeIndex != null ? <ImageViewer activeIndex={activeIndex} images={images} label="参考图片全屏预览" onClose={() => setActiveIndex(null)} onIndexChange={setActiveIndex} /> : null}</section>;
}
