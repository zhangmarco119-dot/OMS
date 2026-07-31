import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PayrollEstimate } from './model';
import { PayrollEstimateView } from './PayrollEstimateView';

const estimate = {
  profileId: 'p1', displayName: '员工甲', username: 'staff', primaryStoreId: 's1', asOf: '2026-07-17', monthStart: '2026-07-01', monthEnd: '2026-07-31',
  employmentType: 'full_time', partTimeHours: 0, partTimeHourlyRate: null, accruedPartTimeWage: 0,
  fullAttendanceDays: 27, attendanceDays: 13, ruleId: 'r1', ruleConfirmed: false, monthlyBaseSalary: 5500, monthlyHousingAllowance: 1100,
  fullPerformanceAmount: 3000, commissionRate: .006, housingEnabled: true, performanceEnabled: true, performanceOverrideEnabled: false, performanceOverrideAmount: 0, performanceOverrideScore: null, performanceCalculationMode: 'automatic', commissionEnabled: true,
  performanceStores: [], hasMultiplePerformanceStores: false, performanceAmountOverrideEnabled: false, performanceAmountOverride: null,
  fullAttendanceBonusEnabled: true, fullAttendanceBonusAmount: 500, fullAttendanceBonusAwarded: false, accruedFullAttendanceBonus: 0,
  extraAttendanceDays: 0, extraAttendanceBonusRate: 300, accruedExtraAttendanceBonus: 0,
  serviceAwardEnabled: true, serviceAwardAmount: 100, accruedServiceAward: 48.15, regularizationDate: null, eligibleAttendanceDays: 13, regularizationFactor: 1, isProbation: false,
  extraRewardAmount: 0, accruedExtraReward: 0,
  overtimeHours: 2, overtimeHourlyRate: 25, accruedOvertime: 50,
  accruedBaseSalary: 2648.15, accruedHousingAllowance: 529.63, accruedPerformance: null, accruedCommission: null, lateCount: 1, lateMinutes: 5,
  lateFine: 20, otherFine: 0, fineTotal: 20, individualIncomeTax: 0, deductionTotal: 20,
  deductionItems: [{ id: 'late-1', date: '2026-07-10', createdAt: null, type: 'late', title: '迟到罚款', reason: '迟到 5 分钟', amount: 20, performanceDeduction: 0 }],
  taskDueCount: 0, taskCompletedCount: 0, taskScore: null, attendanceScore: 24,
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
    expect(screen.getByText(/累计出勤达到 27 天后产生/)).toBeInTheDocument();
    expect(screen.getByText('工龄奖')).toBeInTheDocument();
    expect(screen.getByText('员工甲')).toBeInTheDocument();
    expect(screen.queryByText('超勤奖')).not.toBeInTheDocument();
  });

  it('shows an awarded full-attendance bonus as a separate salary item', () => {
    render(<PayrollEstimateView estimate={{ ...estimate, attendanceDays: 27, fullAttendanceBonusAwarded: true, accruedFullAttendanceBonus: 500, accruedPerformance: 2900 }} />);
    expect(screen.getByText(/本月累计出勤已达到/)).toBeInTheDocument();
    expect(screen.getByText('¥2,900.00')).toBeInTheDocument();
  });

  it('deducts the estimated individual income tax from the real-time payable amount only', () => {
    render(<PayrollEstimateView estimate={{ ...estimate, estimatedIndividualIncomeTax: 120, individualIncomeTaxEstimateMode: 'automatic', individualIncomeTaxEstimateBasis: 'current_month', knownEstimatedNetPayable: 3037.78 }} />);
    expect(screen.getByText('预计个税扣除')).toBeInTheDocument();
    expect(screen.getByText('¥3,037.78')).toBeInTheDocument();
    expect(screen.getByText(/最终以工资单人工确认/)).toBeInTheDocument();
  });

  it('shows the automatic extra-attendance award and administrator reward separately', () => {
    render(<PayrollEstimateView estimate={{ ...estimate, attendanceDays: 29, extraAttendanceDays: 2, accruedExtraAttendanceBonus: 600, extraRewardAmount: 80, accruedExtraReward: 80 }} />);
    expect(screen.getByText('超勤奖')).toBeInTheDocument();
    expect(screen.getByText(/超过全勤标准 2 天/)).toBeInTheDocument();
    expect(screen.getByText('额外奖励')).toBeInTheDocument();
    expect(screen.getByText('本月增加的额外奖励')).toBeInTheDocument();
    expect(screen.getByText('¥600.00')).toBeInTheDocument();
  });

  it('shows an itemized deduction dialog with the reason and date', () => {
    render(<PayrollEstimateView estimate={estimate} />);
    fireEvent.click(screen.getByRole('button', { name: /罚款合计.*点击查看扣款时间和原因/ }));
    expect(screen.getByText('扣款明细')).toBeInTheDocument();
    expect(screen.getByText('迟到 5 分钟')).toBeInTheDocument();
    expect(screen.getByText('2026年7月10日')).toBeInTheDocument();
  });

  it('shows a monthly adjusted performance score like a normal calculated score', () => {
    render(<PayrollEstimateView estimate={{ ...estimate, performanceCalculationMode: 'override', performanceOverrideEnabled: true, performanceOverrideScore: 88, performanceScore: 88, performanceGrade: 'B', accruedPerformance: 800, performanceReady: true }} />);
    expect(screen.getByText('当前 B 级，88 分')).toBeInTheDocument();
    expect(screen.getByText('88 分 · B 级')).toBeInTheDocument();
    expect(screen.queryByText(/强制覆盖/)).not.toBeInTheDocument();
  });

  it('shows only store grades for a multi-store employee', () => {
    render(<PayrollEstimateView estimate={{ ...estimate, accruedPerformance: 1234, hasMultiplePerformanceStores: true, performanceAmountOverride: 1234, performanceAmountOverrideEnabled: true, performanceCalculationMode: 'amount_override', performanceStores: [
      { allocationRatio: .6, amount: 900, calculationMode: 'grade', coefficient: 1, grade: 'A', score: null, storeId: 's1', storeName: '西直门店' },
      { allocationRatio: .4, amount: 334, calculationMode: 'score', coefficient: .8, grade: 'B', score: 85, storeId: 's2', storeName: '五道口店' },
    ] }} />);
    expect(screen.getAllByText(/西直门店.*A 级/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/五道口店.*B 级/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/85 分/)).not.toBeInTheDocument();
    expect(screen.queryByText(/强制覆盖/)).not.toBeInTheDocument();
  });

  it('links administrator data issues to their update location', () => {
    const onResolveIssue = vi.fn();
    render(<PayrollEstimateView estimate={estimate} onResolveIssue={onResolveIssue} />);
    fireEvent.click(screen.getByRole('button', { name: /营业收入待更新.*去更新/ }));
    expect(onResolveIssue).toHaveBeenCalledWith('营业收入待更新');
  });

  it('does not expose the carry-forward date in the commission explanation', () => {
    render(<PayrollEstimateView estimate={{ ...estimate, revenueTotal: 12000, revenueEffectiveDate: '2026-07-16', revenueCarriedForward: true, accruedCommission: 72 }} />);
    expect(screen.queryByText(/沿用截至/)).not.toBeInTheDocument();
  });

  it('only mentions regularization when it happened in the selected month', () => {
    const { rerender } = render(<PayrollEstimateView estimate={{ ...estimate, regularizationDate: '2026-06-15' }} />);
    expect(screen.queryByText(/2026-06-15.*转正/)).not.toBeInTheDocument();
    rerender(<PayrollEstimateView estimate={{ ...estimate, regularizationDate: '2026-07-15', regularizationFactor: .5, eligibleAttendanceDays: 7 }} />);
    expect(screen.getAllByText(/转正日 2026-07-15/).length).toBeGreaterThan(0);
  });

  it('shows only approved part-time hours and part-time wage for a part-time account', () => {
    render(<PayrollEstimateView estimate={{ ...estimate, employmentType: 'part_time', partTimeHours: 12.5, partTimeHourlyRate: 25, accruedPartTimeWage: 312.5, knownEstimatedPayable: 312.5, estimatedPayable: 312.5 }} />);
    expect(screen.getByText('12.5 小时')).toBeInTheDocument();
    expect(screen.getAllByText('兼职薪资')).toHaveLength(2);
    expect(screen.queryByText('累计基本工资')).not.toBeInTheDocument();
    expect(screen.queryByText('绩效评分')).not.toBeInTheDocument();
  });
});
