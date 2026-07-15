import { describe, expect, it } from 'vitest';

import { currentMonth, filterAttendanceDays, formatAttendanceTime, type AttendanceDay } from './model';

const day = (status: AttendanceDay['status']): AttendanceDay => ({
  id: status, date: '2026-07-15', timezone: 'Asia/Shanghai', shiftId: null, shiftName: null,
  plannedOnAt: null, plannedOffAt: null, actualOnAt: null, actualOffAt: null,
  onDutyResult: status, offDutyResult: status, status, isAttended: status === 'normal',
  lateMinutes: 0, earlyMinutes: 0, missingPunch: 'none', exceptionNote: null,
  lastSyncedAt: '2026-07-15T00:00:00Z', punches: [],
});

describe('attendance view model', () => {
  it('uses the enterprise timezone for month and time formatting', () => {
    expect(currentMonth(new Date('2026-07-31T16:30:00Z'))).toBe('2026-08');
    expect(formatAttendanceTime('2026-07-15T01:05:00Z')).toBe('09:05');
  });

  it('keeps only actionable exceptions in the exception filter', () => {
    expect(filterAttendanceDays([day('normal'), day('rest'), day('late'), day('missing')], 'exceptions').map((item) => item.status)).toEqual(['late', 'missing']);
  });
});
