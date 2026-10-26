import { describe, expect, it } from 'vitest';

import { eachDate, groupContiguousDates, limitScheduledDates, scheduledAttendanceStart, selectIncrementalDates, selectUncoveredBindingDates, shouldForceRequestedRange } from './incremental-plan';

describe('attendance incremental plan', () => {
  it('bounds a two-month backlog while prioritizing the current and most recent missing days', () => {
    expect(limitScheduledDates(eachDate('2026-09-01', '2026-10-26'), '2026-10-26'))
      .toEqual(eachDate('2026-10-20', '2026-10-26'));
    expect(limitScheduledDates(['2026-10-26', '2026-10-26', '2026-09-01'], '2026-10-26'))
      .toEqual(['2026-09-01', '2026-10-26']);
  });

  it('does not repeatedly backfill a successfully fetched day without a schedule', () => {
    const attemptedDays = [{ attendanceDate: '2026-10-18', profileId: 'employee' }];
    expect(selectUncoveredBindingDates('2026-10-18', '2026-10-19', ['employee'], attemptedDays))
      .toEqual(['2026-10-19']);
  });
  it('only fetches missing dates, today, and a not-yet-finalized yesterday', () => {
    const states = [
      { syncDate: '2026-07-01', lastSyncedAt: '2026-07-01T10:00:00Z' },
      { syncDate: '2026-07-02', lastSyncedAt: '2026-07-19T02:00:00Z' },
      { syncDate: '2026-07-18', lastSyncedAt: '2026-07-18T10:00:00Z' },
      { syncDate: '2026-07-19', lastSyncedAt: '2026-07-19T02:00:00Z' },
    ];
    expect(selectIncrementalDates('2026-07-01', '2026-07-19', '2026-07-19', states)).toEqual([
      '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09',
      '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16',
      '2026-07-17', '2026-07-18', '2026-07-19',
    ]);
  });

  it('groups only adjacent requested dates into seven-day API windows', () => {
    expect(groupContiguousDates(['2026-07-01', '2026-07-02', '2026-07-05', '2026-07-06'])).toEqual([
      { startDate: '2026-07-01', endDate: '2026-07-02' },
      { startDate: '2026-07-05', endDate: '2026-07-06' },
    ]);
  });

  it('rechecks an already-synced historical date when the database still marks it abnormal', () => {
    const states = [
      { syncDate: '2026-07-05', lastSyncedAt: '2026-07-05T12:00:00Z' },
      { syncDate: '2026-07-19', lastSyncedAt: '2026-07-19T02:00:00Z' },
    ];
    expect(selectIncrementalDates('2026-07-05', '2026-07-19', '2026-07-19', states, ['2026-07-05']))
      .toContain('2026-07-05');
  });

  it('keeps today in every incremental plan even when it was synchronized moments ago', () => {
    const states = [{ syncDate: '2026-07-19', lastSyncedAt: '2026-07-19T13:59:30Z' }];
    expect(selectIncrementalDates('2026-07-01', '2026-07-19', '2026-07-19', states))
      .toEqual([
        '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06',
        '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12',
        '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18',
        '2026-07-19',
      ]);
  });

  it('forces the requested range for a single employee so a new binding receives historical attendance', () => {
    expect(shouldForceRequestedRange('sync', 'profile-1')).toBe(true);
    expect(shouldForceRequestedRange('retry-job', null)).toBe(true);
    expect(shouldForceRequestedRange('sync', null)).toBe(true);
    expect(shouldForceRequestedRange('scheduled-sync', null)).toBe(false);
  });

  it('keeps September corrections in the October schedule and handles year boundaries', () => {
    expect(scheduledAttendanceStart('2026-10-14')).toBe('2026-09-01');
    expect(scheduledAttendanceStart('2027-01-01')).toBe('2026-12-01');
    const states = [{ syncDate: '2026-09-26', lastSyncedAt: '2026-09-30T15:00:21Z' }];
    expect(selectIncrementalDates(scheduledAttendanceStart('2026-10-14'), '2026-10-14', '2026-10-14', states, ['2026-09-26'])).toContain('2026-09-26');
  });

  it('backfills dates that are covered for existing employees but missing for a newly bound employee', () => {
    expect(selectUncoveredBindingDates('2026-08-01', '2026-08-03', ['existing', 'new'], [
      { attendanceDate: '2026-08-01', profileId: 'existing' },
      { attendanceDate: '2026-08-02', profileId: 'existing' },
      { attendanceDate: '2026-08-03', profileId: 'existing' },
      { attendanceDate: '2026-08-03', profileId: 'new' },
    ])).toEqual(['2026-08-01', '2026-08-02']);
  });
});
