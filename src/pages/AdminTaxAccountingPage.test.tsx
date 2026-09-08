import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { savePayrollIndividualTaxes } from '../services/payroll.service';
import { loadTaxAccountingData, saveTaxMonthlySalary, saveTaxPerson } from '../services/tax-accounting.service';
import { AdminTaxAccountingPage } from './AdminTaxAccountingPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/payroll.service', () => ({ savePayrollIndividualTaxes: vi.fn() }));
vi.mock('../services/tax-accounting.service', () => ({
  deleteTaxPerson: vi.fn(),
  getEmployeeIdCardUrl: vi.fn(),
  loadTaxAccountingData: vi.fn(),
  saveTaxMonthlySalary: vi.fn(),
  saveTaxPerson: vi.fn(),
  saveTaxStoreCompanyName: vi.fn(),
  uploadEmployeeIdCard: vi.fn(),
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
    vi.mocked(saveTaxPerson).mockImplementation(async (_client, _actor, input) => ({ id: input.id ?? 'new-person' }) as never);
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

  it('saves an unlinked person salary to the selected statistics month through the person editor', async () => {
    vi.mocked(loadTaxAccountingData).mockResolvedValue({
      ...data,
      people: [{
        bank_card_number: null, bank_name: null, contact_address: null, created_at: '', created_by: 'admin-1', full_name: '未绑定人员', id: 'person-1', id_card_image_path: null, id_number: '110101199001011234', is_active: true, phone: '13800138000', profile_id: null, reporting_store_id: null, updated_at: '', updated_by: 'admin-1',
      }],
    } as never);
    vi.mocked(saveTaxMonthlySalary).mockResolvedValue(undefined);
    render(<MemoryRouter><AdminTaxAccountingPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '2026年09月' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '统计月份选择器' })).getByRole('button', { name: '8 月' }));
    await waitFor(() => expect(loadTaxAccountingData).toHaveBeenLastCalledWith(expect.anything(), '2026-08'));

    fireEvent.click(screen.getByRole('tab', { name: '人员登记' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    expect(screen.getByRole('dialog', { name: '编辑人员资料' })).toHaveTextContent('2026年08月薪资来源');
    fireEvent.change(screen.getByPlaceholderText('请输入该月薪资'), { target: { value: '4800' } });
    fireEvent.click(screen.getByRole('button', { name: '保存资料' }));

    await waitFor(() => expect(saveTaxMonthlySalary).toHaveBeenCalledWith(expect.anything(), 'admin-1', 'person-1', '2026-08', 4800));
  });
});
