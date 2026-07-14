import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../types/database';
import { archiveNotice, createEmptyNoticeDraft, createEmptySopDraft, deleteArchivedSop, deleteNotice, deleteSopAsset, deleteSopCategory, publishSop, renameSopCategory, reorderSopAssets, retractSop } from './v2-content.service';

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

  it('archives an unpublished notice through the protected lifecycle function', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'archived' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await archiveNotice(client, 'notice-1');
    expect(rpc).toHaveBeenCalledWith('archive_v2_notice', { p_notice_id: 'notice-1' });
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

  it('renames a category and its existing SOPs through one protected transaction', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { updated_sops: 3 }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await renameSopCategory(client, { categoryId: 'category-1', newName: '  冰沙制作  ' });
    expect(rpc).toHaveBeenCalledWith('rename_v2_sop_category', {
      p_category_id: 'category-1',
      p_new_name: '冰沙制作',
    });
  });

  it('persists the complete ordered SOP image id list atomically', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { asset_ids: ['image-2', 'image-1'] }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await reorderSopAssets(client, 'sop-1', ['image-2', 'image-1']);
    expect(rpc).toHaveBeenCalledWith('reorder_v2_sop_assets', {
      p_asset_ids: ['image-2', 'image-1'],
      p_sop_id: 'sop-1',
    });
  });

  it('passes the silent publish choice to the protected lifecycle function', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'published' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await publishSop(client, 'sop-1', { silent: true });
    expect(rpc).toHaveBeenCalledWith('publish_v2_sop_with_options', { p_silent: true, p_sop_id: 'sop-1' });
  });

  it('retracts a published SOP back to draft through the protected function', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'draft' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await retractSop(client, 'sop-1');
    expect(rpc).toHaveBeenCalledWith('retract_v2_sop', { p_sop_id: 'sop-1' });
  });

  it('cleans private files before permanently deleting an archived SOP', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'sop-1' }, error: null });
    const client = { rpc, storage: { from: vi.fn().mockReturnValue({ remove }) } } as unknown as SupabaseClient<Database>;
    await deleteArchivedSop(client, { assetUrls: [{ object_path: 'sop-1/cover.jpg' }, { object_path: 'sop-1/step.jpg' }] as never, id: 'sop-1' });
    expect(remove).toHaveBeenCalledWith(['sop-1/cover.jpg', 'sop-1/step.jpg']);
    expect(rpc).toHaveBeenCalledWith('delete_archived_v2_sop', { p_sop_id: 'sop-1' });
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });
});
