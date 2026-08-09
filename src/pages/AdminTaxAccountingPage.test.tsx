import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { savePayrollIndividualTaxes } from '../services/payroll.service';
import { loadTaxAccountingData } from '../services/tax-accounting.service';
import { AdminTaxAccountingPage } from './AdminTaxAccountingPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/payroll.service', () => ({ savePayrollIndividualTaxes: vi.fn() }));
vi.mock('../services/tax-accounting.service', () => ({
  deleteTaxPerson: vi.fn(),
  loadTaxAccountingData: vi.fn(),
  saveTaxMonthlySalary: vi.fn(),
  saveTaxPerson: vi.fn(),
  saveTaxStoreCompanyName: vi.fn(),
}));

const data = {
  allocations: [], attendance: [], individualTaxes: [], monthlySalaries: [], overtime: [], people: [], storeSettings: [], stores: [], taxReports: [],
  profiles: [{ id: 'profile-1', display_name: '测试员工', username: 'staff-1', role: 'staff', employment_type: 'full_time' }],
  estimates: [{ profileId: 'profile-1', estimatedIndividualIncomeTax: 123.45 }],
};

describe('AdminTaxAccountingPage individual tax register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ profile: { id: 'admin-1', role: 'admin' } } as never);
    vi.mocked(loadTaxAccountingData).mockResolvedValue(data as never);
    vi.mocked(savePayrollIndividualTaxes).mockResolvedValue({ month: '2026-08-01', reconfirmationCount: 0, savedCount: 1, syncedPayslipCount: 1 });
  });

  it('registers actual monthly tax and explains payslip synchronization', async () => {
    render(<MemoryRouter><AdminTaxAccountingPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: '个税登记' }));
    expect(screen.getByText(/保存后会同步工资单/)).toBeInTheDocument();
    expect(screen.getByText(/系统预计.*¥123.45/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('测试员工实际个税'), { target: { value: '88.50' } });
    fireEvent.click(screen.getByRole('button', { name: '保存已填写个税' }));
    await waitFor(() => expect(savePayrollIndividualTaxes).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^\d{4}-\d{2}$/), [{ amount: 88.5, profileId: 'profile-1' }]));
  });
});
