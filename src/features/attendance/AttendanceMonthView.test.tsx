import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AttendanceMonthView } from './AttendanceMonthView';
import type { AttendanceMonthDetail } from './model';

const detail: AttendanceMonthDetail = {
  summary: { attendanceDates: ['2026-07-14', '2026-07-15'], attendanceDays: 2, lateCount: 1, lateMinutes: 12, missingCount: 0, abnormalCount: 0, lastSyncedAt: '2026-07-15T02:00:00Z' },
  days: [
    { id: 'normal', date: '2026-07-14', timezone: 'Asia/Shanghai', shiftId: '1', shiftName: '早班', plannedOnAt: '2026-07-14T01:00:00Z', plannedOffAt: '2026-07-14T10:00:00Z', actualOnAt: '2026-07-14T00:58:00Z', actualOffAt: '2026-07-14T10:00:00Z', onDutyResult: 'normal', offDutyResult: 'normal', status: 'normal', isAttended: true, lateMinutes: 0, earlyMinutes: 0, missingPunch: 'none', exceptionNote: null, lastSyncedAt: '2026-07-15T02:00:00Z', punches: [] },
    { id: 'late', date: '2026-07-15', timezone: 'Asia/Shanghai', shiftId: '1', shiftName: '非常长的门店早班名称用于验证小屏展示', plannedOnAt: '2026-07-15T01:00:00Z', plannedOffAt: '2026-07-15T10:00:00Z', actualOnAt: '2026-07-15T01:12:00Z', actualOffAt: '2026-07-15T10:00:00Z', onDutyResult: 'late', offDutyResult: 'normal', status: 'late', isAttended: true, lateMinutes: 12, earlyMinutes: 0, missingPunch: 'none', exceptionNote: '迟到', lastSyncedAt: '2026-07-15T02:00:00Z', punches: [] },
  ],
};

describe('AttendanceMonthView', () => {
  it('shows summary, enterprise-timezone punches and a focused exception list', () => {
    render(<AttendanceMonthView detail={detail} />);
    expect(screen.getByText('12', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('实际 09:12')).toBeInTheDocument();
    expect(screen.getByText('非常长的门店早班名称用于验证小屏展示')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '迟到与异常' }));
    expect(screen.queryByText('2026-07-14')).not.toBeInTheDocument();
    expect(screen.getByText('迟到 12 分钟')).toBeInTheDocument();
  });
});
