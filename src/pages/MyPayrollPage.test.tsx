import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { MyPayrollPage } from './MyPayrollPage';

const mocks = vi.hoisted(() => ({
  loadEstimate: vi.fn(),
  loadSettings: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'profile-1' } }) }));
vi.mock('../features/payroll/PayrollEstimateView', () => ({ PayrollEstimateView: () => <div>工资明细</div> }));
vi.mock('../services/payroll.service', () => ({
  loadMyPayrollEstimate: mocks.loadEstimate,
  loadPayrollVisibilitySettings: mocks.loadSettings,
}));

describe('MyPayrollPage month picker', () => {
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
});
