import { describe, expect, it, vi } from 'vitest';

import { loadAdminPayrollEstimates, loadMyPayrollEstimate, parsePayrollEstimate } from './payroll.service';

const estimate = { profileId: 'p1', displayName: '李天欣', attendanceDays: 8, fullAttendanceDays: 27, accruedBaseSalary: 1629.63, knownEstimatedPayable: 1800, dataComplete: false, dataIssues: ['营业收入待更新'] };

describe('payroll service', () => {
  it('parses nullable pending amounts without treating them as final zero', () => {
    expect(parsePayrollEstimate({ ...estimate, accruedCommission: null, estimatedPayable: null })).toMatchObject({ attendanceDays: 8, accruedCommission: null, estimatedPayable: null, dataIssues: ['营业收入待更新'] });
  });

  it('loads the current employee estimate with an explicit cutoff date', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: estimate, error: null });
    const result = await loadMyPayrollEstimate({ rpc } as never, 'p1', '2026-07-17');
    expect(rpc).toHaveBeenCalledWith('get_payroll_estimate', { p_profile_id: 'p1', p_as_of: '2026-07-17' });
    expect(result.displayName).toBe('李天欣');
  });

  it('loads the administrator total and passes the selected store as a filter', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { items: [estimate], employeeCount: 1, completeCount: 0, incompleteCount: 1, knownEstimatedTotal: 1800, completeEstimatedTotal: 0 }, error: null });
    const result = await loadAdminPayrollEstimates({ rpc } as never, { asOf: '2026-07-17', storeId: 's1', search: '李' });
    expect(rpc).toHaveBeenCalledWith('admin_payroll_estimates', { p_as_of: '2026-07-17', p_store_id: 's1', p_search: '李' });
    expect(result.knownEstimatedTotal).toBe(1800);
  });
});
