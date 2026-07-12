import { describe, expect, it } from 'vitest';

import { parseV2Analytics } from './v2-analytics.service';

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
});
