import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../types/database';
import { createV2TaskSchedule, deleteV2TaskImage, getV2TaskAnswerPositions, orderV2TaskAnswers, publishV2Tasks, reviewV2Task, reviewV2TaskItems, type V2TaskAnswerRow, type V2TaskImageRow } from './v2-tasks.service';

describe('V2 task workflow service', () => {
  it('publishes immutable template tasks through RPC', async () => {
    const rpc=vi.fn().mockResolvedValue({data:[],error:null});const client={rpc} as unknown as SupabaseClient<Database>;
    await publishV2Tasks(client,'template-1',['store-1'],'2026-07-20T12:00:00Z');
    expect(rpc).toHaveBeenCalledWith('publish_v2_tasks',{p_due_at:'2026-07-20T12:00:00Z',p_profile_ids:[],p_store_ids:['store-1'],p_template_id:'template-1'});
  });
  it('lets the server derive the next recurring deadline', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null }); const client = { rpc } as unknown as SupabaseClient<Database>;
    await publishV2Tasks(client, 'template-1', ['store-1'], null);
    expect(rpc).toHaveBeenCalledWith('publish_v2_tasks', { p_due_at: null, p_profile_ids: [], p_store_ids: ['store-1'], p_template_id: 'template-1' });
  });
  it('creates a recurring task schedule through the guarded RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null }); const client = { rpc } as unknown as SupabaseClient<Database>;
    await createV2TaskSchedule(client, { firstDueAt: '2026-07-20T12:00:00Z', intervalDays: null, monthDay: null, scheduleType: 'weekly', storeIds: ['store-1'], templateId: 'template-1', weekdays: [1, 5] });
    expect(rpc).toHaveBeenCalledWith('create_v2_task_schedule', { p_first_due_at: '2026-07-20T12:00:00Z', p_interval_days: null, p_month_day: null, p_profile_ids: [], p_schedule_type: 'weekly', p_store_ids: ['store-1'], p_template_id: 'template-1', p_weekdays: [1, 5] });
  });
  it('publishes a task only to the selected employee', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null }); const client = { rpc } as unknown as SupabaseClient<Database>;
    await publishV2Tasks(client, 'template-1', ['store-1'], '2026-07-20T12:00:00Z', ['profile-1']);
    expect(rpc).toHaveBeenCalledWith('publish_v2_tasks', expect.objectContaining({ p_profile_ids: ['profile-1'] }));
  });
  it('requires review action through RPC',async()=>{const rpc=vi.fn().mockResolvedValue({data:{},error:null});const client={rpc} as unknown as SupabaseClient<Database>;await reviewV2Task(client,'task-1','rejected','重新拍照',['item-1']);expect(rpc).toHaveBeenCalledWith('review_v2_task',{p_action:'rejected',p_correction_item_ids:['item-1'],p_note:'重新拍照',p_task_id:'task-1'});});
  it('submits per-item review decisions through the guarded RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await reviewV2TaskItems(client, 'task-1', [
      { decision: 'approved', itemId: 'item-1' },
      { decision: 'rejected', itemId: 'item-2' },
    ], '第二项需要整改');
    expect(rpc).toHaveBeenCalledWith('review_v2_task_items', {
      p_decisions: [
        { decision: 'approved', item_id: 'item-1' },
        { decision: 'rejected', item_id: 'item-2' },
      ],
      p_note: '第二项需要整改',
      p_task_id: 'task-1',
    });
  });
  it('derives stable group and item numbers and orders answers from the published snapshot', () => {
    const snapshot = {
      groups: [
        { id: 'group-2', sort_order: 1, title: '后场', items: [{ id: 'item-3', sort_order: 0 }] },
        { id: 'group-1', sort_order: 0, title: '前场', items: [{ id: 'item-2', sort_order: 1 }, { id: 'item-1', sort_order: 0 }] },
      ],
    };
    const answers = [
      { id: 'answer-3', item_id: 'item-3' },
      { id: 'answer-2', item_id: 'item-2' },
      { id: 'answer-1', item_id: 'item-1' },
    ] as V2TaskAnswerRow[];
    expect(getV2TaskAnswerPositions(snapshot)).toEqual({
      'item-1': { groupNumber: 1, groupTitle: '前场', itemNumber: 1, number: '1.1' },
      'item-2': { groupNumber: 1, groupTitle: '前场', itemNumber: 2, number: '1.2' },
      'item-3': { groupNumber: 2, groupTitle: '后场', itemNumber: 1, number: '2.1' },
    });
    expect(orderV2TaskAnswers(snapshot, answers).map((answer) => answer.item_id)).toEqual(['item-1', 'item-2', 'item-3']);
  });
  it('deletes task image metadata and its private storage object', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const fromTable = vi.fn().mockReturnValue({ delete: () => ({ eq }) });
    const fromBucket = vi.fn().mockReturnValue({ remove });
    const client = { from: fromTable, storage: { from: fromBucket } } as unknown as SupabaseClient<Database>;
    const image = { bucket: 'v2-task-images', id: 'image-1', object_path: 'store/task/item/image.jpg' } as V2TaskImageRow;

    await expect(deleteV2TaskImage(client, image)).resolves.toEqual({ storageCleanupFailed: false });

    expect(fromTable).toHaveBeenCalledWith('v2_task_images');
    expect(eq).toHaveBeenCalledWith('id', 'image-1');
    expect(fromBucket).toHaveBeenCalledWith('v2-task-images');
    expect(remove).toHaveBeenCalledWith(['store/task/item/image.jpg']);
  });
});
