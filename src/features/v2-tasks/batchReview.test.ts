import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../types/database';
import { reviewV2TasksBatch } from './batchReview';

const targets = [{ id: 'one', name: '任务一' }, { id: 'two', name: '关联点货任务' }];
const clientWith = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient<Database>;

describe('server batch task review', () => {
  it('uses one request for the entire batch and preserves per-task failures', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: 'two', success: true }, { id: 'one', success: false, reason: '任务已处理' }], error: null });
    const result = await reviewV2TasksBatch(clientWith(rpc), targets, 'approved', '');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('review_v2_tasks_batch', { p_task_ids: ['one', 'two'], p_action: 'approved', p_note: '' });
    expect(result).toEqual({ succeeded: [targets[1]], failed: [{ ...targets[0], reason: '任务已处理' }] });
  });

  it('submits rejection notes and removes duplicate selections', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: 'one', success: true }, { id: 'two', success: true }], error: null });
    await reviewV2TasksBatch(clientWith(rpc), [...targets, targets[0]], 'rejected', '  重新核对  ');
    expect(rpc).toHaveBeenCalledWith('review_v2_tasks_batch', { p_task_ids: ['one', 'two'], p_action: 'rejected', p_note: '重新核对' });
  });

  it('requires a rejection reason before sending any request', async () => {
    const rpc = vi.fn();
    await expect(reviewV2TasksBatch(clientWith(rpc), targets, 'rejected', ' ')).rejects.toThrow('整改原因');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not report success when the response is missing or a request fails', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ error: { message: '网络中断' } });
    expect((await reviewV2TasksBatch(clientWith(rpc), targets, 'approved', '')).failed).toHaveLength(2);
    await expect(reviewV2TasksBatch(clientWith(rpc), targets, 'approved', '')).rejects.toThrow('网络中断');
  });
});
