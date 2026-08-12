import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../types/database';
import { compactConsecutiveOperationLogs, loadOperationLogActors, recordSystemActivity, type OperationLog } from './operation-logs.service';

describe('operation logs service', () => {
  it('collapses only consecutive duplicate actions and keeps their repeat count', () => {
    const row = { actor_id: 'profile-1', entity_id: 'item-1', entity_type: 'notice', id: 'log-1', metadata: {}, module: 'notice', occurred_at: '2026-08-13T01:00:00Z', operation: 'updated', repeatCount: 1, summary: '修改公告' } as OperationLog;
    const other = { ...row, entity_id: 'item-2', id: 'log-2', summary: '发布公告' };
    expect(compactConsecutiveOperationLogs([row, { ...row, id: 'log-1b' }, other, { ...row, id: 'log-1c' }])).toEqual([
      expect.objectContaining({ id: 'log-1', repeatCount: 2 }),
      expect.objectContaining({ id: 'log-2', repeatCount: 1 }),
      expect.objectContaining({ id: 'log-1c', repeatCount: 1 }),
    ]);
  });

  it('records a privacy-conscious access event with page context', async () => {
    window.history.replaceState({}, '', '/app/payroll?employee=profile-2');
    const rpc = vi.fn().mockResolvedValue({ data: 'log-1', error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;

    await expect(recordSystemActivity(client, {
      context: { scope: 'single_store' },
      module: 'payroll',
      period: '2026-07',
      storeId: 'store-1',
      targetProfileId: 'profile-2',
      view: 'estimate_detail',
    })).resolves.toBe(true);

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

  it('retries one failed audit write instead of silently discarding it', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'temporary network error' } })
      .mockResolvedValueOnce({ data: 'log-2', error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;

    await expect(recordSystemActivity(client, { module: 'attendance', period: '2026-07', view: 'month_summary' })).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('returns a visible failure result after both audit attempts fail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    const client = { rpc } as unknown as SupabaseClient<Database>;

    await expect(recordSystemActivity(client, { module: 'payroll', view: 'estimate_summary' })).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('StoreHub activity log was not recorded:', 'permission denied');
    warn.mockRestore();
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
