import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PayrollEstimate } from './model';
import { PayrollEstimateView } from './PayrollEstimateView';

const estimate = {
  profileId: 'p1', displayName: '员工甲', username: 'staff', primaryStoreId: 's1', asOf: '2026-07-17', monthStart: '2026-07-01', monthEnd: '2026-07-31',
  fullAttendanceDays: 27, attendanceDays: 13, ruleId: 'r1', ruleConfirmed: false, monthlyBaseSalary: 5500, monthlyHousingAllowance: 1100,
  fullPerformanceAmount: 3000, commissionRate: .006, housingEnabled: true, performanceEnabled: true, commissionEnabled: true,
  overtimeHours: 2, overtimeHourlyRate: 25, accruedOvertime: 50,
  accruedBaseSalary: 2648.15, accruedHousingAllowance: 529.63, accruedPerformance: null, accruedCommission: null, lateCount: 1, lateMinutes: 5,
  lateFine: 20, otherFine: 0, fineTotal: 20, taskDueCount: 0, taskCompletedCount: 0, taskScore: null, attendanceScore: 24,
  disciplineScore: 15, performanceScore: null, performanceGrade: null, revenueTotal: 0, performanceReady: false, commissionReady: false,
  dataComplete: false, incomeSubtotalKnown: 3177.78, knownEstimatedPayable: 3157.78, estimatedPayable: null,
  attendanceUpdatedAt: null, tasksUpdatedAt: null, revenueUpdatedAt: null, penaltiesUpdatedAt: null, overtimeUpdatedAt: null,
  dataIssues: ['工资参数待管理员确认', '营业收入待更新'],
} satisfies PayrollEstimate;

describe('PayrollEstimateView', () => {
  it('shows attendance days and a clearly provisional salary without worked hours', () => {
    render(<PayrollEstimateView estimate={estimate} />);
    expect(screen.getByText('13 天')).toBeInTheDocument();
    expect(screen.getByText(/截至 2026-07-17 的预估工资/)).toBeInTheDocument();
    expect(screen.getByText('营业收入待更新')).toBeInTheDocument();
    expect(screen.queryByText(/出勤工时/)).not.toBeInTheDocument();
  });
});
