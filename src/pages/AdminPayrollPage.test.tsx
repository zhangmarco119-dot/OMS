import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { loadAdminPayrollEstimates, loadAdminPayrollPayslips, loadPayrollAdminSetup, loadPayrollPenaltyAssetUrl, loadPayrollPayslipScheduleSettings, loadPayrollProfiles, loadPayrollVisibilitySettings, loadPosSalesSetup, savePayrollAttendanceAllocationRule } from '../services/payroll.service';
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
    loadPayrollPenaltyAssetUrl: vi.fn(),
    loadPayrollPayslipScheduleSettings: vi.fn(),
    loadPayrollProfiles: vi.fn(),
    loadPayrollVisibilitySettings: vi.fn(),
    loadPosSalesSetup: vi.fn(),
    savePayrollAttendanceAllocationRule: vi.fn(),
  };
});

const setup = {
  profiles: [], penaltyPublishers: [], rules: [], commissionStores: [], performanceStores: [], departureMonths: [], attendanceAllocationRules: [], profileStoreAccess: [], performanceRules: [], revenues: [], revenueInputs: [], penalties: [], penaltyAssets: [], overtimeRates: [], overtimeRequests: [],
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
    vi.setSystemTime(new Date(2026, 6, 18, 12, 0, 0));
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      availableStores: [{ id: 'store-1', name: '测试门店', short_name: '测试门店' }],
      profile: { id: 'admin-1', role: 'admin' },
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadAdminPayrollEstimates).mockResolvedValue({ items: [estimate as never], employeeCount: 1, completeCount: 0, incompleteCount: 1, knownEstimatedTotal: 2537.04, completeEstimatedTotal: 0 });
    vi.mocked(loadPayrollAdminSetup).mockResolvedValue(setup as never);
    vi.mocked(loadPayrollPayslipScheduleSettings).mockResolvedValue({ dayOfMonth:1,enabled:false,frequencyMonths:1,lastIssuedMonth:null,lastRunAt:null,sendTime:'09:00' });
    vi.mocked(loadPayrollProfiles).mockResolvedValue([{ id:'profile-1',display_name:'测试员工',role:'staff' }] as never);
    vi.mocked(loadPayrollVisibilitySettings).mockResolvedValue({ historyAvailableUntilDay: 10, historyMonths: 3, historyOpenNow: true });
    vi.mocked(loadAdminPayrollPayslips).mockResolvedValue([]);
    vi.mocked(loadPosSalesSetup).mockResolvedValue({ integrations: [], jobs: [] });
    vi.mocked(loadPayrollPenaltyAssetUrl).mockResolvedValue('blob:penalty-detail-default');
  });

  it('jumps from a revenue issue to the revenue maintenance tab', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/payroll?employee=profile-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route path="/app/admin/payroll" element={<AdminPayrollPage />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /营业收入待更新.*去更新/ }));
    expect(await screen.findByText('本月累计营业额')).toBeInTheDocument();
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
    expect(screen.getByText(/草稿会读取“个税登记”/)).toBeInTheDocument();
    expect(screen.queryByRole('button',{ name:/立即发放/ })).not.toBeInTheDocument();
    expect(screen.getByText('工资单自动推送')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '启用自动推送' })).not.toBeChecked();
  });

  it('opens a penalty detail immediately and loads its images in a secondary phase', async () => {
    let resolveImage: (url: string) => void = () => undefined;
    vi.mocked(loadPayrollPenaltyAssetUrl).mockReturnValue(new Promise((resolve) => { resolveImage = resolve; }));
    vi.mocked(loadPayrollAdminSetup).mockResolvedValue({
      ...setup,
      profiles: [{ display_name: '员工甲', employment_type: 'full_time', id: 'staff-1', role: 'staff' }],
      penaltyPublishers: [{ display_name: '王店长', id: 'manager-1', role: 'manager' }],
      penalties: [{ amount: 50, created_at: '2026-07-18T01:00:00Z', created_by: 'manager-1', event_date: '2026-07-18', event_level: 'warning', id: 'penalty-1', performance_deduction: 3, profile_id: 'staff-1', reason: '盘点差异，需承担对应损失。', revoke_reason: null, status: 'active', updated_at: '2026-07-18T01:00:00Z' }],
      penaltyAssets: [{ bucket: 'payroll-evidence', created_at: '2026-07-18T01:00:01Z', file_name: '现场证据.png', id: 'asset-1', mime_type: 'image/png', object_path: 'manager/penalty/image.png', penalty_id: 'penalty-1', size_bytes: 1024, uploaded_by: 'manager-1' }],
    } as never);
    render(<MemoryRouter initialEntries={['/app/admin/payroll?tab=penalties']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route path="/app/admin/payroll" element={<AdminPayrollPage />} /></Routes></MemoryRouter>);

    const penaltyCard = await screen.findByRole('button', { name: '查看 员工甲 的处罚详情' });
    expect(penaltyCard).toHaveTextContent('发布人：王店长 · 店长');
    expect(screen.queryByText('点击查看原因和图片')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销此记录' })).not.toBeInTheDocument();
    fireEvent.click(penaltyCard);
    expect(screen.getByRole('dialog', { name: '处罚记录详情' })).toBeInTheDocument();
    expect(screen.getByText('盘点差异，需承担对应损失。')).toBeInTheDocument();
    expect(screen.getByText('正在加载图片')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销此记录' })).toBeInTheDocument();

    await act(async () => resolveImage('blob:penalty-detail-image'));
    const image = await screen.findByRole('img', { name: '现场证据.png' });
    fireEvent.load(image);
    await waitFor(() => expect(screen.queryByText('正在加载图片')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '查看处罚图片 现场证据.png' }));
    expect(screen.getByRole('dialog', { name: '处罚详情图片预览' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销此记录' }));
    expect(screen.queryByRole('dialog', { name: '处罚记录详情' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '确认撤销处罚记录' })).toBeInTheDocument();
  });

  it('adds comprehensive statistics and merges visibility into employee parameters', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/payroll?tab=employees']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route path="/app/admin/payroll" element={<AdminPayrollPage />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('button', { name: '综合统计' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看期限' })).not.toBeInTheDocument();
    expect(await screen.findByText('员工历史工资查看期限')).toBeInTheDocument();
    expect(screen.getByText('离职月工资设置')).toBeInTheDocument();
    expect(screen.getByText(/最多连续两个月不核算绩效、提成和房补/)).toBeInTheDocument();
    expect(screen.getByText('跨店工时与薪资分配')).toBeInTheDocument();
    expect(screen.getByText(/同一天的普通工时和对应薪资成本会使用同一比例拆分/)).toBeInTheDocument();
  });

  it('loads and saves one employee fieldwork allocation rule', async () => {
    vi.mocked(useAuth).mockReturnValue({
      availableStores: [
        { id: 'store-1', name: 'OMEGA酸奶（西直门店）', short_name: 'OMEGA酸奶' },
        { id: 'store-2', name: '宝珠奶酪（五道口店）', short_name: '宝珠奶酪' },
      ],
      profile: { id: 'admin-1', role: 'admin' },
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadPayrollAdminSetup).mockResolvedValue({
      ...setup,
      profiles: [{ id: 'profile-1', display_name: '李天欣', employment_type: 'full_time', role: 'staff', store_id: 'store-1' }],
      profileStoreAccess: [{ profile_id: 'profile-1', store_id: 'store-1' }, { profile_id: 'profile-1', store_id: 'store-2' }],
      attendanceAllocationRules: [{ effective_from: '2026-01-01', effective_to: null, is_enabled: true, profile_id: 'profile-1', punch_scope: 'any', source_store_id: 'store-1', target_ratio: 0.5, target_store_id: 'store-2' }],
    } as never);
    vi.mocked(savePayrollAttendanceAllocationRule).mockResolvedValue('profile-1');
    render(<MemoryRouter initialEntries={['/app/admin/payroll?tab=employees']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route path="/app/admin/payroll" element={<AdminPayrollPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('checkbox', { name: '启用该员工的跨店分摊规则' })).toBeChecked();
    expect(screen.getByLabelText('排班门店')).toHaveValue('store-1');
    expect(screen.getByLabelText('分摊门店')).toHaveValue('store-2');
    fireEvent.change(screen.getByLabelText('分到另一门店（%）'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: '保存跨店分摊规则' }));
    await waitFor(() => expect(savePayrollAttendanceAllocationRule).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ profileId: 'profile-1', sourceStoreId: 'store-1', targetStoreId: 'store-2', targetRatio: 0.4 })));
  });

  it('offers one-click send and withdrawal for all eligible monthly payslips', async () => {
    vi.mocked(loadAdminPayrollPayslips).mockResolvedValue([
      { id: 'draft-1', profile_id: 'profile-1', payroll_month: '2026-07-01', status: 'draft', revision: 1, admin_note: '', estimate },
      { id: 'issued-1', profile_id: 'profile-2', payroll_month: '2026-07-01', status: 'issued', revision: 1, admin_note: '', estimate: { ...estimate, profileId: 'profile-2', displayName: '测试员工二' } },
    ] as never);
    render(<MemoryRouter initialEntries={['/app/admin/payroll?tab=payslips']} future={{ v7_relativeSplatPath:true,v7_startTransition:true }}><Routes><Route path="/app/admin/payroll" element={<AdminPayrollPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('button', { name: '一键发送全部（1）' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '一键撤回全部（1）' })).toBeEnabled();
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
