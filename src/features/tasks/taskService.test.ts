import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../types/database';
import { findMissingDraftProductIds, findStaleDraftItemIds, submitTask } from './taskService';

type TaskRow = Database['public']['Tables']['tasks']['Row'];

const draftTask: TaskRow = {
  created_at: '2026-07-31T05:00:00.000Z',
  created_by: 'profile-1',
  export_meta: { existing: 'kept' },
  id: 'task-1',
  inventory_category_codes: ['fruit', 'frozen', 'other_food', 'packaging', 'consumable', 'non_consumable'],
  linked_v2_task_id: null,
  started_at: '2026-07-31T05:00:00.000Z',
  status: 'draft',
  store_id: 'store-1',
  submitted_at: null,
  task_type: 'inventory',
  updated_at: '2026-07-31T05:00:00.000Z',
};

describe('taskService draft product synchronization', () => {
  it('finds active products that were added after a draft was created', () => {
    expect(findMissingDraftProductIds(
      ['product-1', 'product-2', 'product-3'],
      ['product-1', null, 'product-2'],
    )).toEqual(['product-3']);
  });

  it('does not duplicate products already present in the draft', () => {
    expect(findMissingDraftProductIds(
      ['product-1', 'product-2'],
      ['product-1', 'product-2'],
    )).toEqual([]);
  });

  it('removes catalog items that were deleted after the draft was created', () => {
    expect(findStaleDraftItemIds([
      {
        id: 'item-deleted',
        product_action_status: 'deletion_approved',
        product_snapshot: { product_id: 'product-deleted', name: '旧商品', spec: '', count_unit: '件', product_code: null },
      },
      {
        id: 'item-active',
        product_action_status: null,
        product_snapshot: { product_id: 'product-active', name: '在售商品', spec: '', count_unit: '件', product_code: null },
      },
    ], ['product-active'])).toEqual(['item-deleted']);
  });

  it('keeps temporary items that do not have a catalog product id', () => {
    expect(findStaleDraftItemIds([
      {
        id: 'item-temporary',
        product_action_status: null,
        product_snapshot: { product_id: null, name: '临时商品', spec: '', count_unit: '件', product_code: null },
      },
    ], [])).toEqual([]);
  });
});

describe('taskService inventory submission', () => {
  it('submits successfully without requiring the update to return a single readable row', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const client = {
      from: vi.fn(() => ({ update })),
    } as unknown as Parameters<typeof submitTask>[0];

    const result = await submitTask(client, draftTask, { notify_admin: true });

    expect(client.from).toHaveBeenCalledWith('tasks');
    expect(eq).toHaveBeenCalledWith('id', draftTask.id);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'submitted',
      export_meta: expect.objectContaining({ existing: 'kept', notify_admin: true }),
    }));
    expect(result).toMatchObject({
      id: draftTask.id,
      status: 'submitted',
      submitted_at: expect.any(String),
    });
    expect(result.export_meta).toMatchObject({
      existing: 'kept',
      last_exported_at: result.submitted_at,
      notify_admin: true,
    });
  });

  it('still exposes real database update failures', async () => {
    const client = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: { message: '数据库写入失败' } }),
        })),
      })),
    } as unknown as Parameters<typeof submitTask>[0];

    await expect(submitTask(client, draftTask)).rejects.toThrow('数据库写入失败');
  });
});
