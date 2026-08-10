import { describe, expect, it } from 'vitest';

import type { PayrollEstimate } from '../payroll/model';
import { allocatePayrollCosts, includeEmptyStoreAllocations } from './allocation';

const estimate = (overrides: Partial<PayrollEstimate> = {}): PayrollEstimate => ({
  profileId: 'p1', displayName: '员工甲', username: 'staff', primaryStoreId: 's1',
  asOf: '2026-07-31', monthStart: '2026-07-01', monthEnd: '2026-07-31',
  employmentType: 'full_time', partTimeHours: 0, partTimeHourlyRate: null, accruedPartTimeWage: 0,
  fullAttendanceDays: 26, attendanceDays: 6, ruleId: 'r1', ruleConfirmed: true,
  monthlyBaseSalary: 0, monthlyHousingAllowance: 0, fullPerformanceAmount: 0, commissionRate: 0,
  housingEnabled: false, performanceEnabled: false, performanceOverrideEnabled: false,
  performanceOverrideAmount: 0, performanceOverrideScore: null, performanceCalculationMode: 'automatic',
  performanceStores: [], hasMultiplePerformanceStores: false, performanceAmountOverrideEnabled: false, performanceAmountOverride: null,
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
        ...Array.from({ length: 4 }, (_, index) => ({ actualOffAt: null, actualOnAt: null, attendanceDate: `2026-07-0${index + 1}`, id: `s1-${index}`, isAttended: true, plannedOffAt: `2026-07-0${index + 1}T18:00:00+08:00`, plannedOnAt: `2026-07-0${index + 1}T09:00:00+08:00`, profileId: 'p1', storeId: 's1' })),
        ...Array.from({ length: 2 }, (_, index) => ({ actualOffAt: null, actualOnAt: null, attendanceDate: `2026-07-1${index + 1}`, id: `s2-${index}`, isAttended: true, plannedOffAt: `2026-07-1${index + 1}T18:00:00+08:00`, plannedOnAt: `2026-07-1${index + 1}T09:00:00+08:00`, profileId: 'p1', storeId: 's2' })),
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
    expect(result).toEqual([{ amount: 1000.01, employees: [{ amount: 1000.01, attendanceHours: 0, overtimeHours: 0, profileId: 'p1', storeId: 's1' }], storeId: 's1' }]);
  });

  it('splits one scheduled day across the scheduled store and a uniquely matched fieldwork punch store', () => {
    const result = allocatePayrollCosts(
      [{ estimate: estimate({ accruedOvertime: 0 }), profileId: 'p1', status: 'confirmed', storeId: 's1' }],
      [{
        actualOffAt: '2026-07-08T21:05:00+08:00', actualOnAt: '2026-07-08T10:00:00+08:00', attendanceDate: '2026-07-08', id: 'day-1',
        isAttended: true, plannedOffAt: '2026-07-08T21:00:00+08:00', plannedOnAt: '2026-07-08T10:00:00+08:00', profileId: 'p1', storeId: 's1',
      }],
      [],
      [
        { dailyRecordId: 'day-1', locationName: 'OMEGA酸奶（西直门店）', storeId: 's1' },
        { dailyRecordId: 'day-1', locationName: '北京市海淀区五道口店外勤点', storeId: 's1' },
      ],
      [
        { id: 's1', name: 'OMEGA酸奶（西直门店）', shortName: '西直门店' },
        { id: 's2', name: '宝珠奶酪（五道口店）', shortName: '五道口店' },
      ],
    );
    expect(result).toEqual([
      { amount: 500, employees: [{ amount: 500, attendanceHours: 5, overtimeHours: 0, profileId: 'p1', storeId: 's1' }], storeId: 's1' },
      { amount: 500, employees: [{ amount: 500, attendanceHours: 5, overtimeHours: 0, profileId: 'p1', storeId: 's2' }], storeId: 's2' },
    ]);
  });

  it('uses actual punch duration only when the scheduled duration is unavailable, then subtracts the meal hour', () => {
    const result = allocatePayrollCosts(
      [{ estimate: estimate({ accruedOvertime: 0 }), profileId: 'p1', status: 'confirmed', storeId: 's1' }],
      [{ actualOffAt: '2026-07-08T18:30:00+08:00', actualOnAt: '2026-07-08T09:30:00+08:00', attendanceDate: '2026-07-08', id: 'day-1', isAttended: true, plannedOffAt: null, plannedOnAt: null, profileId: 'p1', storeId: 's1' }],
      [],
    );
    expect(result[0].employees[0].attendanceHours).toBe(8);
  });

  it('uses the configured fieldwork rule even when the punch address cannot identify the target store', () => {
    const result = allocatePayrollCosts(
      [{ estimate: estimate({ accruedOvertime: 0 }), profileId: 'p1', status: 'confirmed', storeId: 's1' }],
      [{ actualOffAt: null, actualOnAt: null, attendanceDate: '2026-07-08', id: 'day-1', isAttended: true, plannedOffAt: '2026-07-08T21:00:00+08:00', plannedOnAt: '2026-07-08T10:00:00+08:00', profileId: 'p1', storeId: 's1' }],
      [],
      [{ checkType: 'off_duty', dailyRecordId: 'day-1', locationName: '北京市海淀区成府路某位置', locationResult: 'Outside', sourceType: 'DING_ATM', storeId: 's1' }],
      [
        { id: 's1', name: 'OMEGA酸奶（西直门店）', shortName: '西直门店' },
        { id: 's2', name: '宝珠奶酪（五道口店）', shortName: '五道口店' },
      ],
      [{ effectiveFrom: '2026-01-01', effectiveTo: null, isEnabled: true, profileId: 'p1', punchScope: 'any', sourceStoreId: 's1', targetRatio: 0.4, targetStoreId: 's2' }],
    );
    expect(result).toEqual([
      { amount: 600, employees: [{ amount: 600, attendanceHours: 6, overtimeHours: 0, profileId: 'p1', storeId: 's1' }], storeId: 's1' },
      { amount: 400, employees: [{ amount: 400, attendanceHours: 4, overtimeHours: 0, profileId: 'p1', storeId: 's2' }], storeId: 's2' },
    ]);
  });
});

describe('includeEmptyStoreAllocations', () => {
  it('keeps every active store visible even when one store has no payroll allocation', () => {
    expect(includeEmptyStoreAllocations(['store-a', 'store-b'], [{
      amount: 1200,
      employees: [],
      storeId: 'store-a',
    }])).toEqual([
      { amount: 1200, employees: [], storeId: 'store-a' },
      { amount: 0, employees: [], storeId: 'store-b' },
    ]);
  });
});
