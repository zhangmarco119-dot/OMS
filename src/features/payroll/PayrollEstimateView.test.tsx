import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PayrollEstimate } from './model';
import { PayrollEstimateView } from './PayrollEstimateView';

const estimate = {
  profileId: 'p1', displayName: '员工甲', username: 'staff', primaryStoreId: 's1', asOf: '2026-07-17', monthStart: '2026-07-01', monthEnd: '2026-07-31',
  fullAttendanceDays: 27, attendanceDays: 13, ruleId: 'r1', ruleConfirmed: false, monthlyBaseSalary: 5500, monthlyHousingAllowance: 1100,
  fullPerformanceAmount: 3000, commissionRate: .006, housingEnabled: true, performanceEnabled: true, commissionEnabled: true,
  fullAttendanceBonusEnabled: true, fullAttendanceBonusAmount: 500, fullAttendanceBonusAwarded: false, accruedFullAttendanceBonus: 0,
  overtimeHours: 2, overtimeHourlyRate: 25, accruedOvertime: 50,
  accruedBaseSalary: 2648.15, accruedHousingAllowance: 529.63, accruedPerformance: null, accruedCommission: null, lateCount: 1, lateMinutes: 5,
  lateFine: 20, otherFine: 0, fineTotal: 20, taskDueCount: 0, taskCompletedCount: 0, taskScore: null, attendanceScore: 24,
  disciplineScore: 15, performanceScore: null, performanceGrade: null, revenueTotal: 0, revenueEffectiveDate: null, revenueCarriedForward: false, performanceReady: false, commissionReady: false,
  dataComplete: false, incomeSubtotalKnown: 3177.78, knownEstimatedPayable: 3157.78, estimatedPayable: null,
  attendanceUpdatedAt: null, tasksUpdatedAt: null, revenueUpdatedAt: null, penaltiesUpdatedAt: null, overtimeUpdatedAt: null,
  dataIssues: ['工资参数待管理员确认', '营业收入待更新'],
} satisfies PayrollEstimate;

describe('PayrollEstimateView', () => {
  it('shows attendance days and a clearly provisional salary without worked hours', () => {
    render(<PayrollEstimateView estimate={estimate} />);
    expect(screen.getByText('13 天')).toBeInTheDocument();
    expect(screen.getByText(/截至 2026-07-17 的预估工资/)).toBeInTheDocument();
    expect(screen.getByText(/营业收入待更新/)).toBeInTheDocument();
    expect(screen.queryByText(/出勤工时/)).not.toBeInTheDocument();
    expect(screen.getByText(/本月累计提成基数/)).toBeInTheDocument();
    expect(screen.getByText(/含社保补贴/)).toBeInTheDocument();
    expect(screen.getByText(/达到 27 天后增加全勤奖/)).toBeInTheDocument();
  });

  it('shows an awarded full-attendance bonus inside performance pay', () => {
    render(<PayrollEstimateView estimate={{ ...estimate, attendanceDays: 27, fullAttendanceBonusAwarded: true, accruedFullAttendanceBonus: 500, accruedPerformance: 2900 }} />);
    expect(screen.getByText(/已含全勤奖/)).toBeInTheDocument();
    expect(screen.getByText('¥2,900.00')).toBeInTheDocument();
  });

  it('links administrator data issues to their update location', () => {
    const onResolveIssue = vi.fn();
    render(<PayrollEstimateView estimate={estimate} onResolveIssue={onResolveIssue} />);
    fireEvent.click(screen.getByRole('button', { name: /营业收入待更新.*去更新/ }));
    expect(onResolveIssue).toHaveBeenCalledWith('营业收入待更新');
  });

  it('explains when the latest available commission base is carried forward', () => {
    render(<PayrollEstimateView estimate={{ ...estimate, revenueTotal: 12000, revenueEffectiveDate: '2026-07-16', revenueCarriedForward: true, accruedCommission: 72 }} />);
    expect(screen.getByText(/沿用截至 2026-07-16 的已有基数/)).toBeInTheDocument();
  });
});
