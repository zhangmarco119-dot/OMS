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
    const input = screen.getByLabelText('查看月份') as HTMLInputElement;
    await waitFor(() => expect(input).not.toBeDisabled());
    const [year, month] = input.value.split('-').map(Number);
    const previous = new Date(year, month - 2, 1);
    const previousMonth = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
    fireEvent.change(input, { target: { value: previousMonth } });
    await waitFor(() => expect(mocks.loadEstimate).toHaveBeenLastCalledWith(expect.anything(), 'profile-1', `${previousMonth}-30`));
    expect(input.value).toBe(previousMonth);
    expect(input.min).toBe(previousMonth);
  });
});
