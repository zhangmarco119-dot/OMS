import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../types/database';
import { formatArrivalItemSummary, loadAdminArrivalList, markAdminArrivalViewed, voidAdminArrival } from './admin-arrivals.service';

describe('admin arrivals service mutations', () => {
  it('formats list headlines with product names and quantities instead of a kind count', () => {
    expect(formatArrivalItemSummary([
      { product_name_snapshot: '淡奶油', quantity: 1, unit: '盒' },
      { product_name_snapshot: '淡奶油', quantity: 2, unit: '盒' },
      { product_name_snapshot: '牛奶', quantity: 1.5, unit: '箱' },
    ])).toEqual({ count: 2, text: '淡奶油到货3盒、牛奶到货1.5箱' });
  });

  it('marks a report viewed through the protected RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'viewed' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await markAdminArrivalViewed(client, 'report-1');
    expect(rpc).toHaveBeenCalledWith('mark_arrival_viewed', { p_report_id: 'report-1' });
  });

  it('uses only submitted and viewed reports for the default Arrival Center list', async () => {
    const query = {
      eq: vi.fn(),
      gte: vi.fn(),
      in: vi.fn(),
      lte: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
      select: vi.fn(),
      then: (resolve: (value: { count: number; data: never[]; error: null }) => unknown) =>
        Promise.resolve({ count: 0, data: [], error: null }).then(resolve),
    };
    for (const method of ['eq', 'gte', 'in', 'lte', 'order', 'range', 'select'] as const) {
      query[method].mockReturnValue(query);
    }
    const client = { from: vi.fn().mockReturnValue(query) } as unknown as SupabaseClient<Database>;

    await loadAdminArrivalList(client, {
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      page: 1,
      status: 'all',
      storeId: '',
    });

    expect(query.in).toHaveBeenCalledWith('status', ['submitted', 'viewed']);
  });

  it('requires a reason and trims it before voiding', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'voided' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await expect(voidAdminArrival(client, 'report-1', '   ')).rejects.toThrow('请填写作废原因');
    await voidAdminArrival(client, 'report-1', '  重复上报  ');
    expect(rpc).toHaveBeenCalledWith('void_arrival_report', { p_reason: '重复上报', p_report_id: 'report-1' });
  });
});
