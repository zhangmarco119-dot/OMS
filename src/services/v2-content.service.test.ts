import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../types/database';
import { createEmptyNoticeDraft, createEmptySopDraft, deleteNotice, deleteSopAsset, deleteSopCategory } from './v2-content.service';

describe('v2 content drafts', () => {
  it('starts an announcement as an unpinned draft for selected stores', () => {
    expect(createEmptyNoticeDraft(['store-1'])).toEqual({
      body: '', expiresAt: '', id: null, isPinned: false, recipientIds: [], requiresAcknowledgment: false, storeIds: ['store-1'], title: '',
    });
  });

  it('targets both store roles by default for a new SOP', () => {
    expect(createEmptySopDraft(['store-1'])).toMatchObject({
      category: '通用', id: null, roles: ['staff', 'manager'], storeIds: ['store-1'],
    });
  });

  it('removes private notice assets before deleting the protected notice record', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: { deleted: true }, error: null });
    const client = { rpc, storage: { from: vi.fn().mockReturnValue({ remove }) } } as unknown as SupabaseClient<Database>;
    await deleteNotice(client, { assetUrls: [{ object_path: 'notice-1/file.png' }] as never, id: 'notice-1' });
    expect(remove).toHaveBeenCalledWith(['notice-1/file.png']);
    expect(rpc).toHaveBeenCalledWith('delete_v2_notice', { p_notice_id: 'notice-1' });
  });

  it('removes SOP metadata before cleaning up its private storage object', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const eq = vi.fn().mockResolvedValue({ error: null });
    const deleteRows = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ delete: deleteRows });
    const client = { from, storage: { from: vi.fn().mockReturnValue({ remove }) } } as unknown as SupabaseClient<Database>;
    await deleteSopAsset(client, { id: 'asset-1', object_path: 'sop-1/step.png' });
    expect(remove).toHaveBeenCalledWith(['sop-1/step.png']);
    expect(from).toHaveBeenCalledWith('v2_sop_assets');
    expect(eq).toHaveBeenCalledWith('id', 'asset-1');
    expect(eq.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
  });

  it('deletes an unused SOP category through the protected database function', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { deleted: true }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await deleteSopCategory(client, 'category-1');
    expect(rpc).toHaveBeenCalledWith('delete_v2_sop_category', { p_category_id: 'category-1' });
  });

  it('shows a Chinese explanation when a category is still in use', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'SOP_CATEGORY_IN_USE:2' } });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await expect(deleteSopCategory(client, 'category-1')).rejects.toThrow('该分类仍被 SOP 使用');
  });
});
