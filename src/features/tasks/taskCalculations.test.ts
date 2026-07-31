import { describe, expect, it } from 'vitest';

import { findNextPendingIndex, getCompletionStats, normalizeQuantityInput } from './taskCalculations';

const item = (
  quantity: number | null,
  status: 'pending' | 'completed' | 'no_order_needed' = 'pending',
  productActionStatus: 'deletion_requested' | 'deletion_approved' | 'deletion_ignored' | null = null,
) => ({
  product_action_status: productActionStatus,
  quantity,
  status,
});

describe('task calculations', () => {
  it('distinguishes empty quantity from explicit zero', () => {
    expect(normalizeQuantityInput('')).toBeNull();
    expect(normalizeQuantityInput('0')).toBe(0);
  });

  it('rejects negative and over-precise quantities', () => {
    expect(() => normalizeQuantityInput('-1')).toThrow('非负');
    expect(() => normalizeQuantityInput('1.234')).toThrow('两位小数');
  });

  it('counts explicit zero, completed items, and deletion operations as processed', () => {
    expect(getCompletionStats([
      item(null),
      item(0),
      item(2),
      item(null, 'no_order_needed'),
      item(null, 'completed'),
      item(null, 'pending', 'deletion_requested'),
      item(null, 'pending', 'deletion_approved'),
    ])).toEqual({
      total: 7,
      processed: 6,
      pending: 1,
      percent: 86,
    });
  });

  it('keeps a rejected deletion request pending until a quantity is entered', () => {
    expect(getCompletionStats([item(null, 'pending', 'deletion_ignored')])).toEqual({
      total: 1,
      processed: 0,
      pending: 1,
      percent: 0,
    });
  });

  it('finds next pending item with wraparound', () => {
    expect(findNextPendingIndex([item(1), item(null), item(2)], 1)).toBe(1);
    expect(findNextPendingIndex([item(1), item(null), item(2)], 2)).toBe(1);
    expect(findNextPendingIndex([item(1), item(0)], 0)).toBe(-1);
  });
});
