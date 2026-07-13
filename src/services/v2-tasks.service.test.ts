import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../types/database';
import { createV2TaskSchedule, deleteV2TaskImage, publishV2Tasks, reviewV2Task, type V2TaskImageRow } from './v2-tasks.service';

describe('V2 task workflow service', () => {
  it('publishes immutable template tasks through RPC', async () => {
    const rpc=vi.fn().mockResolvedValue({data:[],error:null});const client={rpc} as unknown as SupabaseClient<Database>;
    await publishV2Tasks(client,'template-1',['store-1'],'2026-07-20T12:00:00Z');
    expect(rpc).toHaveBeenCalledWith('publish_v2_tasks',{p_due_at:'2026-07-20T12:00:00Z',p_store_ids:['store-1'],p_template_id:'template-1'});
  });
  it('lets the server derive the next recurring deadline', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null }); const client = { rpc } as unknown as SupabaseClient<Database>;
    await publishV2Tasks(client, 'template-1', ['store-1'], null);
    expect(rpc).toHaveBeenCalledWith('publish_v2_tasks', { p_due_at: null, p_store_ids: ['store-1'], p_template_id: 'template-1' });
  });
  it('creates a recurring task schedule through the guarded RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null }); const client = { rpc } as unknown as SupabaseClient<Database>;
    await createV2TaskSchedule(client, { firstDueAt: '2026-07-20T12:00:00Z', intervalDays: null, monthDay: null, scheduleType: 'weekly', storeIds: ['store-1'], templateId: 'template-1', weekdays: [1, 5] });
    expect(rpc).toHaveBeenCalledWith('create_v2_task_schedule', { p_first_due_at: '2026-07-20T12:00:00Z', p_interval_days: null, p_month_day: null, p_schedule_type: 'weekly', p_store_ids: ['store-1'], p_template_id: 'template-1', p_weekdays: [1, 5] });
  });
  it('requires review action through RPC',async()=>{const rpc=vi.fn().mockResolvedValue({data:{},error:null});const client={rpc} as unknown as SupabaseClient<Database>;await reviewV2Task(client,'task-1','rejected','重新拍照',['item-1']);expect(rpc).toHaveBeenCalledWith('review_v2_task',{p_action:'rejected',p_correction_item_ids:['item-1'],p_note:'重新拍照',p_task_id:'task-1'});});
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
