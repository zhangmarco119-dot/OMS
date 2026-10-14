import { describe, expect, it } from 'vitest';

import { normalizeAttendanceBundle, normalizeDutyResult } from './attendance-normalizer';

const binding = { corpId: 'ding-test', dingtalkUserId: 'user-1', profileId: 'profile-1', storeId: 'store-1' };

describe('DingTalk attendance normalization', () => {
  it('does not count a NotSigned placeholder time as an actual punch', () => {
    const [day] = normalizeAttendanceBundle(binding, {
      results: [
        { userId: 'user-1', workDate: '2026-09-26', checkType: 'OnDuty', userCheckTime: '2026-09-26 08:50:38', baseCheckTime: '2026-09-26 09:00:00', timeResult: 'Normal' },
        { userId: 'user-1', workDate: '2026-09-26', checkType: 'OffDuty', userCheckTime: '2026-09-26 19:00:00', baseCheckTime: '2026-09-26 19:00:00', timeResult: 'NotSigned' },
      ], punches: [], schedules: [],
    }, new Date('2026-10-14T00:00:00Z'));
    expect(day).toMatchObject({ actualOffAt: null, offDutyResult: 'missing', missingPunch: 'off', dailyStatus: 'missing', isAttended: false });
  });

  it.each(['OnDuty', 'OffDuty'])('uses approved %s corrections even if the result endpoint is still missing', (checkType) => {
    const [day] = normalizeAttendanceBundle(binding, {
      results: ['OnDuty', 'OffDuty'].map((type) => ({
        userId: 'user-1', workDate: '2026-09-25', checkType: type,
        userCheckTime: `2026-09-25 ${type === 'OnDuty' ? '09:40:00' : '19:40:00'}`,
        baseCheckTime: `2026-09-25 ${type === 'OnDuty' ? '09:40:00' : '19:40:00'}`,
        timeResult: type === checkType ? 'NotSigned' : 'Normal',
      })),
      punches: [{ id: 'approved', userId: 'user-1', checkType, sourceType: 'APPROVE', userCheckTime: `2026-09-25 ${checkType === 'OnDuty' ? '09:39:00' : '19:41:00'}` }],
      schedules: [],
    }, new Date('2026-10-14T00:00:00Z'));
    expect(day).toMatchObject({ onDutyResult: 'normal', offDutyResult: 'normal', missingPunch: 'none', dailyStatus: 'normal', isAttended: true });
    expect(checkType === 'OnDuty' ? day.actualOnAt : day.actualOffAt).toBe(checkType === 'OnDuty' ? '2026-09-25T01:39:00.000Z' : '2026-09-25T11:41:00.000Z');
  });
  it('keeps multiple punches in one day and counts a late shift once', () => {
    const days = normalizeAttendanceBundle(binding, {
      results: [
        { id: 'result-on', userId: 'user-1', workDate: '2026-07-01', checkType: 'OnDuty', baseCheckTime: '2026-07-01 09:00:00+08:00', userCheckTime: '2026-07-01 09:12:00+08:00', timeResult: 'Late', lateMinutes: 12 },
        { id: 'result-off', userId: 'user-1', workDate: '2026-07-01', checkType: 'OffDuty', baseCheckTime: '2026-07-01 18:00:00+08:00', userCheckTime: '2026-07-01 18:05:00+08:00', timeResult: 'Normal' },
      ],
      punches: [
        { id: 'p1', userId: 'user-1', userCheckTime: '2026-07-01 09:12:00+08:00', checkType: 'OnDuty' },
        { id: 'p2', userId: 'user-1', userCheckTime: '2026-07-01 12:00:00+08:00', checkType: 'Unknown' },
        { id: 'p3', userId: 'user-1', userCheckTime: '2026-07-01 18:05:00+08:00', checkType: 'OffDuty' },
      ],
      schedules: [{ userId: 'user-1', workDate: '2026-07-01', classId: 'shift-1', className: '早班' }],
    });
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ attendanceDate: '2026-07-01', dailyStatus: 'late', isAttended: true, lateMinutes: 12, missingPunch: 'none' });
    expect(days[0].punches).toHaveLength(3);
  });

  it('does not turn rest or approved leave into lateness', () => {
    const rest = normalizeAttendanceBundle(binding, { results: [], punches: [], schedules: [{ userId: 'user-1', workDate: '2026-07-02', isRest: 'Y' }] });
    const leave = normalizeAttendanceBundle(binding, { results: [{ userId: 'user-1', workDate: '2026-07-03', checkType: 'OnDuty', timeResult: 'Leave' }], punches: [], schedules: [] });
    expect(rest[0]).toMatchObject({ dailyStatus: 'rest', isAttended: false, lateMinutes: 0 });
    expect(leave[0]).toMatchObject({ dailyStatus: 'leave', isAttended: false, lateMinutes: 0 });
  });

  it('marks required missing punches and keeps cross-day shifts on the work date', () => {
    const days = normalizeAttendanceBundle(binding, {
      results: [{ id: 'r1', userId: 'user-1', workDate: '2026-07-04', checkType: 'OnDuty', baseCheckTime: '2026-07-04 22:00:00+08:00', userCheckTime: '2026-07-04 22:02:00+08:00', timeResult: 'Normal' }],
      punches: [{ id: 'p1', userId: 'user-1', userCheckTime: '2026-07-05 06:00:00+08:00', checkType: 'OffDuty', sourceType: 'APPROVE' }],
      schedules: [
        { userId: 'user-1', workDate: '2026-07-04', checkType: 'OnDuty', planCheckTime: '2026-07-04 22:00:00+08:00', className: '夜班' },
        { userId: 'user-1', workDate: '2026-07-04', checkType: 'OffDuty', planCheckTime: '2026-07-05 06:00:00+08:00', className: '夜班' },
      ],
    });
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ attendanceDate: '2026-07-04', shiftName: '夜班', missingPunch: 'none' });
    expect(days[0].punches[0]).toMatchObject({ checkType: 'off_duty', isApprovedCorrection: true });
  });

  it('does not count a day with only one required punch as attended', () => {
    const days = normalizeAttendanceBundle(binding, {
      results: [{ id: 'r-on', userId: 'user-1', workDate: '2026-07-08', checkType: 'OnDuty', baseCheckTime: '2026-07-08 09:00:00+08:00', userCheckTime: '2026-07-08 09:01:00+08:00', timeResult: 'Normal' }],
      punches: [{ id: 'p-on', userId: 'user-1', userCheckTime: '2026-07-08 09:01:00+08:00', checkType: 'OnDuty' }],
      schedules: [
        { userId: 'user-1', workDate: '2026-07-08', checkType: 'OnDuty', planCheckTime: '2026-07-08 09:00:00+08:00' },
        { userId: 'user-1', workDate: '2026-07-08', checkType: 'OffDuty', planCheckTime: '2026-07-08 18:00:00+08:00' },
      ],
    }, new Date('2026-07-08T19:00:00+08:00'));

    expect(days[0]).toMatchObject({ dailyStatus: 'missing', isAttended: false, missingPunch: 'off' });
  });

  it('maps all required business statuses and preserves unknown values as unknown', () => {
    expect(['Normal','Late','Early','NotSigned','Rest','Leave','Trip','Outside','Absenteeism'].map(normalizeDutyResult)).toEqual([
      'normal','late','early','missing','rest','leave','business_trip','fieldwork','abnormal',
    ]);
    expect(normalizeDutyResult('future-value')).toBe('unknown');
  });

  it('uses separate on-duty and off-duty rows from the daily schedule endpoint', () => {
    const days = normalizeAttendanceBundle(binding, {
      results: [],
      punches: [
        { id: 'p-on', userid: 'user-1', userCheckTime: '2026-07-06 09:01:00+08:00', checkType: 'OnDuty' },
        { id: 'p-off', userid: 'user-1', userCheckTime: '2026-07-06 18:02:00+08:00', checkType: 'OffDuty' },
      ],
      schedules: [
        { userid: 'user-1', workDate: '2026-07-06', check_type: 'OnDuty', plan_check_time: '2026-07-06 09:00:00+08:00', class_id: 'shift-2' },
        { userid: 'user-1', workDate: '2026-07-06', check_type: 'OffDuty', plan_check_time: '2026-07-06 18:00:00+08:00', class_id: 'shift-2' },
      ],
    });

    expect(days[0]).toMatchObject({
      attendanceDate: '2026-07-06',
      plannedOnAt: '2026-07-06T01:00:00.000Z',
      plannedOffAt: '2026-07-06T10:00:00.000Z',
      missingPunch: 'none',
      shiftId: 'shift-2',
    });
  });

  it('treats timezone-free DingTalk schedule strings as China local time', () => {
    const days = normalizeAttendanceBundle(binding, {
      results: [],
      punches: [
        { id: 'p-on', userid: 'user-1', userCheckTime: 1784080323000, checkType: 'OnDuty' },
        { id: 'p-off', userid: 'user-1', userCheckTime: 1784119876000, checkType: 'OffDuty' },
      ],
      schedules: [
        { userid: 'user-1', workDate: '2026-07-15', check_type: 'OnDuty', plan_check_time: '2026-07-15 10:00:00' },
        { userid: 'user-1', workDate: '2026-07-15', check_type: 'OffDuty', plan_check_time: '2026-07-15 20:00:00' },
      ],
    }, new Date('2026-07-16T00:00:00+08:00'));

    expect(days[0]).toMatchObject({
      attendanceDate: '2026-07-15',
      plannedOnAt: '2026-07-15T02:00:00.000Z',
      plannedOffAt: '2026-07-15T12:00:00.000Z',
      dailyStatus: 'normal',
    });
  });

  it('converts explicitly zoned UTC work dates before assigning the attendance day', () => {
    const days = normalizeAttendanceBundle(binding, {
      results: [
        { id: 'result-on', userId: 'user-1', workDate: '2026-07-13T16:00:00.000Z', checkType: 'OnDuty', baseCheckTime: '2026-07-14 10:00:00+08:00', userCheckTime: '2026-07-14 09:58:00+08:00', timeResult: 'Normal' },
        { id: 'result-off', userId: 'user-1', workDate: '2026-07-13T16:00:00.000Z', checkType: 'OffDuty', baseCheckTime: '2026-07-14 20:00:00+08:00', userCheckTime: '2026-07-14 20:01:00+08:00', timeResult: 'Normal' },
      ],
      punches: [],
      schedules: [],
    });

    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      attendanceDate: '2026-07-14',
      plannedOnAt: '2026-07-14T02:00:00.000Z',
      plannedOffAt: '2026-07-14T12:00:00.000Z',
      dailyStatus: 'normal',
    });
  });

  it('keeps future shifts pending and recognizes common rest-day values', () => {
    const future = normalizeAttendanceBundle(binding, {
      results: [], punches: [], schedules: [
        { userid: 'user-1', workDate: '2026-07-16', check_type: 'OnDuty', plan_check_time: '2026-07-16 17:30:00' },
        { userid: 'user-1', workDate: '2026-07-16', check_type: 'OffDuty', plan_check_time: '2026-07-17 02:30:00' },
      ],
    }, new Date('2026-07-16T16:00:00+08:00'));
    const rest = normalizeAttendanceBundle(binding, {
      results: [], punches: [], schedules: [{ userid: 'user-1', workDate: '2026-07-15', isRest: 'true' }],
    }, new Date('2026-07-16T16:00:00+08:00'));

    expect(future[0]).toMatchObject({ dailyStatus: 'pending', missingPunch: 'none' });
    expect(rest[0]).toMatchObject({ dailyStatus: 'rest', missingPunch: 'none' });
  });
});
