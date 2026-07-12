import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../types/database';
import { publishV2Tasks, reviewV2Task } from './v2-tasks.service';

describe('V2 task workflow service', () => {
  it('publishes immutable template tasks through RPC', async () => {
    const rpc=vi.fn().mockResolvedValue({data:[],error:null});const client={rpc} as unknown as SupabaseClient<Database>;
    await publishV2Tasks(client,'template-1',['store-1'],'2026-07-20T12:00:00Z');
    expect(rpc).toHaveBeenCalledWith('publish_v2_tasks',{p_due_at:'2026-07-20T12:00:00Z',p_store_ids:['store-1'],p_template_id:'template-1'});
  });
  it('requires review action through RPC',async()=>{const rpc=vi.fn().mockResolvedValue({data:{},error:null});const client={rpc} as unknown as SupabaseClient<Database>;await reviewV2Task(client,'task-1','rejected','重新拍照',['item-1']);expect(rpc).toHaveBeenCalledWith('review_v2_task',{p_action:'rejected',p_correction_item_ids:['item-1'],p_note:'重新拍照',p_task_id:'task-1'});});
});
