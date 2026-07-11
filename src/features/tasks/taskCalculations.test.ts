import { describe, expect, it } from 'vitest';

import { findNextPendingIndex, getCompletionStats, normalizeQuantityInput } from './taskCalculations';

const item = (quantity: number | null, status: 'pending' | 'completed' | 'no_order_needed' = 'pending') => ({
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

  it('counts a deletion-request item as completed even without a quantity', () => {
    expect(getCompletionStats([item(null), item(0), item(2), item(null, 'no_order_needed'), item(null, 'completed')])).toEqual({
      total: 5,
      processed: 4,
      pending: 1,
      percent: 80,
    });
  });

  it('finds next pending item with wraparound', () => {
    expect(findNextPendingIndex([item(1), item(null), item(2)], 1)).toBe(1);
    expect(findNextPendingIndex([item(1), item(null), item(2)], 2)).toBe(1);
    expect(findNextPendingIndex([item(1), item(0)], 0)).toBe(-1);
  });
});
