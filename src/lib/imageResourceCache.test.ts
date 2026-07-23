import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../types/database';
import {
  clearImageResourceCache,
  getImageResourceCacheStats,
  invalidateStorageImage,
  loadStorageImageResource,
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
});
