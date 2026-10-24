import { describe, expect, it } from 'vitest';
import type { ArrivalDetailRow } from '../../services/admin-arrivals.service';
import { formatArrivalDateTime, groupArrivalProducts, summarizeArrivalDetails } from './arrivalProductStatistics';

const row = (patch: Partial<ArrivalDetailRow>) => ({ product_name_snapshot: '原味酸奶', unit: '箱', store_id: 'store-1', store_name_snapshot: '门店一', report_id: 'r1', arrival_date: '2026-10-01', arrival_time: '10:30:00', quantity: 1, item_id: 'i1', ...patch } as ArrivalDetailRow);
describe('single-product arrival statistics', () => {
  it('totals the same product across dates/stores, separates units and other products, and orders events newest first', () => {
    const groups = groupArrivalProducts([
      row({ quantity: 0.1 }), row({ quantity: 0.2, item_id: 'i2' }),
      row({ quantity: 2, store_id: 'store-2', product_id: 'another-store-product', arrival_date: '2026-10-03', item_id: 'i3', report_id: 'r2' }),
      row({ unit: '杯', quantity: 12 }), row({ product_name_snapshot: '蓝莓酸奶', quantity: 8 }),
    ]);
    expect(groups).toHaveLength(3);
    const yogurt = groups.find(g => g.name === '原味酸奶' && g.unit === '箱')!;
    expect(yogurt.totalQuantity).toBe(2.3);
    expect(yogurt.reportCount).toBe(2);
    expect(yogurt.rows.map(r => r.item_id)).toEqual(['i3', 'i1', 'i2']);
    expect(summarizeArrivalDetails(yogurt.rows).map(p => p.total_quantity).sort()).toEqual([0.3, 2]);
  });
  it('shows the arrival date rather than the submission date and does not invent missing times', () => {
    expect(formatArrivalDateTime(row({ submitted_at: '2026-10-05T00:00:00Z' }))).toBe('2026-10-01 10:30');
    expect(formatArrivalDateTime(row({ arrival_time: null }))).toBe('2026-10-01 时间未填写');
  });
});
