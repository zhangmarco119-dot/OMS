import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../types/database';
import { createV2TaskSchedule, deleteV2TaskImage, getV2TaskAnswerPositions, orderV2TaskAnswers, publishV2Tasks, reviewV2Task, reviewV2TaskItems, updateV2TaskContent, updateV2TaskScheduleAll, type V2TaskAnswerRow, type V2TaskImageRow } from './v2-tasks.service';

describe('V2 task workflow service', () => {
  it('publishes immutable template tasks through RPC', async () => {
    const rpc=vi.fn().mockResolvedValue({data:[],error:null});const client={rpc} as unknown as SupabaseClient<Database>;
    await publishV2Tasks(client,'template-1',['store-1'],'2026-07-20T12:00:00Z','2026-07-20T09:00:00Z');
    expect(rpc).toHaveBeenCalledWith('publish_v2_tasks_v2',{p_due_at:'2026-07-20T12:00:00Z',p_manager_review_enabled:false,p_profile_ids:[],p_publish_at:'2026-07-20T09:00:00Z',p_store_ids:['store-1'],p_target_audiences:['staff','manager'],p_template_id:'template-1'});
  });
  it('supports scheduled one-off publication', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null }); const client = { rpc } as unknown as SupabaseClient<Database>;
    await publishV2Tasks(client, 'template-1', ['store-1'], '2026-07-21T12:00:00Z', '2026-07-20T12:00:00Z');
    expect(rpc).toHaveBeenCalledWith('publish_v2_tasks_v2', expect.objectContaining({ p_publish_at: '2026-07-20T12:00:00Z' }));
  });
  it('creates a recurring task schedule through the guarded RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null }); const client = { rpc } as unknown as SupabaseClient<Database>;
    await createV2TaskSchedule(client, { acceptanceIntervalDays: null, acceptanceMonthDay: null, acceptanceTime: '20:00', acceptanceType: 'weekly', acceptanceWeekday: 5, intervalDays: null, managerReviewEnabled: true, monthDay: null, nextPublishAt: '2026-07-20T09:00:00Z', publishTime: '09:00', scheduleType: 'weekly', storeIds: ['store-1'], templateId: 'template-1', weekdays: [1, 5] });
    expect(rpc).toHaveBeenCalledWith('create_v2_task_schedule_v2', { p_fields: { acceptanceIntervalDays: null, acceptanceMonthDay: null, acceptanceTime: '20:00', acceptanceType: 'weekly', acceptanceWeekday: 5, intervalDays: null, managerReviewEnabled: true, monthDay: null, nextPublishAt: '2026-07-20T09:00:00Z', publishImmediately: false, publishTime: '09:00', scheduleType: 'weekly', targetAudiences: ['staff', 'manager'], weekdays: [1, 5] }, p_profile_ids: [], p_store_ids: ['store-1'], p_template_id: 'template-1' });
  });
  it('publishes a task only to the selected employee', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null }); const client = { rpc } as unknown as SupabaseClient<Database>;
    await publishV2Tasks(client, 'template-1', ['store-1'], '2026-07-20T12:00:00Z', '2026-07-20T09:00:00Z', ['profile-1']);
    expect(rpc).toHaveBeenCalledWith('publish_v2_tasks_v2', expect.objectContaining({ p_profile_ids: ['profile-1'] }));
  });
  it('lets administrators opt part-time employees into a store-wide task', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null }); const client = { rpc } as unknown as SupabaseClient<Database>;
    await publishV2Tasks(client, 'template-1', ['store-1'], '2026-07-20T12:00:00Z', '2026-07-20T09:00:00Z', [], ['staff', 'part_time']);
    expect(rpc).toHaveBeenCalledWith('publish_v2_tasks_v2', expect.objectContaining({ p_target_audiences: ['staff', 'part_time'] }));
  });
  it('updates a single published task through the guarded RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null }); const client = { rpc } as unknown as SupabaseClient<Database>;
    await updateV2TaskContent(client, 'task-1', '更新后任务', { groups: [] }, '2026-07-20T12:00:00Z', true);
    expect(rpc).toHaveBeenCalledWith('update_v2_task_content_v2', { p_due_at: '2026-07-20T12:00:00Z', p_manager_review_enabled: true, p_name: '更新后任务', p_snapshot: { groups: [] }, p_task_id: 'task-1' });
  });
  it('updates recurring rules and task content atomically', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null }); const client = { rpc } as unknown as SupabaseClient<Database>;
    const fields = { acceptanceIntervalDays: 0, acceptanceMonthDay: null, acceptanceTime: '20:00', acceptanceType: 'daily' as const, acceptanceWeekday: null, intervalDays: 7, managerReviewEnabled: false, monthDay: null, nextPublishAt: '2026-07-20T09:00:00Z', publishTime: '09:00', scheduleType: 'interval_days' as const, weekdays: [] };
    await updateV2TaskScheduleAll(client, 'schedule-1', fields, '更新后周期任务', { groups: [] });
    expect(rpc).toHaveBeenCalledWith('update_v2_task_schedule_all', { p_fields: fields, p_name: '更新后周期任务', p_schedule_id: 'schedule-1', p_snapshot: { groups: [] } });
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
