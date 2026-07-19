import { describe, expect, it } from 'vitest';

import { groupContiguousDates, selectIncrementalDates } from './incremental-plan';

describe('attendance incremental plan', () => {
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
});
