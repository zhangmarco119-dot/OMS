import { describe, expect, it } from 'vitest';

import { arrivalPeriodLabel, createDefaultArrivalPeriod, resolveArrivalPeriod } from './arrivalPeriod';

describe('arrival period', () => {
  it('defaults to the current day', () => {
    const period = createDefaultArrivalPeriod('2026-07-20');
    expect(period).toMatchObject({ day: '2026-07-20', mode: 'day', month: '2026-07' });
    expect(resolveArrivalPeriod(period)).toEqual({ dateFrom: '2026-07-20', dateTo: '2026-07-20' });
  });

  it('converts a selected month into its full date range', () => {
    const period = { ...createDefaultArrivalPeriod('2026-07-20'), mode: 'month' as const, month: '2024-02' };
    expect(resolveArrivalPeriod(period)).toEqual({ dateFrom: '2024-02-01', dateTo: '2024-02-29' });
    expect(arrivalPeriodLabel(period)).toBe('2024-02');
  });

  it('uses and validates an explicit date range', () => {
    const period = { ...createDefaultArrivalPeriod('2026-07-20'), dateFrom: '2026-07-01', dateTo: '2026-07-15', mode: 'range' as const };
    expect(resolveArrivalPeriod(period)).toEqual({ dateFrom: '2026-07-01', dateTo: '2026-07-15' });
    expect(() => resolveArrivalPeriod({ ...period, dateFrom: '2026-07-16' })).toThrow('开始日期不能晚于结束日期');
  });
});
