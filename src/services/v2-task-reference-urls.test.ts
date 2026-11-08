import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../types/database';
import { loadV2TaskReferenceImageUrls, type V2TaskAnswerRow } from './v2-tasks.service';
import { publicTaskReferenceUrl } from '../lib/taskReferenceUrl';
import { loadSignedImageResource } from '../lib/imageResourceCache';

vi.mock('../lib/env', () => ({ appEnv: { supabaseUrl: 'https://example.test/backend' } }));
vi.mock('../lib/imageResourceCache', () => ({
  invalidateStorageImage: vi.fn(), loadSignedImageResource: vi.fn(async (url: string) => url),
  loadStorageImageResource: vi.fn(), primeImageResource: vi.fn(), storageImageCacheKey: vi.fn(),
}));

describe('task reference image URLs', () => {
  it('rewrites internal signed links to the configured HTTPS backend without changing the token', async () => {
    const source = 'http://storehub_prod_gateway:8000/storage/v1/object/sign/v2-task-template-reference-images/t/i/a.jpg?token=abc';
    const invoke = vi.fn().mockResolvedValue({ data: { urls: { item: [source] } }, error: null });
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
    const result = await loadV2TaskReferenceImageUrls(client, [{ task_id: 'task' } as V2TaskAnswerRow]);
    const expected = 'https://example.test/backend/storage/v1/object/sign/v2-task-template-reference-images/t/i/a.jpg?token=abc';
    expect(result).toEqual({ item: [expected] });
    expect(loadSignedImageResource).toHaveBeenCalledWith(expected, expect.objectContaining({ variant: 'task-reference' }));
  });
  it('preserves unrelated or malformed URLs and supports existing proxy path prefixes', () => {
    expect(publicTaskReferenceUrl('http://internal/storage/v1/object/sign/other/a?token=x', 'https://public.test/backend')).toBe('http://internal/storage/v1/object/sign/other/a?token=x');
    expect(publicTaskReferenceUrl('bad-url', 'https://public.test/backend')).toBe('bad-url');
    expect(publicTaskReferenceUrl('http://internal/backend/storage/v1/object/sign/v2-task-template-reference-images/x?token=x', 'https://public.test/backend/')).toBe('https://public.test/backend/storage/v1/object/sign/v2-task-template-reference-images/x?token=x');
  });
});
