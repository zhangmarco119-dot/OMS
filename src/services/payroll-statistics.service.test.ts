import { describe, expect, it, vi } from 'vitest';

import { loadPayrollStatistics } from './payroll-statistics.service';

const estimate = (amount: number) => ({
  accruedOvertime: 0,
  accruedPartTimeWage: 0,
  asOf: '2026-07-31',
  dataComplete: true,
  displayName: '测试员工',
  employmentType: 'full_time',
  estimatedPayable: amount,
  individualIncomeTax: 0,
  knownEstimatedPayable: amount,
  monthEnd: '2026-07-31',
  monthStart: '2026-07-01',
  primaryStoreId: 'store-1',
  profileId: 'profile-1',
});

describe('payroll statistics', () => {
  it('allocates payroll cost by store work and calculates payroll ratios', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'admin_payroll_statistics_inputs') return { data: {
        profiles: [{ displayName: '测试员工', employmentType: 'full_time', id: 'profile-1', primaryStoreId: 'store-1' }],
        stores: [{ id: 'store-1', name: '一店' }, { id: 'store-2', name: '二店' }],
        work: [
          { attendanceDays: 2, overtimeCost: 0, overtimeHours: 0, payrollMonth: '2026-07-01', profileId: 'profile-1', storeId: 'store-1' },
          { attendanceDays: 1, overtimeCost: 0, overtimeHours: 0, payrollMonth: '2026-07-01', profileId: 'profile-1', storeId: 'store-2' },
        ],
        revenues: [{ amount: 3000, storeId: 'store-1' }, { amount: 1000, storeId: 'store-2' }],
        payslips: [],
      }, error: null };
      if (name === 'admin_payroll_estimates') return { data: { items: [estimate(900)], employeeCount: 1, completeCount: 1, incompleteCount: 0 }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    const result = await loadPayrollStatistics({ rpc } as never, '2026-07-01', '2026-07-31');

    expect(result).toMatchObject({ totalHours: 24, totalRevenue: 4000, totalSalaryCost: 900, averageHourlyCost: 37.5, overallPayrollRatio: 0.225 });
    expect(result.stores).toEqual([
      expect.objectContaining({ name: '一店', salaryCost: 600, payrollShare: 2 / 3, payrollToRevenueRatio: 0.2 }),
      expect.objectContaining({ name: '二店', salaryCost: 300, payrollShare: 1 / 3, payrollToRevenueRatio: 0.3 }),
    ]);
    expect(result.employees[0]).toMatchObject({ displayName: '测试员工', hours: 24, salaryCost: 900 });
  });

  it('uses the difference between month-to-date estimates for a partial range', async () => {
    const rpc = vi.fn(async (name: string, args: { p_as_of?: string }) => {
      if (name === 'admin_payroll_statistics_inputs') return { data: {
        profiles: [{ displayName: '测试员工', employmentType: 'full_time', id: 'profile-1', primaryStoreId: 'store-1' }],
        stores: [{ id: 'store-1', name: '一店' }],
        work: [{ attendanceDays: 2, overtimeCost: 0, overtimeHours: 0, payrollMonth: '2026-07-01', profileId: 'profile-1', storeId: 'store-1' }],
        revenues: [], payslips: [],
      }, error: null };
      if (name === 'admin_payroll_estimates') return { data: { items: [estimate(args.p_as_of === '2026-07-09' ? 300 : 800)] }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    const result = await loadPayrollStatistics({ rpc } as never, '2026-07-10', '2026-07-20');
    expect(result.totalSalaryCost).toBe(500);
    expect(result.employees[0].periods[0]).toMatchObject({ from: '2026-07-10', salaryCost: 500, source: 'realtime', to: '2026-07-20' });
  });
});
