import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { loadAdminPayrollEstimates, loadAdminPayrollPayslips, loadPayrollAdminSetup, loadPayrollPayslipScheduleSettings, loadPayrollProfiles, loadPosSalesSetup } from '../services/payroll.service';
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
    loadPayrollPayslipScheduleSettings: vi.fn(),
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

describe('AdminPayrollPage update guidance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      availableStores: [{ id: 'store-1', name: '测试门店', short_name: '测试门店' }],
      profile: { id: 'admin-1', role: 'admin' },
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadAdminPayrollEstimates).mockResolvedValue({ items: [estimate as never], employeeCount: 1, completeCount: 0, incompleteCount: 1, knownEstimatedTotal: 2537.04, completeEstimatedTotal: 0 });
    vi.mocked(loadPayrollAdminSetup).mockResolvedValue(setup as never);
    vi.mocked(loadPayrollPayslipScheduleSettings).mockResolvedValue({ dayOfMonth:1,enabled:false,frequencyMonths:1,lastIssuedMonth:null,lastRunAt:null,sendTime:'09:00' });
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
    expect(screen.getByText('工资单自动推送')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '启用自动推送' })).not.toBeChecked();
  });

  it('offers administrators a direct employee overtime entry workflow', async () => {
    vi.mocked(loadPayrollAdminSetup).mockResolvedValue({
      ...setup,
      profiles: [
        { id: 'profile-1', display_name: '测试员工', employment_type: 'full_time', role: 'staff', store_id: 'store-1' },
        { id: 'profile-2', display_name: '测试兼职', employment_type: 'part_time', role: 'staff', store_id: 'store-1' },
      ],
    } as never);
    render(<MemoryRouter initialEntries={['/app/admin/payroll?tab=overtime']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route path="/app/admin/payroll" element={<AdminPayrollPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('手动登记加班/兼职工时')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登记加班工时' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '测试员工 · 员工' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '测试兼职 · 兼职员工' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('员工'), { target: { value: 'profile-2' } });
    expect(screen.getByRole('button', { name: '登记兼职工时' })).toBeInTheDocument();
    expect(screen.getByText('兼职日期')).toBeInTheDocument();
    expect(screen.getByText('批量导入员工加班')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载 Excel 模板' })).toBeInTheDocument();
  });

  it('returns from employee details to the filtered payroll list', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/payroll?tab=overview&date=2026-07-18&store=store-1&employee=profile-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route path="/app/admin/payroll" element={<><AdminPayrollPage /><LocationProbe /></>} /></Routes></MemoryRouter>);
    expect(await screen.findByText('测试员工')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/app/admin/payroll?tab=overview&date=2026-07-18&store=store-1'));
    expect(await screen.findByPlaceholderText('搜索员工姓名或账号')).toBeInTheDocument();
  });
});
