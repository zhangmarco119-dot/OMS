import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../types/database';
import { loadOperationLogActors, recordSystemActivity } from './operation-logs.service';

describe('operation logs service', () => {
  it('records a privacy-conscious access event with page context', async () => {
    window.history.replaceState({}, '', '/app/payroll?employee=profile-2');
    const rpc = vi.fn().mockResolvedValue({ data: 'log-1', error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;

    await recordSystemActivity(client, {
      context: { scope: 'single_store' },
      module: 'payroll',
      period: '2026-07',
      storeId: 'store-1',
      targetProfileId: 'profile-2',
      view: 'estimate_detail',
    });

    expect(rpc).toHaveBeenCalledWith('record_system_activity', expect.objectContaining({
      p_context: expect.objectContaining({ pagePath: '/app/payroll?employee=profile-2', scope: 'single_store' }),
      p_module: 'payroll',
      p_period: '2026-07',
      p_store_id: 'store-1',
      p_target_profile_id: 'profile-2',
      p_view: 'estimate_detail',
    }));
    expect(rpc.mock.calls[0][1].p_context).not.toHaveProperty('salary');
    expect(rpc.mock.calls[0][1].p_context).not.toHaveProperty('password');
  });

  it('normalizes the account selector result returned by the protected RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { display_name: '宋华威', employment_type: 'full_time', id: 'profile-1', role: 'admin', username: 'Admin' },
        { display_name: '李荣妹', employment_type: 'part_time', id: 'profile-2', role: 'staff', username: 'parttime' },
      ],
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient<Database>;

    await expect(loadOperationLogActors(client)).resolves.toEqual([
      { displayName: '宋华威', employmentType: 'full_time', id: 'profile-1', role: 'admin', username: 'Admin' },
      { displayName: '李荣妹', employmentType: 'part_time', id: 'profile-2', role: 'staff', username: 'parttime' },
    ]);
  });

  it('does not hide account-filter loading failures', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: '需要管理员权限' } }) } as unknown as SupabaseClient<Database>;
    await expect(loadOperationLogActors(client)).rejects.toThrow('需要管理员权限');
  });
});
