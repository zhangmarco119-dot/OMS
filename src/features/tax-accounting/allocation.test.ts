import { describe, expect, it } from 'vitest';

import type { PayrollEstimate } from '../payroll/model';
import { allocatePayrollCosts } from './allocation';

const estimate = (overrides: Partial<PayrollEstimate> = {}): PayrollEstimate => ({
  profileId: 'p1', displayName: '员工甲', username: 'staff', primaryStoreId: 's1',
  asOf: '2026-07-31', monthStart: '2026-07-01', monthEnd: '2026-07-31',
  employmentType: 'full_time', partTimeHours: 0, partTimeHourlyRate: null, accruedPartTimeWage: 0,
  fullAttendanceDays: 26, attendanceDays: 6, ruleId: 'r1', ruleConfirmed: true,
  monthlyBaseSalary: 0, monthlyHousingAllowance: 0, fullPerformanceAmount: 0, commissionRate: 0,
  housingEnabled: false, performanceEnabled: false, performanceOverrideEnabled: false,
  performanceOverrideAmount: 0, performanceOverrideScore: null, performanceCalculationMode: 'automatic',
  commissionEnabled: false, fullAttendanceBonusEnabled: false, fullAttendanceBonusAmount: 0,
  fullAttendanceBonusAwarded: false, accruedFullAttendanceBonus: 0, extraAttendanceDays: 0,
  extraAttendanceBonusRate: 300, accruedExtraAttendanceBonus: 0, serviceAwardEnabled: false,
  serviceAwardAmount: 100, accruedServiceAward: 0, extraRewardAmount: 0, accruedExtraReward: 0,
  regularizationDate: null, eligibleAttendanceDays: 6, regularizationFactor: 1, isProbation: false,
  accruedBaseSalary: 900, accruedHousingAllowance: 0, accruedPerformance: 0, accruedCommission: 0,
  overtimeHours: 4, overtimeHourlyRate: 25, accruedOvertime: 100, lateCount: 0, lateMinutes: 0,
  lateFine: 0, otherFine: 0, fineTotal: 0, individualIncomeTax: 0, deductionTotal: 0,
  deductionItems: [], taskDueCount: 0, taskCompletedCount: 0, taskScore: null, attendanceScore: 0,
  disciplineScore: 0, performanceScore: null, performanceGrade: null, revenueTotal: 0,
  revenueEffectiveDate: null, revenueCarriedForward: false, performanceReady: true, commissionReady: true,
  dataComplete: true, incomeSubtotalKnown: 1000, knownEstimatedPayable: 1000, estimatedPayable: 1000,
  attendanceUpdatedAt: null, tasksUpdatedAt: null, revenueUpdatedAt: null, penaltiesUpdatedAt: null,
  overtimeUpdatedAt: null, dataIssues: [], ...overrides,
});

describe('allocatePayrollCosts', () => {
  it('按门店出勤分摊基本工资，并把加班计入实际发生门店', () => {
    const result = allocatePayrollCosts(
      [{ estimate: estimate(), profileId: 'p1', status: 'confirmed', storeId: 's1' }],
      [
        ...Array.from({ length: 4 }, (_, index) => ({ attendanceDate: `2026-07-0${index + 1}`, isAttended: true, profileId: 'p1', storeId: 's1' })),
        ...Array.from({ length: 2 }, (_, index) => ({ attendanceDate: `2026-07-1${index + 1}`, isAttended: true, profileId: 'p1', storeId: 's2' })),
      ],
      [{ approvedHourlyRate: 25, hours: 4, profileId: 'p1', status: 'approved', storeId: 's2' }],
    );
    expect(result.find((item) => item.storeId === 's1')?.amount).toBe(600);
    expect(result.find((item) => item.storeId === 's2')?.amount).toBe(400);
    expect(result.reduce((sum, item) => sum + item.amount, 0)).toBe(1000);
  });

  it('兼职工资全部按照已审批工时在各门店分摊', () => {
    const result = allocatePayrollCosts(
      [{ estimate: estimate({ employmentType: 'part_time', estimatedPayable: 250, knownEstimatedPayable: 250, accruedOvertime: 0 }), profileId: 'p1', status: 'issued', storeId: 's1' }],
      [],
      [
        { approvedHourlyRate: 25, hours: 2, profileId: 'p1', status: 'approved', storeId: 's1' },
        { approvedHourlyRate: 25, hours: 8, profileId: 'p1', status: 'approved', storeId: 's2' },
      ],
    );
    expect(result.find((item) => item.storeId === 's1')?.amount).toBe(50);
    expect(result.find((item) => item.storeId === 's2')?.amount).toBe(200);
  });

  it('没有门店考勤时回退到工资单主门店且保持分币一致', () => {
    const result = allocatePayrollCosts(
      [{ estimate: estimate({ estimatedPayable: 1000.01, knownEstimatedPayable: 1000.01, accruedOvertime: 0 }), profileId: 'p1', status: 'draft', storeId: 's1' }],
      [],
      [],
    );
    expect(result).toEqual([{ amount: 1000.01, employees: [{ amount: 1000.01, attendanceDays: 0, overtimeHours: 0, profileId: 'p1', storeId: 's1' }], storeId: 's1' }]);
  });
});
