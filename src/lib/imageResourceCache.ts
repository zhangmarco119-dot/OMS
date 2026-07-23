import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../types/database';

type Client = SupabaseClient<Database>;

export type ImageCacheScope = 'device' | 'session';

export interface StorageImageTransform {
  height?: number;
  quality?: number;
  resize?: 'contain' | 'cover' | 'fill';
  width?: number;
}

export interface ImageResourceOptions {
  forceRefresh?: boolean;
  scope?: ImageCacheScope;
  variant?: string;
  version?: string;
}

interface MemoryEntry {
  expiresAt: number;
  lastAccess: number;
  ownedObjectUrl: boolean;
  size: number;
  url: string;
}

const MEMORY_MAX_ENTRIES = 150;
const MEMORY_MAX_BYTES = 80 * 1024 * 1024;
const MEMORY_BLOB_TTL_MS = 6 * 60 * 60 * 1_000;
const MEMORY_SIGNED_URL_TTL_MS = 50 * 60 * 1_000;
const DEVICE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const DEVICE_CACHE_NAME = 'storehub-image-resources-v1';
const CACHE_ROUTE = '/__storehub_image_cache__/';
const DEVICE_MAX_ENTRIES = 180;
const DEVICE_MAX_BYTES = 120 * 1024 * 1024;

const memoryCache = new Map<string, MemoryEntry>();
const pendingLoads = new Map<string, Promise<string>>();
let memoryBytes = 0;
let deviceWritesSincePrune = 0;

const canUseObjectUrls = () =>
  typeof window !== 'undefined'
  && typeof window.URL?.createObjectURL === 'function'
  && typeof window.fetch === 'function';

const canUseDeviceCache = () =>
  typeof window !== 'undefined'
  && typeof window.caches !== 'undefined'
  && typeof window.Response !== 'undefined';

const shouldFetchSignedUrl = (signedUrl: string) => {
  try {
    return !new URL(signedUrl).hostname.endsWith('.test');
  } catch {
    return true;
  }
};

const revokeEntry = (entry: MemoryEntry) => {
  if (entry.ownedObjectUrl && typeof URL?.revokeObjectURL === 'function') {
    URL.revokeObjectURL(entry.url);
  }
};

const deleteMemoryEntry = (key: string) => {
  const entry = memoryCache.get(key);
  if (!entry) return;
  memoryCache.delete(key);
  memoryBytes = Math.max(0, memoryBytes - entry.size);
  revokeEntry(entry);
};

const pruneMemoryCache = () => {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) deleteMemoryEntry(key);
  }
  if (memoryCache.size <= MEMORY_MAX_ENTRIES && memoryBytes <= MEMORY_MAX_BYTES) return;
  const oldest = [...memoryCache.entries()].sort((left, right) => left[1].lastAccess - right[1].lastAccess);
  for (const [key] of oldest) {
    if (memoryCache.size <= MEMORY_MAX_ENTRIES && memoryBytes <= MEMORY_MAX_BYTES) break;
    deleteMemoryEntry(key);
  }
};

const putMemoryEntry = (key: string, entry: MemoryEntry) => {
  deleteMemoryEntry(key);
  memoryCache.set(key, entry);
  memoryBytes += entry.size;
  pruneMemoryCache();
};

const getMemoryEntry = (key: string) => {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    deleteMemoryEntry(key);
    return null;
  }
  entry.lastAccess = Date.now();
  // Reinsertion keeps the common path ordered without sorting on every prune.
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  return entry.url;
};

const deviceRequestUrl = (key: string) => {
  const origin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://storehub.invalid';
  return `${origin}${CACHE_ROUTE}${encodeURIComponent(key)}`;
};

const loadDeviceBlob = async (key: string) => {
  if (!canUseDeviceCache()) return null;
  try {
    const cache = await window.caches.open(DEVICE_CACHE_NAME);
    const requestUrl = deviceRequestUrl(key);
    const response = await cache.match(requestUrl);
    if (!response) return null;
    const storedAt = Number(response.headers.get('x-storehub-cached-at') ?? 0);
    if (!storedAt || Date.now() - storedAt > DEVICE_CACHE_TTL_MS) {
      await cache.delete(requestUrl);
      return null;
    }
    return await response.blob();
  } catch {
    return null;
  }
};

const storeDeviceBlob = async (key: string, blob: Blob) => {
  if (!canUseDeviceCache()) return;
  try {
    const cache = await window.caches.open(DEVICE_CACHE_NAME);
    const headers = new Headers({
      'content-length': String(blob.size),
      'content-type': blob.type || 'application/octet-stream',
      'x-storehub-cached-at': String(Date.now()),
    });
    await cache.put(deviceRequestUrl(key), new Response(blob, { headers }));
    deviceWritesSincePrune += 1;
    if (deviceWritesSincePrune < 10) return;
    deviceWritesSincePrune = 0;
    const requests = await cache.keys();
    const entries = (await Promise.all(requests.map(async (request) => {
      const response = await cache.match(request);
      return {
        cachedAt: Number(response?.headers.get('x-storehub-cached-at') ?? 0),
        request,
        size: Number(response?.headers.get('content-length') ?? 0),
      };
    }))).sort((left, right) => left.cachedAt - right.cachedAt);
    let totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
    let totalEntries = entries.length;
    for (const entry of entries) {
      if (
        entry.cachedAt > Date.now() - DEVICE_CACHE_TTL_MS
        && totalEntries <= DEVICE_MAX_ENTRIES
        && totalBytes <= DEVICE_MAX_BYTES
      ) break;
      await cache.delete(entry.request);
      totalEntries -= 1;
      totalBytes = Math.max(0, totalBytes - entry.size);
    }
  } catch {
    // Device cache is an optimization. Memory caching must continue to work.
  }
};

const deleteDeviceEntry = async (key: string) => {
  if (!canUseDeviceCache()) return;
  try {
    const cache = await window.caches.open(DEVICE_CACHE_NAME);
    await cache.delete(deviceRequestUrl(key));
  } catch {
    // Ignore cache cleanup failures; the entry is versioned and expires.
  }
};

const blobToMemoryUrl = (key: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  putMemoryEntry(key, {
    expiresAt: Date.now() + MEMORY_BLOB_TTL_MS,
    lastAccess: Date.now(),
    ownedObjectUrl: true,
    size: blob.size,
    url,
  });
  return url;
};

export const storageImageCacheKey = (
  bucket: string,
  objectPath: string,
  options: Pick<ImageResourceOptions, 'variant' | 'version'> = {},
) => `storage:${bucket}:${options.variant ?? 'original'}:${options.version ?? 'v1'}:${objectPath}`;

export const signedImageCacheKey = (signedUrl: string, variant = 'original') => {
  try {
    const parsed = new URL(signedUrl);
    const stableTransform = [...parsed.searchParams.entries()]
      .filter(([name]) => name !== 'token')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${value}`)
      .join('&');
    return `signed:${variant}:${parsed.origin}${parsed.pathname}${stableTransform ? `?${stableTransform}` : ''}`;
  } catch {
    return `signed:${variant}:${signedUrl.split('?')[0]}`;
  }
};

export const invalidateImageResource = (key: string) => {
  deleteMemoryEntry(key);
  pendingLoads.delete(key);
  void deleteDeviceEntry(key);
};

export const invalidateStorageImage = (
  bucket: string,
  objectPath: string,
  variants: Array<{ variant?: string; version?: string }> = [{}],
) => {
  variants.forEach((options) => invalidateImageResource(storageImageCacheKey(bucket, objectPath, options)));
};

export const primeImageResource = async (
  key: string,
  blob: Blob,
  scope: ImageCacheScope = 'session',
) => {
  if (!canUseObjectUrls()) return null;
  const url = blobToMemoryUrl(key, blob);
  if (scope === 'device') void storeDeviceBlob(key, blob);
  return url;
};

const materializeSignedUrl = async (
  signedUrl: string,
  key: string,
  scope: ImageCacheScope,
  skipDeviceLookup = false,
) => {
  if (!skipDeviceLookup && scope === 'device' && canUseObjectUrls()) {
    const stored = await loadDeviceBlob(key);
    if (stored) {
      void storeDeviceBlob(key, stored);
      return blobToMemoryUrl(key, stored);
    }
  }
  if (canUseObjectUrls() && shouldFetchSignedUrl(signedUrl)) {
    try {
      const response = await window.fetch(signedUrl, { credentials: 'omit' });
      if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
      const blob = await response.blob();
      if (scope === 'device') void storeDeviceBlob(key, blob);
      return blobToMemoryUrl(key, blob);
    } catch {
      // Some storage/CDN responses may not permit a JavaScript fetch even
      // though an <img> element can display them. Keep the signed URL fallback.
    }
  }
  putMemoryEntry(key, {
    expiresAt: Date.now() + MEMORY_SIGNED_URL_TTL_MS,
    lastAccess: Date.now(),
    ownedObjectUrl: false,
    size: 0,
    url: signedUrl,
  });
  return signedUrl;
};

export const loadSignedImageResource = async (
  signedUrl: string,
  options: ImageResourceOptions & { key?: string } = {},
) => {
  const key = options.key ?? signedImageCacheKey(signedUrl, options.variant);
  if (options.forceRefresh) invalidateImageResource(key);
  const cached = getMemoryEntry(key);
  if (cached) return cached;
  const pending = pendingLoads.get(key);
  if (pending) return pending;

  const request = (async () => {
    const scope = options.scope ?? 'session';
    return materializeSignedUrl(signedUrl, key, scope);
  })();
  pendingLoads.set(key, request);
  try {
    return await request;
  } finally {
    pendingLoads.delete(key);
  }
};

export const loadStorageImageResource = async (
  client: Client,
  bucket: string,
  objectPath: string,
  options: ImageResourceOptions & { transform?: StorageImageTransform } = {},
) => {
  const key = storageImageCacheKey(bucket, objectPath, options);
  if (options.forceRefresh) invalidateImageResource(key);
  const cached = getMemoryEntry(key);
  if (cached) return cached;
  const pending = pendingLoads.get(key);
  if (pending) return pending;

  const request = (async () => {
    if ((options.scope ?? 'session') === 'device' && canUseObjectUrls()) {
      const stored = await loadDeviceBlob(key);
      if (stored) {
        void storeDeviceBlob(key, stored);
        return blobToMemoryUrl(key, stored);
      }
    }
    const storage = client.storage.from(bucket);
    const signed = options.transform
      ? await storage.createSignedUrl(objectPath, 60 * 60, { transform: options.transform })
      : await storage.createSignedUrl(objectPath, 60 * 60);
    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(signed.error?.message ?? '无法加载图片。');
    }
    return materializeSignedUrl(signed.data.signedUrl, key, options.scope ?? 'session', true);
  })();
  pendingLoads.set(key, request);
  try {
    return await request;
  } finally {
    pendingLoads.delete(key);
  }
};

export const clearImageResourceCache = async (options: { persistent?: boolean } = {}) => {
  for (const key of [...memoryCache.keys()]) deleteMemoryEntry(key);
  pendingLoads.clear();
  deviceWritesSincePrune = 0;
  if (options.persistent && canUseDeviceCache()) {
    try {
      await window.caches.delete(DEVICE_CACHE_NAME);
    } catch {
      // The next login can safely continue with an empty memory cache.
    }
  }
};

export const getImageResourceCacheStats = () => ({
  bytes: memoryBytes,
  entries: memoryCache.size,
  pending: pendingLoads.size,
});
