import { describe, expect, it, vi } from 'vitest';

import { addPayrollPenalty, loadAdminPayrollEstimates, loadMyPayrollEstimate, parsePayrollEstimate, reviewOvertimeRequest, saveOvertimeRate, submitOvertimeRequest } from './payroll.service';

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

  it('submits and reviews overtime through the permission-protected RPCs', async () => {
    const request = { id: 'o1', profile_id: 'p1', store_id: 's1', overtime_date: '2026-07-17', hours: 2, reason: '闭店盘点', status: 'pending' };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: request, error: null })
      .mockResolvedValueOnce({ data: { ...request, status: 'approved', approved_hourly_rate: 25 }, error: null });
    await expect(submitOvertimeRequest({ rpc } as never, { storeId: 's1', overtimeDate: '2026-07-17', hours: 2, reason: '闭店盘点' })).resolves.toMatchObject({ id: 'o1' });
    await expect(reviewOvertimeRequest({ rpc } as never, 'o1', 'approved', '')).resolves.toMatchObject({ status: 'approved' });
    expect(rpc).toHaveBeenNthCalledWith(1, 'submit_payroll_overtime_request', { p_store_id: 's1', p_overtime_date: '2026-07-17', p_hours: 2, p_reason: '闭店盘点' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'review_payroll_overtime_request', { p_request_id: 'o1', p_action: 'approved', p_note: '' });
  });

  it('saves the configurable overtime rate and publishes penalties through RPCs', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 'rate-1', error: null })
      .mockResolvedValueOnce({ data: { id: 'penalty-1', event_level: 'warning', performance_deduction: 3 }, error: null });
    await saveOvertimeRate({ rpc } as never, { hourlyRate: 25, effectiveFrom: '2026-07-17', changeReason: '' });
    await expect(addPayrollPenalty({ rpc } as never, { profileId: 'p1', eventDate: '2026-07-17', reason: '测试', amount: 0, eventLevel: 'warning', performanceDeduction: 3 })).resolves.toMatchObject({ id: 'penalty-1' });
    expect(rpc).toHaveBeenNthCalledWith(1, 'admin_save_payroll_overtime_rate', { p_hourly_rate: 25, p_effective_from: '2026-07-17', p_change_reason: '' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'admin_create_payroll_penalty', { p_fields: { profileId: 'p1', eventDate: '2026-07-17', reason: '测试', amount: 0, eventLevel: 'warning', performanceDeduction: 3 } });
  });
});
