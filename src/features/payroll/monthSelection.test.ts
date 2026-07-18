import { describe, expect, it } from 'vitest';

import { payrollMonthEndDate } from './monthSelection';

describe('payrollMonthEndDate', () => {
  it('uses today for the current month', () => {
    expect(payrollMonthEndDate('2026-07', '2026-07-18')).toBe('2026-07-18');
  });

  it('uses the real final day for historical months', () => {
    expect(payrollMonthEndDate('2024-02', '2026-07-18')).toBe('2024-02-29');
    expect(payrollMonthEndDate('2025-02', '2026-07-18')).toBe('2025-02-28');
  });
});
