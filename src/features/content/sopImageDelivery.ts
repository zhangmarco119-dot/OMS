import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../types/database';

type Client = SupabaseClient<Database>;

export type SopImageVariant = 'detail' | 'original' | 'thumbnail';

const SIGNED_URL_SECONDS = 60 * 60;
const CACHE_TTL_MS = 50 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 400;

type CachedUrl = { expiresAt: number; url: string };

const urlCache = new Map<string, CachedUrl>();
const pendingUrls = new Map<string, Promise<string>>();

const keyFor = (path: string, variant: SopImageVariant) => `${variant}:${path}`;

const pruneCache = () => {
  const now = Date.now();
  for (const [key, value] of urlCache) {
    if (value.expiresAt <= now) urlCache.delete(key);
  }
  while (urlCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = urlCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    urlCache.delete(oldestKey);
  }
};

const transformFor = (variant: SopImageVariant) => {
  if (variant === 'thumbnail') return { quality: 55, resize: 'cover' as const, width: 160 };
  if (variant === 'detail') return { quality: 72, resize: 'contain' as const, width: 960 };
  return undefined;
};

export const invalidateSopImageUrl = (path: string, variant?: SopImageVariant) => {
  if (variant) {
    urlCache.delete(keyFor(path, variant));
    pendingUrls.delete(keyFor(path, variant));
    return;
  }
  (['thumbnail', 'detail', 'original'] as const).forEach((entry) => {
    urlCache.delete(keyFor(path, entry));
    pendingUrls.delete(keyFor(path, entry));
  });
};

export const loadSopImageUrl = async (
  client: Client,
  path: string,
  variant: SopImageVariant,
  options: { forceRefresh?: boolean } = {},
) => {
  const cacheKey = keyFor(path, variant);
  if (options.forceRefresh) invalidateSopImageUrl(path, variant);
  const cached = urlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    urlCache.delete(cacheKey);
    urlCache.set(cacheKey, cached);
    return cached.url;
  }
  const pending = pendingUrls.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const transform = transformFor(variant);
    const signed = await client.storage
      .from('v2-sop-assets')
      .createSignedUrl(path, SIGNED_URL_SECONDS, transform ? { transform } : undefined);
    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(signed.error?.message ?? '无法加载 SOP 图片。');
    }
    pruneCache();
    urlCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, url: signed.data.signedUrl });
    return signed.data.signedUrl;
  })();
  pendingUrls.set(cacheKey, request);
  try {
    return await request;
  } finally {
    pendingUrls.delete(cacheKey);
  }
};

export const clearSopImageDeliveryCache = () => {
  urlCache.clear();
  pendingUrls.clear();
};
