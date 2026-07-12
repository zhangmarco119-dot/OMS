import { describe, expect, it } from 'vitest';

import { formatRecurringDeadline, nextRecurringDueAt } from './recurrence';

describe('task recurrence', () => {
  it('formats weekly and monthly completion deadlines in Chinese', () => {
    expect(formatRecurringDeadline('weekly', 1, '20:00:00')).toBe('每周周一 20:00 前完成');
    expect(formatRecurringDeadline('monthly', 31, '18:30:00')).toBe('每月31日 18:30 前完成');
  });

  it('calculates the following weekly completion time', () => {
    expect(nextRecurringDueAt('weekly', 1, '20:00', new Date('2026-07-12T13:00:00+08:00'))).toBe('2026-07-13T12:00:00.000Z');
  });
});
