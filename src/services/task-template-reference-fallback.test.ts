import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyTaskTemplate } from '../features/task-templates/templateForm';
import type { Database } from '../types/database';
import { loadTaskTemplateDraftImageUrls } from './task-templates.service';
vi.mock('../lib/env', () => ({ appEnv: { supabaseUrl: 'https://example.test/backend' } }));
vi.mock('../lib/imageResourceCache', () => ({ loadStorageImageResource: vi.fn().mockRejectedValue(new Error('direct signing failed')) }));
describe('template reference image fallback', () => {
  it('uses the public backend for a signed image returned by the fallback function', async () => {
    const path = 'template/item/image.jpg';
    const draft = createEmptyTaskTemplate(); draft.id = 'template'; draft.groups[0].items[0].referenceImagePaths = [path];
    const signedUrl = `http://internal:8000/storage/v1/object/sign/v2-task-template-reference-images/${path}?token=abc`;
    const client = { storage: { from: () => ({ createSignedUrl: vi.fn().mockResolvedValue({ error: { message: 'unavailable' } }) }) }, functions: { invoke: vi.fn().mockResolvedValue({ data: { signedUrl }, error: null }) } } as unknown as SupabaseClient<Database>;
    const result = await loadTaskTemplateDraftImageUrls(client, draft);
    expect(result.groups[0].items[0].referenceImageUrl).toBe(`https://example.test/backend/storage/v1/object/sign/v2-task-template-reference-images/${path}?token=abc`);
  });
});
