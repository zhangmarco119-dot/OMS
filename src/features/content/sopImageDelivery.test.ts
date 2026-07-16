import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../types/database';
import { clearSopImageDeliveryCache, loadSopImageUrl } from './sopImageDelivery';

describe('SOP progressive image delivery', () => {
  beforeEach(() => clearSopImageDeliveryCache());

  it('requests small transformed thumbnails instead of original files', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://example.test/thumb' }, error: null });
    const client = { storage: { from: vi.fn().mockReturnValue({ createSignedUrl }) } } as unknown as SupabaseClient<Database>;

    await expect(loadSopImageUrl(client, 'sop-1/cover.jpg', 'thumbnail')).resolves.toBe('https://example.test/thumb');
    expect(createSignedUrl).toHaveBeenCalledWith('sop-1/cover.jpg', 3600, {
      transform: { quality: 55, resize: 'contain', width: 160 },
    });
  });

  it('deduplicates simultaneous signing and reuses the session cache', async () => {
    let resolveSigning: (value: { data: { signedUrl: string }; error: null }) => void = () => undefined;
    const createSignedUrl = vi.fn().mockReturnValue(new Promise((resolve) => { resolveSigning = resolve; }));
    const client = { storage: { from: vi.fn().mockReturnValue({ createSignedUrl }) } } as unknown as SupabaseClient<Database>;

    const first = loadSopImageUrl(client, 'sop-1/step.jpg', 'detail');
    const second = loadSopImageUrl(client, 'sop-1/step.jpg', 'detail');
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    resolveSigning({ data: { signedUrl: 'https://example.test/detail' }, error: null });
    await expect(Promise.all([first, second])).resolves.toEqual(['https://example.test/detail', 'https://example.test/detail']);
    await expect(loadSopImageUrl(client, 'sop-1/step.jpg', 'detail')).resolves.toBe('https://example.test/detail');
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('uses the original object only for an explicit full-screen request', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://example.test/original' }, error: null });
    const client = { storage: { from: vi.fn().mockReturnValue({ createSignedUrl }) } } as unknown as SupabaseClient<Database>;

    await loadSopImageUrl(client, 'sop-1/step.jpg', 'original');
    expect(createSignedUrl).toHaveBeenCalledWith('sop-1/step.jpg', 3600, undefined);
  });
});
