import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../types/database';
import { markAdminArrivalViewed, voidAdminArrival } from './admin-arrivals.service';

describe('admin arrivals service mutations', () => {
  it('marks a report viewed through the protected RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'viewed' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await markAdminArrivalViewed(client, 'report-1');
    expect(rpc).toHaveBeenCalledWith('mark_arrival_viewed', { p_report_id: 'report-1' });
  });

  it('requires a reason and trims it before voiding', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'voided' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await expect(voidAdminArrival(client, 'report-1', '   ')).rejects.toThrow('请填写作废原因');
    await voidAdminArrival(client, 'report-1', '  重复上报  ');
    expect(rpc).toHaveBeenCalledWith('void_arrival_report', { p_reason: '重复上报', p_report_id: 'report-1' });
  });
});
