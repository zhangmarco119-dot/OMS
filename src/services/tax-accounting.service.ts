import type { SupabaseClient } from '@supabase/supabase-js';

import { allocatePayrollCosts, includeEmptyStoreAllocations, type StoreCostAllocation } from '../features/tax-accounting/allocation';
import type { Database } from '../types/database';
import { loadAdminPayrollPayslips, loadPayrollProfiles, type PayrollPayslip } from './payroll.service';

type Client = SupabaseClient<Database>;
export type TaxPerson = Database['public']['Tables']['tax_reporting_people']['Row'];
export type TaxMonthlySalary = Database['public']['Tables']['tax_reporting_monthly_salaries']['Row'];
export type TaxStoreSetting = Database['public']['Tables']['tax_reporting_store_settings']['Row'];
export type TaxStore = Database['public']['Tables']['stores']['Row'];
export type TaxProfile = Database['public']['Tables']['profiles']['Row'];

export interface TaxReportRow {
  amount: number | null;
  fullName: string;
  idNumber: string;
  personId: string;
  phone: string;
  salarySource: 'payslip' | 'manual' | 'missing';
}

export interface TaxStoreReport {
  companyName: string;
  rows: TaxReportRow[];
  store: TaxStore;
  total: number;
}

export interface TaxAccountingData {
  allocations: StoreCostAllocation[];
  attendance: Database['public']['Tables']['attendance_daily_records']['Row'][];
  monthlySalaries: TaxMonthlySalary[];
  overtime: Database['public']['Tables']['payroll_overtime_requests']['Row'][];
  payslips: PayrollPayslip[];
  people: TaxPerson[];
  profiles: TaxProfile[];
  storeSettings: TaxStoreSetting[];
  stores: TaxStore[];
  taxReports: TaxStoreReport[];
}

const monthBounds = (month: string) => {
  const start = `${month.slice(0, 7)}-01`;
  const [year, monthNumber] = month.slice(0, 7).split('-').map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return { end, start };
};

const payslipAmount = (payslip: PayrollPayslip | undefined) =>
  payslip?.estimate.estimatedPayable ?? payslip?.estimate.knownEstimatedPayable ?? null;

export function createTaxReports(
  stores: TaxStore[],
  people: TaxPerson[],
  monthlySalaries: TaxMonthlySalary[],
  payslips: PayrollPayslip[],
  storeSettings: TaxStoreSetting[] = [],
): TaxStoreReport[] {
  const salaryByPerson = new Map(monthlySalaries.map((row) => [row.person_id, row]));
  const settingByStore = new Map(storeSettings.map((row) => [row.store_id, row]));
  const payslipByProfile = new Map(
    payslips.filter((row) => row.status !== 'withdrawn').map((row) => [row.profile_id, row]),
  );
  return stores.map((store) => {
    const rows = people
      .filter((person) => person.is_active && person.reporting_store_id === store.id)
      .map((person): TaxReportRow => {
        const monthly = salaryByPerson.get(person.id);
        const payslip = person.profile_id ? payslipByProfile.get(person.profile_id) : undefined;
        const manualAmount = monthly?.manual_amount;
        const amount = manualAmount ?? payslipAmount(payslip);
        return {
          amount,
          fullName: person.full_name,
          idNumber: person.id_number,
          personId: person.id,
          phone: person.phone,
          salarySource: manualAmount != null ? 'manual' : payslip ? 'payslip' : 'missing',
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'zh-CN'));
    return {
      companyName: settingByStore.get(store.id)?.company_name.trim() || store.name,
      rows,
      store,
      total: Math.round(rows.reduce((sum, row) => sum + (row.amount ?? 0), 0) * 100) / 100,
    };
  }).filter((report) => report.rows.length > 0);
}

export async function loadTaxAccountingData(client: Client, month: string): Promise<TaxAccountingData> {
  const { start, end } = monthBounds(month);
  const [
    storesResult,
    settingsResult,
    peopleResult,
    salariesResult,
    profiles,
    payslips,
    attendanceResult,
    overtimeResult,
  ] = await Promise.all([
    client.from('stores').select('*').eq('is_active', true).order('name'),
    client.from('tax_reporting_store_settings').select('*'),
    client.from('tax_reporting_people').select('*').order('is_active', { ascending: false }).order('full_name'),
    client.from('tax_reporting_monthly_salaries').select('*').eq('payroll_month', start),
    loadPayrollProfiles(client),
    loadAdminPayrollPayslips(client, month),
    client.from('attendance_daily_records').select('*').gte('attendance_date', start).lte('attendance_date', end).eq('is_attended', true),
    client.from('payroll_overtime_requests').select('*').gte('overtime_date', start).lte('overtime_date', end).eq('status', 'approved'),
  ]);
  const firstError = storesResult.error || settingsResult.error || peopleResult.error || salariesResult.error || attendanceResult.error || overtimeResult.error;
  if (firstError) throw new Error(firstError.message || '暂时无法加载税务与记账信息。');

  const stores = storesResult.data ?? [];
  const storeSettings = settingsResult.data ?? [];
  const people = peopleResult.data ?? [];
  const monthlySalaries = salariesResult.data ?? [];
  const attendance = attendanceResult.data ?? [];
  const overtime = overtimeResult.data ?? [];
  const calculatedAllocations = allocatePayrollCosts(
    payslips.map((row) => ({ estimate: row.estimate, profileId: row.profile_id, status: row.status, storeId: row.store_id })),
    attendance.map((row) => ({ attendanceDate: row.attendance_date, isAttended: row.is_attended, profileId: row.profile_id, storeId: row.store_id })),
    overtime.map((row) => ({ approvedHourlyRate: row.approved_hourly_rate, hours: row.hours, profileId: row.profile_id, status: row.status, storeId: row.store_id })),
  );
  const allocations = includeEmptyStoreAllocations(stores.map((store) => store.id), calculatedAllocations);

  return {
    allocations,
    attendance,
    monthlySalaries,
    overtime,
    payslips,
    people,
    profiles,
    storeSettings,
    stores,
    taxReports: createTaxReports(stores, people, monthlySalaries, payslips, storeSettings),
  };
}

export interface SaveTaxPersonInput {
  fullName: string;
  id?: string;
  idNumber: string;
  isActive: boolean;
  phone: string;
  profileId: string | null;
  reportingStoreId: string | null;
}

export async function saveTaxPerson(client: Client, actorId: string, input: SaveTaxPersonInput) {
  const values = {
    full_name: input.fullName.trim(),
    id_number: input.idNumber.trim().toUpperCase(),
    is_active: input.isActive,
    phone: input.phone.trim(),
    profile_id: input.profileId,
    reporting_store_id: input.reportingStoreId,
    updated_by: actorId,
  };
  const { data, error } = input.id
    ? await client.from('tax_reporting_people').update(values).eq('id', input.id).select('*').single()
    : await client.from('tax_reporting_people').insert({ ...values, created_by: actorId }).select('*').single();
  if (error) throw new Error(error.message || '报税人员资料保存失败。');
  return data;
}

export async function saveTaxMonthlySalary(
  client: Client,
  actorId: string,
  personId: string,
  month: string,
  amount: number | null,
) {
  const payrollMonth = `${month.slice(0, 7)}-01`;
  if (amount == null) {
    const { error } = await client.from('tax_reporting_monthly_salaries')
      .delete().eq('person_id', personId).eq('payroll_month', payrollMonth);
    if (error) throw new Error(error.message || '恢复工资单金额失败。');
    return;
  }
  const { error } = await client.from('tax_reporting_monthly_salaries').upsert({
    manual_amount: amount,
    payroll_month: payrollMonth,
    person_id: personId,
    updated_by: actorId,
  }, { onConflict: 'person_id,payroll_month' });
  if (error) throw new Error(error.message || '本月报税薪资保存失败。');
}

export async function saveTaxStoreCompanyName(
  client: Client,
  actorId: string,
  storeId: string,
  companyName: string,
) {
  const value = companyName.trim();
  if (!value) throw new Error('公司名称不能为空。');
  const { error } = await client.from('tax_reporting_store_settings').upsert({
    company_name: value,
    store_id: storeId,
    updated_by: actorId,
  }, { onConflict: 'store_id' });
  if (error) throw new Error(error.message || '公司名称保存失败。');
}
