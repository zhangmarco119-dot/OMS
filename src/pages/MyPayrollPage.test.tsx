import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MyPayrollPage } from './MyPayrollPage';

const mocks = vi.hoisted(() => ({
  loadEstimate: vi.fn(),
  loadSettings: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'profile-1' } }) }));
vi.mock('../features/payroll/PayrollEstimateView', () => ({ PayrollEstimateView: () => <div>工资明细</div> }));
vi.mock('../services/payroll.service', () => ({
  confirmPayrollPayslip: vi.fn(),
  loadMyPayrollEstimate: mocks.loadEstimate,
  loadMyPayrollPayslips: vi.fn().mockResolvedValue([]),
  loadPayrollVisibilitySettings: mocks.loadSettings,
}));

describe('MyPayrollPage month picker', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date(2026, 6, 18, 12, 0, 0));
    vi.clearAllMocks();
  });

  it('keeps the previous month selected while the estimate reloads', async () => {
    mocks.loadSettings.mockResolvedValue({ historyAvailableUntilDay: 31, historyMonths: 1, historyOpenNow: true });
    mocks.loadEstimate.mockResolvedValue({});
    render(<MemoryRouter><MyPayrollPage /></MemoryRouter>);
    const currentMonthButton = await screen.findByRole('button', { name: /2026年07月/ });
    await waitFor(() => expect(currentMonthButton).not.toBeDisabled());
    fireEvent.click(currentMonthButton);
    fireEvent.click(screen.getByRole('button', { name: '6 月' }));
    await waitFor(() => expect(mocks.loadEstimate).toHaveBeenLastCalledWith(expect.anything(), 'profile-1', '2026-06-30'));
    expect(screen.getByRole('button', { name: /2026年06月/ })).toBeInTheDocument();
  });

  it('shows estimate and payslip pages under My Payroll', async () => {
    mocks.loadSettings.mockResolvedValue({ historyAvailableUntilDay: 31, historyMonths: 1, historyOpenNow: true });
    mocks.loadEstimate.mockResolvedValue({});
    render(<MemoryRouter><MyPayrollPage /></MemoryRouter>);
    await screen.findByText('工资明细');
    expect(screen.getByRole('button', { name: '预估薪资' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '工资单' })).toBeInTheDocument();
    expect(screen.queryByText(/日前.*查看前/)).not.toBeInTheDocument();
  });

  it('uses a concise empty-state description before a payslip is sent', async () => {
    mocks.loadSettings.mockResolvedValue({ historyAvailableUntilDay: 31, historyMonths: 1, historyOpenNow: true });
    mocks.loadEstimate.mockResolvedValue({});
    render(<MemoryRouter initialEntries={['/app/payroll?tab=payslips']}><MyPayrollPage /></MemoryRouter>);
    expect(await screen.findByText('暂未推送')).toBeInTheDocument();
    expect(screen.queryByText(/每月.*自动/)).not.toBeInTheDocument();
  });
});
