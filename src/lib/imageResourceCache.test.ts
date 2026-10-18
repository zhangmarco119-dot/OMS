import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../types/database';
import {
  clearImageResourceCache,
  getImageResourceCacheStats,
  invalidateStorageImage,
  loadStorageImageResource,
  loadSignedImageResource,
  primeImageResource,
  storageImageCacheKey,
} from './imageResourceCache';

const originalWindowFetch = window.fetch;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

describe('imageResourceCache', () => {
  beforeEach(async () => {
    await clearImageResourceCache({ persistent: true });
    let objectUrlSequence = 0;
    URL.createObjectURL = vi.fn(() => `blob:cached-${++objectUrlSequence}`);
    URL.revokeObjectURL = vi.fn();
    window.fetch = vi.fn().mockResolvedValue({
      blob: vi.fn().mockResolvedValue(new Blob(['image'], { type: 'image/jpeg' })),
      ok: true,
      status: 200,
    } as unknown as Response);
  });

  afterEach(async () => {
    await clearImageResourceCache({ persistent: true });
    window.fetch = originalWindowFetch;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    vi.restoreAllMocks();
  });

  it('deduplicates concurrent downloads and reuses image bytes after remount-like calls', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://cdn.example.com/image?token=one' }, error: null });
    const client = { storage: { from: vi.fn().mockReturnValue({ createSignedUrl }) } } as unknown as SupabaseClient<Database>;

    const first = loadStorageImageResource(client, 'private-images', 'task/image.jpg');
    const second = loadStorageImageResource(client, 'private-images', 'task/image.jpg');
    await expect(Promise.all([first, second])).resolves.toEqual(['blob:cached-1', 'blob:cached-1']);
    await expect(loadStorageImageResource(client, 'private-images', 'task/image.jpg')).resolves.toBe('blob:cached-1');
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(window.fetch).toHaveBeenCalledTimes(1);
  });

  it('invalidates replaced resources and downloads the current object again', async () => {
    const createSignedUrl = vi.fn()
      .mockResolvedValueOnce({ data: { signedUrl: 'https://cdn.example.com/image?token=one' }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: 'https://cdn.example.com/image?token=two' }, error: null });
    const client = { storage: { from: vi.fn().mockReturnValue({ createSignedUrl }) } } as unknown as SupabaseClient<Database>;

    await expect(loadStorageImageResource(client, 'private-images', 'task/image.jpg')).resolves.toBe('blob:cached-1');
    invalidateStorageImage('private-images', 'task/image.jpg');
    await expect(loadStorageImageResource(client, 'private-images', 'task/image.jpg')).resolves.toBe('blob:cached-2');
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cached-1');
  });

  it('primes an uploaded blob for immediate preview without another network request', async () => {
    const key = storageImageCacheKey('arrival-report-images', 'store/report/photo.jpg');
    await expect(primeImageResource(key, new Blob(['new-photo'], { type: 'image/jpeg' }))).resolves.toBe('blob:cached-1');
    expect(getImageResourceCacheStats()).toMatchObject({ entries: 1, pending: 0 });
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('revokes private blob URLs when the session cache is cleared', async () => {
    await primeImageResource(storageImageCacheKey('private-images', 'one.jpg'), new Blob(['one']));
    await clearImageResourceCache();
    expect(getImageResourceCacheStats()).toEqual({ bytes: 0, entries: 0, pending: 0 });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cached-1');
  });

  it('limits a large gallery to four signing/download pipelines and releases every slot', async () => {
    const finish: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    window.fetch = vi.fn(() => {
      active += 1;
      peak = Math.max(active, peak);
      return new Promise<Response>((resolve) => finish.push(() => {
        active -= 1;
        resolve({ ok: true, blob: async () => new Blob(['photo']) } as Response);
      }));
    });
    const createSignedUrl = vi.fn(async (path: string) => ({ data: { signedUrl: `https://cdn.example.com/${path}` }, error: null }));
    const client = { storage: { from: () => ({ createSignedUrl }) } } as unknown as SupabaseClient<Database>;
    const gallery = Array.from({ length: 12 }, (_, i) => loadStorageImageResource(client, 'photos', `${i}.jpg`));
    await vi.waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(4));
    expect(createSignedUrl).toHaveBeenCalledTimes(4);
    for (let batch = 0; batch < 3; batch += 1) {
      finish.splice(0).forEach((resolve) => resolve());
      await vi.waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(Math.min(12, (batch + 2) * 4)));
    }
    await Promise.all(gallery);
    expect(peak).toBe(4);
    expect(getImageResourceCacheStats().pending).toBe(0);
  });

  it('does not cache HTTP errors as usable images or retry them via an img fallback', async () => {
    vi.mocked(window.fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    await expect(loadSignedImageResource('https://cdn.example.com/missing.jpg')).rejects.toThrow('404');
    expect(getImageResourceCacheStats().entries).toBe(0);
    await expect(loadSignedImageResource('https://cdn.example.com/missing.jpg')).resolves.toBe('blob:cached-1');
    expect(window.fetch).toHaveBeenCalledTimes(2);
  });

  it('cancels queued work on logout and prevents old downloads from refilling the new session cache', async () => {
    const finish: Array<() => void> = [];
    window.fetch = vi.fn(() => new Promise<Response>((resolve) => finish.push(() => resolve({ ok: true, blob: async () => new Blob(['private']) } as Response))));
    const loads = Promise.allSettled(Array.from({ length: 8 }, (_, i) => loadSignedImageResource(`https://cdn.example.com/private-${i}.jpg`)));
    await vi.waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(4));
    await clearImageResourceCache();
    finish.forEach((resolve) => resolve());
    const results = await loads;
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(window.fetch).toHaveBeenCalledTimes(4);
    expect(getImageResourceCacheStats()).toEqual({ bytes: 0, entries: 0, pending: 0 });
  });

  it('reuses device bytes without rewriting the blob or signing/downloading again', async () => {
    const put = vi.fn();
    const response = { headers: new Headers({ 'x-storehub-cached-at': String(Date.now()) }), blob: async () => new Blob(['device-photo']) };
    const originalCaches = window.caches;
    const originalResponse = window.Response;
    Object.defineProperty(window, 'caches', { configurable: true, value: { open: async () => ({ match: async () => response, put }), delete: vi.fn() } });
    Object.defineProperty(window, 'Response', { configurable: true, value: class {} });
    try {
      const createSignedUrl = vi.fn();
      const client = { storage: { from: () => ({ createSignedUrl }) } } as unknown as SupabaseClient<Database>;
      await expect(loadStorageImageResource(client, 'photos', 'cached.jpg', { scope: 'device' })).resolves.toBe('blob:cached-1');
      expect(put).not.toHaveBeenCalled();
      expect(window.fetch).not.toHaveBeenCalled();
      expect(createSignedUrl).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'caches', { configurable: true, value: originalCaches });
      Object.defineProperty(window, 'Response', { configurable: true, value: originalResponse });
    }
  });
});
