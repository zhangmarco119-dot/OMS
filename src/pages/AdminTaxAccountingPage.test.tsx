import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function LocationProbe() { const location = useLocation(); return <output data-testid="route">{location.pathname + location.search}</output>; }

describe('AdminTaxAccountingPage individual tax register', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-20T12:00:00+08:00'));
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(useAuth).mockReturnValue({ profile: { id: 'admin-1', role: 'admin' } } as never);
    vi.mocked(loadTaxAccountingData).mockResolvedValue(data as never);
    vi.mocked(savePayrollIndividualTaxes).mockResolvedValue({ month: '2026-08-01', reconfirmationCount: 0, savedCount: 1, syncedPayslipCount: 1 });
    vi.mocked(saveTaxPerson).mockImplementation(async (_client, _actor, input) => ({ id: input.id ?? 'new-person' }) as never);
  });

  afterEach(() => { vi.useRealTimers(); });

  const person = { id: 'person-1', full_name: '测试员工', id_number: '110101199001011234', phone: '13800138000', profile_id: 'profile-1', reporting_store_id: 'store-1', id_card_image_path: null };
  const report = (salarySource: 'system' | 'manual' | 'missing', amount: number | null) => ({ ...data, people: [person], stores: [{ id: 'store-1', name: '门店' }], taxReports: [{ store: { id: 'store-1', name: '门店' }, companyName: '公司', total: amount ?? 0, rows: [{ personId: person.id, fullName: person.full_name, salarySource, amount }] }], monthlySalaries: salarySource === 'manual' ? [{ person_id: person.id, manual_amount: amount }] : [] });

  it.each(['manual', 'missing'] as const)('opens %s salaries from the report and saves to the selected month before returning', async (source) => {
    vi.mocked(loadTaxAccountingData).mockResolvedValue(report(source, source === 'manual' ? 100 : null) as never);
    vi.mocked(saveTaxMonthlySalary).mockResolvedValue(undefined);
    render(<MemoryRouter initialEntries={['/app/admin/tax-accounting?tab=reports&month=2026-08']}><AdminTaxAccountingPage /><LocationProbe /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '测试员工的申报薪资' }));
    expect(screen.getByRole('dialog', { name: '填写申报薪资' })).toHaveTextContent('2026年08月');
    fireEvent.change(screen.getByPlaceholderText('请输入该月薪资'), { target: { value: '4800' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并返回' }));
    await waitFor(() => expect(saveTaxMonthlySalary).toHaveBeenCalledWith(expect.anything(), 'admin-1', 'person-1', '2026-08', 4800));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '填写申报薪资' })).not.toBeInTheDocument());
    expect(screen.getByTestId('route')).toHaveTextContent('/app/admin/tax-accounting?tab=reports&month=2026-08');
    expect(saveTaxPerson).not.toHaveBeenCalled();
  });

  it.each(['测试员工', '测试员工的申报薪资'])('opens system salary by clicking %s with the selected month and return context', async (label) => {
    vi.mocked(loadTaxAccountingData).mockResolvedValue(report('system', 5000) as never);
    render(<MemoryRouter initialEntries={['/app/admin/tax-accounting?tab=reports&month=2026-08']}><AdminTaxAccountingPage /><LocationProbe /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: label }));
    await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('/app/admin/payroll?tab=overview&date=2026-08-31&employee=profile-1&origin=tax-accounting&taxTab=reports'));
  });

  it('opens accounting allocations in the same month and preserves the accounting return tab', async () => {
    vi.mocked(loadTaxAccountingData).mockResolvedValue({ ...data, stores: [{ id: 'store-1', name: '门店' }], allocations: [{ storeId: 'store-1', amount: 5000, employees: [{ profileId: 'profile-1', amount: 5000, attendanceHours: 8, overtimeHours: 0 }] }] } as never);
    render(<MemoryRouter initialEntries={['/app/admin/tax-accounting?tab=accounting&month=2026-08']}><AdminTaxAccountingPage /><LocationProbe /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '测试员工的实时薪资' }));
    expect(screen.getByTestId('route')).toHaveTextContent('date=2026-08-31&employee=profile-1&origin=tax-accounting&taxTab=accounting');
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

    fireEvent.click(await screen.findByRole('button', { name: /^\d{4}年\d{2}月$/ }));
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
