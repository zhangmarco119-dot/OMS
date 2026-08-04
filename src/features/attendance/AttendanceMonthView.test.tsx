import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AttendanceMonthView } from './AttendanceMonthView';
import type { AttendanceMonthDetail } from './model';

const detail: AttendanceMonthDetail = {
  summary: { attendanceDates: ['2026-07-14', '2026-07-15'], attendanceDays: 2, lateCount: 1, lateMinutes: 12, missingCount: 0, abnormalCount: 0, overtimeHours: 2.5, lastSyncedAt: '2026-07-15T02:00:00Z' },
  overtimeRecords: [{ date: '2026-07-14', hours: 2.5, id: 'overtime-1', reason: '盘点', storeId: 'store-a', storeName: '门店 A' }],
  days: [
    { id: 'normal', date: '2026-07-14', timezone: 'Asia/Shanghai', shiftId: '1', shiftName: '早班', plannedOnAt: '2026-07-14T01:00:00Z', plannedOffAt: '2026-07-14T10:00:00Z', actualOnAt: '2026-07-14T00:58:00Z', actualOffAt: '2026-07-14T10:00:00Z', onDutyResult: 'normal', offDutyResult: 'normal', status: 'normal', isAttended: true, lateMinutes: 0, earlyMinutes: 0, missingPunch: 'none', exceptionNote: null, lastSyncedAt: '2026-07-15T02:00:00Z', hasScheduleConflict: true, enterpriseCount: 2, sources: [{ corpId: 'a', enterpriseName: '企业 A', storeId: 'store-a', storeName: '门店 A', shiftId: '1', shiftName: '早班', plannedOnAt: '2026-07-14T01:00:00Z', plannedOffAt: '2026-07-14T10:00:00Z', actualOnAt: '2026-07-14T00:58:00Z', actualOffAt: '2026-07-14T10:00:00Z', status: 'normal' }, { corpId: 'b', enterpriseName: '企业 B', storeId: 'store-b', storeName: '门店 B', shiftId: '2', shiftName: '中班', plannedOnAt: '2026-07-14T02:00:00Z', plannedOffAt: '2026-07-14T11:00:00Z', actualOnAt: null, actualOffAt: null, status: 'pending' }], punches: [] },
    { id: 'late', date: '2026-07-15', timezone: 'Asia/Shanghai', shiftId: '1', shiftName: '非常长的门店早班名称用于验证小屏展示', plannedOnAt: '2026-07-15T01:00:00Z', plannedOffAt: '2026-07-15T10:00:00Z', actualOnAt: '2026-07-15T01:12:00Z', actualOffAt: '2026-07-15T10:00:00Z', onDutyResult: 'late', offDutyResult: 'normal', status: 'late', isAttended: true, lateMinutes: 12, earlyMinutes: 0, missingPunch: 'none', exceptionNote: '迟到', lastSyncedAt: '2026-07-15T02:00:00Z', punches: [] },
  ],
};

describe('AttendanceMonthView', () => {
  it('shows summary, enterprise-timezone punches and a focused exception list', () => {
    render(<AttendanceMonthView detail={detail} />);
    expect(screen.getByText('1 次', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('12 分', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('实际 09:12')).toBeInTheDocument();
    expect(screen.getByText('非常长的门店早班名称用于验证小屏展示')).toBeInTheDocument();
    expect(screen.getByText('异常：同一天在两个门店都有有效排班，请管理员核对。')).toBeInTheDocument();
    expect(screen.getByText('查看 2 个企业的考勤来源')).toBeInTheDocument();
    expect(screen.getAllByText('查看打卡（0 次）')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '迟到与异常' }));
    expect(screen.queryByText('2026-07-14')).not.toBeInTheDocument();
    expect(screen.getByText('迟到 12 分钟')).toBeInTheDocument();
  });

  it('identifies the missing punch and shows a fieldwork badge', () => {
    render(<AttendanceMonthView detail={{
      summary: { attendanceDates: ['2026-07-16'], attendanceDays: 1, lateCount: 0, lateMinutes: 0, missingCount: 1, abnormalCount: 0, overtimeHours: 0, lastSyncedAt: null },
      overtimeRecords: [],
      days: [{ ...detail.days[0], id: 'fieldwork-missing', date: '2026-07-16', hasFieldwork: true, hasScheduleConflict: false, missingPunch: 'off', status: 'missing' }],
    }} />);
    expect(screen.getByText('外勤打卡')).toBeInTheDocument();
    expect(screen.getByText('缺下班卡')).toBeInTheDocument();
    expect(screen.getByText('下班缺卡')).toBeInTheDocument();
  });

  it('opens a corresponding detail dialog from every summary card', () => {
    render(<AttendanceMonthView detail={detail} />);
    const cards = [
      ['出勤天数', '出勤天数明细'],
      ['累计加班', '累计加班明细'],
      ['迟到次数', '迟到次数明细'],
      ['迟到累计', '迟到累计明细'],
      ['缺卡次数', '缺卡次数明细'],
      ['异常次数', '异常次数明细'],
    ];
    for (const [label, title] of cards) {
      fireEvent.click(screen.getByRole('button', { name: `${label}，点击查看明细` }));
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '关闭考勤明细' }));
    }
  });

  it('shows approved overtime date, store, hours and reason', () => {
    render(<AttendanceMonthView detail={detail} />);
    fireEvent.click(screen.getByRole('button', { name: '累计加班，点击查看明细' }));
    expect(screen.getByText('2.5 小时', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText('门店 A · 盘点')).toBeInTheDocument();
  });
});
