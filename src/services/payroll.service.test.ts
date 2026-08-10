import { describe, expect, it, vi } from 'vitest';

import { addPayrollPenalty, adminRecordOvertime, configurePosSalesIntegration, confirmPayrollPayslip, generatePayrollPayslips, invokePospalMonthlySalesSync, invokePospalSalesSync, loadAdminPayrollEstimates, loadMyPayrollEstimate, loadPayrollDeductionItems, loadPayrollPayslipScheduleSettings, loadPayrollVisibilitySettings, parsePayrollEstimate, reviewOvertimeRequest, saveOvertimeRate, savePayrollPayslipScheduleSettings, savePayrollPerformanceOverride, savePayrollRevenueInput, savePayrollVisibilitySettings, sendPayrollPayslip, sendPayrollPayslips, submitOvertimeRequest, updateOvertimeRequest, updatePayrollPayslip, withdrawPayrollPayslip, withdrawPayrollPayslips } from './payroll.service';

const estimate = { profileId: 'p1', displayName: '李天欣', attendanceDays: 8, fullAttendanceDays: 27, accruedBaseSalary: 1629.63, knownEstimatedPayable: 1800, dataComplete: false, dataIssues: ['营业收入待更新'] };

describe('payroll service', () => {
  it('parses nullable pending amounts without treating them as final zero', () => {
    expect(parsePayrollEstimate({ ...estimate, monthStart: '2026-07-01', accruedCommission: null, estimatedPayable: null, fullAttendanceBonusEnabled: true, fullAttendanceBonusAmount: 500, fullAttendanceBonusAwarded: false, accruedFullAttendanceBonus: 0, revenueEffectiveDate: '2026-07-16', revenueCarriedForward: true })).toMatchObject({ attendanceDays: 8, accruedCommission: null, estimatedPayable: null, fullAttendanceBonusEnabled: true, fullAttendanceBonusAmount: 500, fullAttendanceBonusAwarded: false, revenueEffectiveDate: '2026-07-16', revenueCarriedForward: true, dataIssues: ['2026年7月营业收入尚未录入，提成暂未计入'] });
  });

  it('preserves the departure-month exclusion marker from payroll calculation', () => {
    expect(parsePayrollEstimate({ ...estimate, departureMonthExcluded: true })).toMatchObject({ departureMonthExcluded: true });
  });

  it('loads the current employee estimate with an explicit cutoff date', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: estimate, error: null });
    const result = await loadMyPayrollEstimate({ rpc } as never, 'p1', '2026-07-17');
    expect(rpc).toHaveBeenCalledWith('get_payroll_estimate', { p_profile_id: 'p1', p_as_of: '2026-07-17' });
    expect(result.displayName).toBe('李天欣');
  });

  it('saves a performance score for one month and restores automatic calculation with null', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { mode: 'override' }, error: null });
    await savePayrollPerformanceOverride({ rpc } as never, 'p1', '2026-07', 88);
    await savePayrollPerformanceOverride({ rpc } as never, 'p1', '2026-07', null);
    expect(rpc).toHaveBeenNthCalledWith(1, 'admin_save_payroll_performance_override', { p_profile_id: 'p1', p_payroll_month: '2026-07-01', p_performance_score: 88 });
    expect(rpc).toHaveBeenNthCalledWith(2, 'admin_save_payroll_performance_override', { p_profile_id: 'p1', p_payroll_month: '2026-07-01', p_performance_score: null });
  });

  it('loads itemized payroll deductions for an employee or administrator', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: 'late:1', date: '2026-07-10', type: 'late', title: '迟到罚款', reason: '迟到 5 分钟', amount: 20 }], error: null });
    await expect(loadPayrollDeductionItems({ rpc } as never, 'p1', '2026-07-01', '2026-07-31')).resolves.toMatchObject([{ type: 'late', amount: 20 }]);
    expect(rpc).toHaveBeenCalledWith('get_payroll_deduction_items', { p_profile_id: 'p1', p_from: '2026-07-01', p_to: '2026-07-31' });
  });

  it('loads the administrator total and passes the selected store as a filter', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { items: [estimate], employeeCount: 1, completeCount: 0, incompleteCount: 1, knownEstimatedTotal: 1800, completeEstimatedTotal: 0 }, error: null });
    const result = await loadAdminPayrollEstimates({ rpc } as never, { asOf: '2026-07-17', storeId: 's1', search: '李' });
    expect(rpc).toHaveBeenCalledWith('admin_payroll_estimates', { p_as_of: '2026-07-17', p_store_id: 's1', p_search: '李' });
    expect(result.knownEstimatedTotal).toBe(1800);
  });

  it('generates draft payslips and lets employees confirm sent statements', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { generatedCount: 2, refreshedCount: 1, skippedSentCount: 1, month: '2026-06-01' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'slip-1', status: 'confirmed' }, error: null });
    await expect(generatePayrollPayslips({ rpc } as never, '2026-06')).resolves.toMatchObject({ generatedCount: 2, refreshedCount: 1, skippedSentCount: 1 });
    await confirmPayrollPayslip({ rpc } as never, 'slip-1');
    expect(rpc).toHaveBeenNthCalledWith(1, 'admin_generate_payroll_payslips', { p_payroll_month: '2026-06-01', p_profile_ids: null });
    expect(rpc).toHaveBeenNthCalledWith(2, 'confirm_my_payroll_payslip', { p_payslip_id: 'slip-1' });
  });

  it('supports preview-first send, edit and withdrawal operations', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'slip-1' }, error: null });
    const fields = { accruedBaseSalary:3000,accruedHousingAllowance:500,accruedPerformance:300,accruedFullAttendanceBonus:0,accruedExtraAttendanceBonus:300,accruedServiceAward:100,accruedExtraReward:80,accruedCommission:80,accruedOvertime:50,fineTotal:20,individualIncomeTax:50,adminNote:'已核对' };
    await sendPayrollPayslip({ rpc } as never,'slip-1');
    await updatePayrollPayslip({ rpc } as never,'slip-1',fields);
    await withdrawPayrollPayslip({ rpc } as never,'slip-1');
    expect(rpc).toHaveBeenNthCalledWith(1,'admin_send_payroll_payslip',{ p_payslip_id:'slip-1' });
    expect(rpc).toHaveBeenNthCalledWith(2,'admin_update_payroll_payslip',{ p_payslip_id:'slip-1',p_fields:fields });
    expect(rpc).toHaveBeenNthCalledWith(3,'admin_withdraw_payroll_payslip',{ p_payslip_id:'slip-1' });
  });

  it('sends and withdraws multiple payslips in one atomic request', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { processedCount: 3 }, error: null })
      .mockResolvedValueOnce({ data: { processedCount: 2 }, error: null });
    await expect(sendPayrollPayslips({ rpc } as never, ['slip-1', 'slip-2', 'slip-3'])).resolves.toEqual({ processedCount: 3 });
    await expect(withdrawPayrollPayslips({ rpc } as never, ['slip-1', 'slip-2'])).resolves.toEqual({ processedCount: 2 });
    expect(rpc).toHaveBeenNthCalledWith(1, 'admin_send_payroll_payslips', { p_payslip_ids: ['slip-1', 'slip-2', 'slip-3'] });
    expect(rpc).toHaveBeenNthCalledWith(2, 'admin_withdraw_payroll_payslips', { p_payslip_ids: ['slip-1', 'slip-2'] });
  });

  it('loads and saves the employee historical-payroll viewing window', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { historyMonths: 3, historyAvailableUntilDay: 10, historyOpenNow: true }, error: null })
      .mockResolvedValueOnce({ data: { history_months: 6 }, error: null });
    await expect(loadPayrollVisibilitySettings({ rpc } as never)).resolves.toEqual({ historyMonths: 3, historyAvailableUntilDay: 10, historyOpenNow: true });
    await savePayrollVisibilitySettings({ rpc } as never, { historyMonths: 6, historyAvailableUntilDay: 15 });
    expect(rpc).toHaveBeenNthCalledWith(1, 'get_payroll_visibility_settings');
    expect(rpc).toHaveBeenNthCalledWith(2, 'admin_save_payroll_visibility_settings', { p_history_available_until_day: 15, p_history_months: 6 });
  });

  it('loads and saves the administrator-controlled payslip schedule', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { enabled:false,frequencyMonths:1,dayOfMonth:1,sendTime:'09:00',lastIssuedMonth:null,lastRunAt:null }, error:null })
      .mockResolvedValueOnce({ data: { enabled:true,frequencyMonths:2,dayOfMonth:5,sendTime:'10:30',lastIssuedMonth:null,lastRunAt:null }, error:null });
    await expect(loadPayrollPayslipScheduleSettings({ rpc } as never)).resolves.toMatchObject({ enabled:false,dayOfMonth:1 });
    await expect(savePayrollPayslipScheduleSettings({ rpc } as never, { enabled:true,frequencyMonths:2,dayOfMonth:5,sendTime:'10:30' })).resolves.toMatchObject({ enabled:true,frequencyMonths:2 });
    expect(rpc).toHaveBeenNthCalledWith(1,'get_payroll_payslip_schedule_settings');
    expect(rpc).toHaveBeenNthCalledWith(2,'admin_save_payroll_payslip_schedule_settings',{ p_enabled:true,p_frequency_months:2,p_day_of_month:5,p_send_time:'10:30' });
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

  it('lets an administrator record already-approved employee overtime', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'o-admin', status: 'approved', approved_hourly_rate: 25 }, error: null });
    await expect(adminRecordOvertime({ rpc } as never, {
      profileId: 'p1', storeId: 's1', overtimeDate: '2026-07-18', hours: 2.5, reason: '闭店盘点',
    })).resolves.toMatchObject({ status: 'approved' });
    expect(rpc).toHaveBeenCalledWith('admin_record_payroll_overtime', {
      p_profile_id: 'p1', p_store_id: 's1', p_overtime_date: '2026-07-18', p_hours: 2.5, p_reason: '闭店盘点',
    });
  });

  it('allows an optional description and sends revisions back through approval', async () => {
    const request = { id: 'o1', profile_id: 'p1', store_id: 's1', overtime_date: '2026-07-17', hours: 1.5, reason: '', status: 'pending' };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: request, error: null })
      .mockResolvedValueOnce({ data: { ...request, hours: 2 }, error: null });
    await submitOvertimeRequest({ rpc } as never, { storeId: 's1', overtimeDate: '2026-07-17', hours: 1.5 });
    await updateOvertimeRequest({ rpc } as never, 'o1', { storeId: 's1', overtimeDate: '2026-07-17', hours: 2 });
    expect(rpc).toHaveBeenNthCalledWith(1, 'submit_payroll_overtime_request', { p_store_id: 's1', p_overtime_date: '2026-07-17', p_hours: 1.5, p_reason: undefined });
    expect(rpc).toHaveBeenNthCalledWith(2, 'update_payroll_overtime_request', { p_request_id: 'o1', p_store_id: 's1', p_overtime_date: '2026-07-17', p_hours: 2, p_reason: undefined });
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

  it('saves a permission-protected POS schedule with the selected interval', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'pos-1', enabled: true }, error: null });
    await configurePosSalesIntegration({ rpc } as never, {
      id: 'pos-1', enabled: true, startHour: 10, endHour: 22, intervalMinutes: 30,
    });
    expect(rpc).toHaveBeenCalledWith('configure_pos_sales_integration', {
      p_enabled: true,
      p_end_hour: 22,
      p_integration_id: 'pos-1',
      p_interval_minutes: 30,
      p_start_hour: 10,
    });
  });

  it('requests a one-day Pospal sync and returns the verified result', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { results: [{ status: 'succeeded', ticketCount: 47, revenueAmount: 1006.51, apiCallCount: 1 }] },
      error: null,
    });
    const result = await invokePospalSalesSync({ functions: { invoke } } as never, 'pos-1', '2026-07-17');
    expect(invoke).toHaveBeenCalledWith('pospal-sales', {
      body: { action: 'manual-sync', integrationId: 'pos-1', date: '2026-07-17' },
    });
    expect(result).toMatchObject({ status: 'succeeded', ticketCount: 47, apiCallCount: 1 });
  });

  it('syncs month-to-date revenue and can select a manual cumulative source', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { results: [{ status: 'succeeded', syncDate: '2026-07-01', syncEndDate: '2026-07-17', ticketCount: 500, revenueAmount: 12000, apiCallCount: 5 }] },
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({ data: { input_mode: 'manual', manual_cumulative_amount: 11800 }, error: null });
    await expect(invokePospalMonthlySalesSync({ functions: { invoke } } as never, 'pos-1', '2026-07-17')).resolves.toMatchObject({ revenueAmount: 12000 });
    await savePayrollRevenueInput({ rpc } as never, { storeId: 's1', asOfDate: '2026-07-17', mode: 'manual', manualCumulativeAmount: 11800, note: '人工核对' });
    expect(invoke).toHaveBeenCalledWith('pospal-sales', { body: { action: 'manual-sync-month', integrationId: 'pos-1', endDate: '2026-07-17' } });
    expect(rpc).toHaveBeenCalledWith('save_payroll_store_revenue_input', {
      p_as_of_date: '2026-07-17', p_input_mode: 'manual', p_manual_cumulative_amount: 11800, p_note: '人工核对', p_store_id: 's1',
    });
  });
});
