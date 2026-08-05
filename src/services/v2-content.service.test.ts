import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../types/database';
import { archiveNotice, buildContentRecipients, createEmptyNoticeDraft, createEmptySopDraft, createSopTextStep, deleteArchivedSop, deleteNotice, deleteSopAsset, deleteSopCategory, loadSopDetail, loadSopLibraryPage, loadSopPage, publishSop, removeSopStepImage, renameSopCategory, reorderSopAssets, retractSop, unarchiveSop } from './v2-content.service';

describe('v2 content drafts', () => {
  it('loads an SOP card page with one lightweight query and a transformed preview signing request', async () => {
    const previewAsset = {
      asset_kind: 'cover', bucket: 'v2-sop-assets', created_at: '2026-07-16T00:00:00Z', file_name: 'cover.jpg', id: 'asset-1', mime_type: 'image/jpeg', object_path: 'sop-1/cover.jpg', size_bytes: 100, sop_id: 'sop-1', sort_order: 0, step_text: '', uploaded_by: 'admin-1',
    };
    const rpc = vi.fn().mockResolvedValue({
      data: {
        items: [{
          attachmentCount: 2, body: 'SOP description', category: 'drink', created_at: '2026-07-16T00:00:00Z', created_by: 'admin-1', effective_at: null, expires_at: null, id: 'sop-1', isFavorite: false, previewAsset, published_at: null, roles: ['staff'], status: 'draft', stepCount: 6, storeIds: ['store-1'], task_template_id: null, title: 'Test SOP', updated_at: '2026-07-16T00:00:00Z', version: 1,
        }],
        total: 1,
      },
      error: null,
    });
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://example.test/cover.jpg' }, error: null });
    const storageFrom = vi.fn().mockReturnValue({ createSignedUrl });
    const client = { rpc, storage: { from: storageFrom } } as unknown as SupabaseClient<Database>;

    const page = await loadSopPage(client, { category: 'drink', limit: 16, offset: 0, search: 'Test' });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('list_v2_sop_cards', {
      p_archived: false, p_category: 'drink', p_favorites_only: false, p_limit: 16, p_offset: 0, p_search: 'Test',
    });
    expect(storageFrom).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith('sop-1/cover.jpg', 3600, { transform: { height: 256, quality: 60, resize: 'cover', width: 256 } });
    expect(page).toMatchObject({
      items: [{ assetUrls: [{ signedUrl: 'https://example.test/cover.jpg' }], attachmentCount: 2, id: 'sop-1', stepCount: 6 }],
      total: 1,
    });
  });

  it('returns employee card metadata without signing or downloading preview images', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { items: [{ category: 'drink', effective_at: null, id: 'sop-1', isFavorite: false, previewAsset: { object_path: 'sop-1/cover.jpg' }, status: 'published', title: 'Test SOP', version: 1 }], total: 1 },
      error: null,
    });
    const storageFrom = vi.fn();
    const client = { rpc, storage: { from: storageFrom } } as unknown as SupabaseClient<Database>;

    const page = await loadSopLibraryPage(client, { limit: 5 });

    expect(page.items[0]).toMatchObject({ previewPath: 'sop-1/cover.jpg', previewUrl: null });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it('loads employee detail metadata with one RPC and leaves image signing to visible cards', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        assets: [{ asset_kind: 'step', created_at: '2026-07-16T00:00:00Z', id: 'asset-1', object_path: 'sop-1/step.jpg', sort_order: 0 }],
        category: 'drink', id: 'sop-1', roles: ['staff'], status: 'published', storeIds: ['store-1'], task_template_id: null, title: 'Test SOP',
      },
      error: null,
    });
    const storageFrom = vi.fn();
    const client = { rpc, storage: { from: storageFrom } } as unknown as SupabaseClient<Database>;

    const detail = await loadSopDetail(client, 'sop-1', { cacheMetadata: true, signAssets: false });

    expect(rpc).toHaveBeenCalledWith('get_v2_sop_detail', { p_sop_id: 'sop-1' });
    expect(detail?.assetUrls[0]).toMatchObject({ object_path: 'sop-1/step.jpg', signedUrl: null });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it('starts an announcement as an unpinned draft for selected stores', () => {
    expect(createEmptyNoticeDraft(['store-1'])).toEqual({
      body: '', expiresAt: '', id: null, isPinned: false, recipientIds: [], requiresAcknowledgment: false, storeIds: ['store-1'], title: '',
    });
  });

  it('includes a manager in every store granted through additional store access', () => {
    const recipients = buildContentRecipients([
      { display_name: '李天欣', id: 'manager-1', role: 'manager', store_id: 'store-wudaokou' },
      { display_name: '管理员', id: 'admin-1', role: 'admin', store_id: 'store-xizhimen' },
    ], [
      { profile_id: 'manager-1', store_id: 'store-xizhimen' },
      { profile_id: 'manager-1', store_id: 'store-wudaokou' },
    ]);

    expect(recipients).toEqual([{
      display_name: '李天欣',
      id: 'manager-1',
      role: 'manager',
      storeIds: ['store-wudaokou', 'store-xizhimen'],
    }]);
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

  it('creates a text-only SOP step without a storage object', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { asset_kind: 'step', id: 'step-1', object_path: null, step_text: '静置十分钟' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    const result = await createSopTextStep(client, { sopId: 'sop-1', sortOrder: 2, stepText: '  静置十分钟  ' });
    expect(rpc).toHaveBeenCalledWith('create_v2_sop_text_step', { p_sop_id: 'sop-1', p_sort_order: 2, p_step_text: '静置十分钟' });
    expect(result).toMatchObject({ id: 'step-1', signedUrl: null, step_text: '静置十分钟' });
  });

  it('deletes a text-only step without calling private storage', async () => {
    const remove = vi.fn();
    const eq = vi.fn().mockResolvedValue({ error: null });
    const client = { from: vi.fn().mockReturnValue({ delete: vi.fn().mockReturnValue({ eq }) }), storage: { from: vi.fn().mockReturnValue({ remove }) } } as unknown as SupabaseClient<Database>;
    await expect(deleteSopAsset(client, { id: 'step-1', object_path: null })).resolves.toEqual({ storageCleanupFailed: false });
    expect(remove).not.toHaveBeenCalled();
  });

  it('turns a mixed SOP step into a text-only step before cleaning up its image', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const client = { from: vi.fn().mockReturnValue({ update }), storage: { from: vi.fn().mockReturnValue({ remove }) } } as unknown as SupabaseClient<Database>;
    await removeSopStepImage(client, { asset_kind: 'step', id: 'step-1', object_path: 'sop-1/step.jpg', step_text: '保留文字说明' } as never);
    expect(update).toHaveBeenCalledWith({ file_name: null, mime_type: null, object_path: null, size_bytes: 0 });
    expect(eq).toHaveBeenCalledWith('id', 'step-1');
    expect(remove).toHaveBeenCalledWith(['sop-1/step.jpg']);
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

  it('restores an archived SOP to draft through the protected function', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'draft' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await unarchiveSop(client, 'sop-1');
    expect(rpc).toHaveBeenCalledWith('unarchive_v2_sop', { p_sop_id: 'sop-1' });
  });

  it('cleans private files before permanently deleting an archived SOP', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'sop-1' }, error: null });
    const client = { rpc, storage: { from: vi.fn().mockReturnValue({ remove }) } } as unknown as SupabaseClient<Database>;
    await deleteArchivedSop(client, { assetUrls: [{ object_path: 'sop-1/cover.jpg' }, { object_path: null }, { object_path: 'sop-1/step.jpg' }] as never, id: 'sop-1' });
    expect(remove).toHaveBeenCalledWith(['sop-1/cover.jpg', 'sop-1/step.jpg']);
    expect(rpc).toHaveBeenCalledWith('delete_archived_v2_sop', { p_sop_id: 'sop-1' });
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });
});
