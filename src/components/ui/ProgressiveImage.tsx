import { ImageOff, Loader2 } from 'lucide-react';
import { useEffect, useState, type ImgHTMLAttributes } from 'react';

interface ProgressiveImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  containerClassName?: string;
  resourceLoading?: boolean;
  src?: string | null;
}

/**
 * Keeps image transport and browser decoding outside the page loading state.
 * The surrounding page can render immediately while this component reports its
 * own loading or failure state.
 */
export function ProgressiveImage({
  alt,
  className = '',
  containerClassName = '',
  resourceLoading = false,
  src,
  ...imageProps
}: ProgressiveImageProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(src ? 'loading' : resourceLoading ? 'loading' : 'failed');

  useEffect(() => {
    setState(src ? 'loading' : resourceLoading ? 'loading' : 'failed');
  }, [resourceLoading, src]);

  const loading = resourceLoading || (Boolean(src) && state === 'loading');
  const failed = !loading && (!src || state === 'failed');

  return <span className={`relative block overflow-hidden bg-slate-100 ${containerClassName}`}>
    {src ? <img {...imageProps} alt={alt} className={`${className} ${state === 'ready' ? 'opacity-100' : 'opacity-0'}`} onError={() => setState('failed')} onLoad={() => setState('ready')} src={src} /> : null}
    {state !== 'ready' || resourceLoading ? <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-100 px-2 text-center text-xs font-semibold text-slate-500">
      {failed ? <ImageOff className="h-5 w-5" aria-hidden="true" /> : <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
      <span>{failed ? '图片预览加载失败' : '正在加载图片'}</span>
    </span> : null}
  </span>;
}
