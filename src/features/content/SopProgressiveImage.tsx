import type { SupabaseClient } from '@supabase/supabase-js';
import { ImageIcon, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { Database } from '../../types/database';
import { invalidateSopImageUrl, loadSopImageUrl, type SopImageVariant } from './sopImageDelivery';

type Client = SupabaseClient<Database>;

export function SopProgressiveImage({
  alt,
  client,
  containerClassName,
  eager = false,
  imageClassName,
  initialUrl = null,
  objectPath,
  onActivate,
  variant,
}: {
  alt: string;
  client: Client;
  containerClassName: string;
  eager?: boolean;
  imageClassName: string;
  initialUrl?: string | null;
  objectPath: string;
  onActivate?: (url: string) => void;
  variant: Exclude<SopImageVariant, 'original'>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [eligible, setEligible] = useState(eager || Boolean(initialUrl));
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [state, setState] = useState<'idle' | 'loading' | 'loaded' | 'error'>(initialUrl ? 'loading' : 'idle');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setUrl(initialUrl);
    setState(initialUrl ? 'loading' : 'idle');
    setEligible(eager || Boolean(initialUrl));
  }, [eager, initialUrl, objectPath, variant]);

  useEffect(() => {
    if (eligible) return;
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setEligible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setEligible(true);
        observer.disconnect();
      }
    }, { rootMargin: '500px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [eligible]);

  useEffect(() => {
    if (!eligible || initialUrl) return;
    let active = true;
    setState('loading');
    void loadSopImageUrl(client, objectPath, variant, { forceRefresh: attempt > 0 })
      .then((nextUrl) => {
        if (!active) return;
        setUrl(nextUrl);
        setState('loading');
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => { active = false; };
  }, [attempt, client, eligible, initialUrl, objectPath, variant]);

  const retry = () => {
    invalidateSopImageUrl(objectPath, variant);
    setUrl(null);
    setState('loading');
    setAttempt((value) => value + 1);
  };

  const image = url ? <img
    alt={alt}
    className={`${imageClassName} ${state === 'loaded' ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
    decoding="async"
    loading={eager ? 'eager' : 'lazy'}
    onError={() => { invalidateSopImageUrl(objectPath, variant); setState('error'); }}
    onLoad={() => setState('loaded')}
    src={url}
  /> : null;

  return <div className={`relative overflow-hidden bg-slate-100 ${containerClassName}`} ref={rootRef}>
    {onActivate && url && state === 'loaded'
      ? <button aria-label={`放大查看${alt}`} className="block h-full w-full" onClick={() => onActivate(url)} type="button">{image}</button>
      : image}
    {state !== 'loaded' ? <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-slate-400">
      {state === 'error'
        ? <button className="flex flex-col items-center gap-1 px-2 text-[11px] font-bold text-slate-600" onClick={(event) => { event.stopPropagation(); retry(); }} type="button"><RefreshCw className="h-4 w-4" />重新加载</button>
        : <><span className="absolute inset-0 animate-pulse bg-slate-200/70" /><ImageIcon className="relative h-5 w-5" /></>}
    </div> : null}
  </div>;
}
