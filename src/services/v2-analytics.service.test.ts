import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../types/database';
import { loadV2Analytics, parseV2Analytics } from './v2-analytics.service';

describe('v2 analytics parser', () => {
  it('uses safe defaults for an empty aggregate response', () => {
    expect(parseV2Analytics(null)).toMatchObject({
      arrival: { today: 0, trend: [] },
      inspection: { frequent_issues: [], issue_count: 0 },
      tasks: { completion_rate: 0, store_rates: [] },
      v1: { inventory_submissions: 0 },
    });
  });

  it('keeps server-provided aggregate values', () => {
    const parsed = parseV2Analytics({
      arrival: { today: 3, trend: [{ count: 2, date: '2026-07-12' }] },
      inspection: { frequent_issues: [{ count: 4, label: '地面清洁' }] },
      tasks: { completion_rate: 88.5, store_rates: [{ approved: 8, rate: 80, store_id: 'store-1', store_name: '门店 A', total: 10 }] },
      v1: { order_submissions: 6 },
    });
    expect(parsed).toMatchObject({
      arrival: { today: 3, trend: [{ count: 2, date: '2026-07-12' }] },
      inspection: { frequent_issues: [{ count: 4, label: '地面清洁' }] },
      tasks: { completion_rate: 88.5, store_rates: [{ rate: 80, total: 10 }] },
      v1: { order_submissions: 6 },
    });
  });

  it('requests analytics with the selected date range', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { arrival: { today: 1 } }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await loadV2Analytics(client, { dateFrom: '2026-07-01', dateTo: '2026-07-13' });
    expect(rpc).toHaveBeenCalledWith('admin_v2_analytics', { p_end_date: '2026-07-13', p_start_date: '2026-07-01' });
  });
});
