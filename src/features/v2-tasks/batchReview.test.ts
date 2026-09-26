import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canReviewV2Task,
  loadSubmittedLinkedInventoryTask,
  loadV2TaskDetail,
  reviewV2TaskItems,
  reviewV2TaskItemsWithInventory,
} from '../../services/v2-tasks.service';
import type { Database } from '../../types/database';
import { reviewV2TasksBatch } from './batchReview';

vi.mock('../../services/v2-tasks.service', () => ({
  canReviewV2Task: vi.fn(),
  loadSubmittedLinkedInventoryTask: vi.fn(),
  loadV2TaskDetail: vi.fn(),
  reviewV2TaskItems: vi.fn(),
  reviewV2TaskItemsWithInventory: vi.fn(),
}));

const client = {} as SupabaseClient<Database>;
const detail = (id: string, status: 'submitted' | 'resubmitted', requiresInventory = false) => ({
  answers: [
    { item_id: `${id}-a`, review_status: status === 'submitted' ? 'pending' : 'resubmitted' },
    { item_id: `${id}-done`, review_status: 'approved' },
  ],
  task: { id, inventory_correction_task_id: null, requires_inventory: requiresInventory, status },
});

describe('reviewV2TasksBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canReviewV2Task).mockResolvedValue(true);
    vi.mocked(loadV2TaskDetail).mockImplementation(async (_client, id) => detail(id, 'submitted') as Awaited<ReturnType<typeof loadV2TaskDetail>>);
    vi.mocked(reviewV2TaskItems).mockResolvedValue({});
    vi.mocked(reviewV2TaskItemsWithInventory).mockResolvedValue({});
  });

  it('approves only the current round and continues after a failed task', async () => {
    vi.mocked(reviewV2TaskItems).mockRejectedValueOnce(new Error('任务已被其他人处理'));
    const progress = vi.fn();
    const result = await reviewV2TasksBatch(client, [
      { id: 'one', name: '任务一' },
      { id: 'two', name: '任务二' },
    ], 'approved', '', progress);

    expect(reviewV2TaskItems).toHaveBeenCalledWith(client, 'one', [{ decision: 'approved', itemId: 'one-a', note: '' }], '');
    expect(reviewV2TaskItems).toHaveBeenCalledWith(client, 'two', [{ decision: 'approved', itemId: 'two-a', note: '' }], '');
    expect(result).toEqual({
      failed: [{ id: 'one', name: '任务一', reason: '任务已被其他人处理' }],
      succeeded: [{ id: 'two', name: '任务二' }],
    });
    expect(progress.mock.calls).toEqual([[1], [2]]);
  });

  it('rejects current-round answers and linked inventory items together', async () => {
    vi.mocked(loadV2TaskDetail).mockResolvedValue(detail('linked', 'resubmitted', true) as Awaited<ReturnType<typeof loadV2TaskDetail>>);
    vi.mocked(loadSubmittedLinkedInventoryTask).mockResolvedValue({ id: 'inventory-1', items: [{ id: 'item-1' }, { id: 'item-2' }] } as Awaited<ReturnType<typeof loadSubmittedLinkedInventoryTask>>);

    const result = await reviewV2TasksBatch(client, [{ id: 'linked', name: '关联点货任务' }], 'rejected', '  重新核对  ');

    expect(reviewV2TaskItemsWithInventory).toHaveBeenCalledWith(client, 'linked', [
      { decision: 'rejected', itemId: 'linked-a', note: '重新核对' },
    ], '重新核对', 'inventory-1', ['item-1', 'item-2']);
    expect(result.failed).toEqual([]);
    expect(result.succeeded).toHaveLength(1);
  });

  it('requires a rejection reason before changing any task', async () => {
    await expect(reviewV2TasksBatch(client, [{ id: 'one', name: '任务一' }], 'rejected', ' ')).rejects.toThrow('整改原因');
    expect(loadV2TaskDetail).not.toHaveBeenCalled();
  });
});
