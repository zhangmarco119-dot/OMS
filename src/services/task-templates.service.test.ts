import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { createEmptyTaskTemplate } from '../features/task-templates/templateForm';
import type { Database } from '../types/database';
import { publishTaskTemplate, saveTaskTemplate } from './task-templates.service';

const storeId = '00000000-0000-4000-8000-000000000001';

describe('task templates service', () => {
  it('serializes grouped items through the protected save RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'template-1' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    const draft = createEmptyTaskTemplate([storeId]);
    draft.name = '每周闭店清洁';
    draft.groups[0].title = '操作间';
    draft.groups[0].items[0].label = '确认操作台已消毒';
    await saveTaskTemplate(client, draft);
    expect(rpc).toHaveBeenCalledWith('save_v2_task_template', expect.objectContaining({
      p_store_ids: [storeId],
      p_template_id: null,
      p_groups: [expect.objectContaining({ items: [expect.objectContaining({ field_type: 'confirmation' })] })],
    }));
  });

  it('publishes a version through the database RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { version: 1 }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await publishTaskTemplate(client, '00000000-0000-4000-8000-000000000099');
    expect(rpc).toHaveBeenCalledWith('publish_v2_task_template', {
      p_template_id: '00000000-0000-4000-8000-000000000099',
    });
  });
});
