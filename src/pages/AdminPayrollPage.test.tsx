import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { loadAdminPayrollEstimates, loadAdminPayrollPayslips, loadPayrollAdminSetup, loadPayrollProfiles, loadPosSalesSetup } from '../services/payroll.service';
import { AdminPayrollPage } from './AdminPayrollPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/payroll.service', async (original) => {
  const actual = await original<typeof import('../services/payroll.service')>();
  return {
    ...actual,
    loadAdminPayrollEstimates: vi.fn(),
    loadAdminPayrollPayslips: vi.fn(),
    loadPayrollAdminSetup: vi.fn(),
    loadPayrollProfiles: vi.fn(),
    loadPosSalesSetup: vi.fn(),
  };
});

const setup = {
  profiles: [], rules: [], commissionStores: [], performanceRules: [], revenues: [], revenueInputs: [], penalties: [], penaltyAssets: [], overtimeRates: [], overtimeRequests: [],
};

const estimate = {
  profileId: 'profile-1', displayName: '测试员工', username: 'staff', primaryStoreId: 'store-1', asOf: '2026-07-18', monthStart: '2026-07-01', monthEnd: '2026-07-31',
  fullAttendanceDays: 27, attendanceDays: 10, ruleId: 'rule-1', ruleConfirmed: true, monthlyBaseSalary: 5500, monthlyHousingAllowance: 0,
  fullPerformanceAmount: 3000, commissionRate: .006, housingEnabled: false, performanceEnabled: true, performanceOverrideEnabled: false, performanceOverrideAmount: 0, performanceOverrideScore: null, performanceCalculationMode: 'automatic', commissionEnabled: true,
  fullAttendanceBonusEnabled: false, fullAttendanceBonusAmount: 0, fullAttendanceBonusAwarded: false, accruedFullAttendanceBonus: 0,
  extraAttendanceDays: 0, extraAttendanceBonusRate: 300, accruedExtraAttendanceBonus: 0,
  serviceAwardEnabled: false, serviceAwardAmount: 100, accruedServiceAward: 0, extraRewardAmount: 0, accruedExtraReward: 0,
  accruedBaseSalary: 2037.04, accruedHousingAllowance: 0, accruedPerformance: 500, accruedCommission: null,
  overtimeHours: 0, overtimeHourlyRate: 25, accruedOvertime: 0, lateCount: 0, lateMinutes: 0, lateFine: 0, otherFine: 0, fineTotal: 0, individualIncomeTax: 0, deductionTotal: 0, deductionItems: [],
  taskDueCount: 1, taskCompletedCount: 1, taskScore: 60, attendanceScore: 25, disciplineScore: 15, performanceScore: 100, performanceGrade: 'A',
  revenueTotal: 0, revenueEffectiveDate: null, revenueCarriedForward: false, performanceReady: true, commissionReady: false, dataComplete: false,
  incomeSubtotalKnown: 2537.04, knownEstimatedPayable: 2537.04, estimatedPayable: null,
  attendanceUpdatedAt: null, tasksUpdatedAt: null, revenueUpdatedAt: null, penaltiesUpdatedAt: null, overtimeUpdatedAt: null,
  dataIssues: ['营业收入待更新'],
};

describe('AdminPayrollPage update guidance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      availableStores: [{ id: 'store-1', name: '测试门店', short_name: '测试门店' }],
      profile: { id: 'admin-1', role: 'admin' },
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadAdminPayrollEstimates).mockResolvedValue({ items: [estimate as never], employeeCount: 1, completeCount: 0, incompleteCount: 1, knownEstimatedTotal: 2537.04, completeEstimatedTotal: 0 });
    vi.mocked(loadPayrollAdminSetup).mockResolvedValue(setup as never);
    vi.mocked(loadPayrollProfiles).mockResolvedValue([{ id:'profile-1',display_name:'测试员工',role:'staff' }] as never);
    vi.mocked(loadAdminPayrollPayslips).mockResolvedValue([]);
    vi.mocked(loadPosSalesSetup).mockResolvedValue({ integrations: [], jobs: [] });
  });

  it('jumps from a revenue issue to the revenue maintenance tab', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/payroll?employee=profile-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route path="/app/admin/payroll" element={<AdminPayrollPage />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /营业收入待更新.*去更新/ }));
    expect(await screen.findByText('本月累计营业额与提成基数')).toBeInTheDocument();
  });

  it('explains the active performance formula below the administrator controls', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/payroll?tab=performance']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route path="/app/admin/payroll" element={<AdminPayrollPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('绩效分计算细则')).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.tagName === 'LI' && Boolean(node.textContent?.includes('任务得分：当月已通过任务数')))).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.tagName === 'LI' && Boolean(node.textContent?.includes('全勤奖：员工启用后')))).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.tagName === 'LI' && Boolean(node.textContent?.includes('不与绩效金额合并')))).toBeInTheDocument();
  });

  it('lets an administrator select any historical payroll month', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/payroll']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route path="/app/admin/payroll" element={<AdminPayrollPage />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /2026年07月/ }));
    fireEvent.click(screen.getByRole('button', { name: '上一年' }));
    fireEvent.click(screen.getByRole('button', { name: '1 月' }));
    await waitFor(() => expect(vi.mocked(loadAdminPayrollEstimates)).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ asOf: '2025-01-31' })));
    expect(screen.getByRole('button', { name: /2025年01月/ })).toBeInTheDocument();
  });

  it('uses a preview-first payslip workflow', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/payroll?tab=payslips']} future={{ v7_relativeSplatPath:true,v7_startTransition:true }}><Routes><Route path="/app/admin/payroll" element={<AdminPayrollPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('生成工资单')).toBeInTheDocument();
    expect(screen.getByText(/先生成草稿并预览/)).toBeInTheDocument();
    expect(screen.queryByRole('button',{ name:/立即发放/ })).not.toBeInTheDocument();
  });
});
