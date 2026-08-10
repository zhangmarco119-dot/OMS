import type { SupabaseClient } from '@supabase/supabase-js';

import type { PayrollEstimate } from '../features/payroll/model';
import type { Database, Json } from '../types/database';
import { loadAdminPayrollEstimates, parsePayrollEstimate } from './payroll.service';

type Client = SupabaseClient<Database>;

export interface PayrollStatisticsPeriod {
  breakdown: PayrollStatisticsBreakdown;
  estimate: PayrollEstimate;
  from: string;
  hours: number;
  payrollMonth: string;
  payslipId: string | null;
  payslipStatus: 'draft' | 'issued' | 'confirmed' | null;
  salaryCost: number;
  source: 'payslip' | 'realtime';
  to: string;
}

export interface PayrollStatisticsEmployee {
  averageHourlyCost: number | null;
  breakdown: PayrollStatisticsBreakdown;
  displayName: string;
  employmentType: 'full_time' | 'part_time';
  hours: number;
  periods: PayrollStatisticsPeriod[];
  profileId: string;
  salaryCost: number;
}

export interface PayrollStatisticsBreakdown {
  baseSalary: number;
  commission: number;
  extraAttendanceBonus: number;
  extraReward: number;
  fines: number;
  fullAttendanceBonus: number;
  grossIncome: number;
  housingAllowance: number;
  individualIncomeTax: number;
  netPayable: number;
  overtime: number;
  partTimeWage: number;
  performance: number;
  serviceAward: number;
}

export interface PayrollStatisticsStore {
  averageHourlyCost: number | null;
  hours: number;
  name: string;
  payrollShare: number | null;
  payrollToRevenueRatio: number | null;
  revenue: number;
  salaryCost: number;
  storeId: string;
}

export interface PayrollStatistics {
  averageHourlyCost: number | null;
  employees: PayrollStatisticsEmployee[];
  from: string;
  overallPayrollRatio: number | null;
  stores: PayrollStatisticsStore[];
  to: string;
  totalHours: number;
  totalRevenue: number;
  totalSalaryCost: number;
}

interface ProfileInput {
  displayName: string;
  employmentType: 'full_time' | 'part_time';
  id: string;
  primaryStoreId: string;
}

interface StoreInput { id: string; name: string }
interface WorkInput { attendanceHours: number; overtimeCost: number; overtimeHours: number; payrollMonth: string; profileId: string; storeId: string }
interface PayslipInput { estimate: PayrollEstimate; id: string; payrollMonth: string; profileId: string; status: 'draft' | 'issued' | 'confirmed' }

const objectAt = (value: Json | null | undefined): Record<string, Json | undefined> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const arrayAt = (value: Json | undefined) => Array.isArray(value) ? value : [];
const textAt = (value: Json | undefined) => typeof value === 'string' ? value : '';
const numberAt = (value: Json | undefined) => typeof value === 'number' ? value : typeof value === 'string' ? Number(value) || 0 : 0;
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const hours = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const toDate = (value: string) => new Date(`${value}T00:00:00Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (value: string, count: number) => { const date = toDate(value); date.setUTCDate(date.getUTCDate() + count); return iso(date); };
const monthStart = (value: string) => `${value.slice(0, 7)}-01`;
const monthEnd = (value: string) => { const [year, month] = value.slice(0, 7).split('-').map(Number); return iso(new Date(Date.UTC(year, month, 0))); };
const later = (left: string, right: string) => left > right ? left : right;
const earlier = (left: string, right: string) => left < right ? left : right;

function monthSegments(from: string, to: string) {
  const segments: Array<{ from: string; month: string; monthEnd: string; to: string }> = [];
  const cursor = toDate(monthStart(from));
  const last = monthStart(to);
  while (iso(cursor) <= last) {
    const month = iso(cursor);
    const end = monthEnd(month);
    segments.push({ from: later(from, month), month, monthEnd: end, to: earlier(to, end) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return segments;
}

const emptyBreakdown = (): PayrollStatisticsBreakdown => ({
  baseSalary: 0, commission: 0, extraAttendanceBonus: 0, extraReward: 0, fines: 0,
  fullAttendanceBonus: 0, grossIncome: 0, housingAllowance: 0, individualIncomeTax: 0,
  netPayable: 0, overtime: 0, partTimeWage: 0, performance: 0, serviceAward: 0,
});

const breakdownFromEstimate = (estimate: PayrollEstimate | undefined, formal = false): PayrollStatisticsBreakdown => {
  if (!estimate) return emptyBreakdown();
  const values = {
    baseSalary: estimate.accruedBaseSalary,
    commission: estimate.accruedCommission ?? 0,
    extraAttendanceBonus: estimate.accruedExtraAttendanceBonus,
    extraReward: estimate.accruedExtraReward,
    fines: estimate.fineTotal,
    fullAttendanceBonus: estimate.accruedFullAttendanceBonus,
    housingAllowance: estimate.accruedHousingAllowance,
    individualIncomeTax: formal
      ? estimate.registeredIndividualIncomeTax ?? estimate.individualIncomeTax ?? estimate.estimatedIndividualIncomeTax ?? 0
      : estimate.estimatedIndividualIncomeTax ?? estimate.individualIncomeTax ?? 0,
    overtime: estimate.accruedOvertime,
    partTimeWage: estimate.accruedPartTimeWage,
    performance: estimate.accruedPerformance ?? 0,
    serviceAward: estimate.accruedServiceAward,
  };
  const grossIncome = money(values.baseSalary + values.housingAllowance + values.performance + values.fullAttendanceBonus
    + values.extraAttendanceBonus + values.serviceAward + values.extraReward + values.commission + values.overtime + values.partTimeWage);
  return { ...values, grossIncome, netPayable: money(Math.max(grossIncome - values.fines - values.individualIncomeTax, 0)) };
};

const subtractBreakdown = (end: PayrollStatisticsBreakdown, start?: PayrollStatisticsBreakdown): PayrollStatisticsBreakdown => {
  const result = emptyBreakdown();
  const keys = Object.keys(result) as Array<keyof PayrollStatisticsBreakdown>;
  for (const key of keys) result[key] = money(Math.max(end[key] - (start?.[key] ?? 0), 0));
  result.grossIncome = money(result.baseSalary + result.housingAllowance + result.performance + result.fullAttendanceBonus
    + result.extraAttendanceBonus + result.serviceAward + result.extraReward + result.commission + result.overtime + result.partTimeWage);
  result.netPayable = money(Math.max(result.grossIncome - result.fines - result.individualIncomeTax, 0));
  return result;
};

const addBreakdown = (left: PayrollStatisticsBreakdown, right: PayrollStatisticsBreakdown): PayrollStatisticsBreakdown => {
  const result = emptyBreakdown();
  for (const key of Object.keys(result) as Array<keyof PayrollStatisticsBreakdown>) result[key] = money(left[key] + right[key]);
  return result;
};

function splitCents(total: number, weights: Map<string, number>, fallbackStoreId: string) {
  const totalCents = Math.max(Math.round(total * 100), 0);
  const positive = [...weights.entries()].filter(([, weight]) => weight > 0);
  const entries = positive.length ? positive : fallbackStoreId ? [[fallbackStoreId, 1] as [string, number]] : [];
  if (!entries.length) return new Map<string, number>();
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const parts = entries.map(([storeId, weight]) => {
    const exact = totalCents * weight / totalWeight;
    return { cents: Math.floor(exact), fraction: exact - Math.floor(exact), storeId };
  });
  let remainder = totalCents - parts.reduce((sum, item) => sum + item.cents, 0);
  parts.sort((a, b) => b.fraction - a.fraction || a.storeId.localeCompare(b.storeId));
  for (let index = 0; remainder > 0; index = (index + 1) % parts.length) { parts[index].cents += 1; remainder -= 1; }
  return new Map(parts.map((item) => [item.storeId, item.cents / 100]));
}

function parseInputs(value: Json) {
  const root = objectAt(value);
  const profiles = arrayAt(root.profiles).map((entry): ProfileInput => {
    const row = objectAt(entry);
    return {
      displayName: textAt(row.displayName),
      employmentType: row.employmentType === 'part_time' ? 'part_time' : 'full_time',
      id: textAt(row.id),
      primaryStoreId: textAt(row.primaryStoreId),
    };
  });
  const stores = arrayAt(root.stores).map((entry): StoreInput => { const row = objectAt(entry); return { id: textAt(row.id), name: textAt(row.name) }; });
  const work = arrayAt(root.work).map((entry): WorkInput => {
    const row = objectAt(entry);
    return { attendanceHours: numberAt(row.attendanceHours), overtimeCost: numberAt(row.overtimeCost), overtimeHours: numberAt(row.overtimeHours), payrollMonth: textAt(row.payrollMonth), profileId: textAt(row.profileId), storeId: textAt(row.storeId) };
  });
  const revenues = new Map(arrayAt(root.revenues).map((entry) => { const row = objectAt(entry); return [textAt(row.storeId), numberAt(row.amount)] as const; }));
  const payslips = arrayAt(root.payslips).flatMap((entry): PayslipInput[] => {
    const row = objectAt(entry); const status = textAt(row.status);
    if (status !== 'draft' && status !== 'issued' && status !== 'confirmed') return [];
    return [{ estimate: parsePayrollEstimate(row.estimate ?? {}), id: textAt(row.id), payrollMonth: textAt(row.payrollMonth), profileId: textAt(row.profileId), status }];
  });
  return { payslips, profiles, revenues, stores, work };
}

export async function loadPayrollStatistics(client: Client, from: string, to: string): Promise<PayrollStatistics> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error('请选择有效的统计时间范围。');
  const { data, error } = await client.rpc('admin_payroll_statistics_inputs', { p_from: from, p_to: to });
  if (error) throw new Error(error.message || '暂时无法加载薪资综合统计。');
  const input = parseInputs(data ?? {});
  const segments = monthSegments(from, to);
  const estimatePairs = await Promise.all(segments.map(async (segment) => {
    const end = await loadAdminPayrollEstimates(client, { asOf: segment.to });
    const start = segment.from === segment.month
      ? null
      : await loadAdminPayrollEstimates(client, { asOf: addDays(segment.from, -1) });
    return { end, segment, start };
  }));

  const employeeMap = new Map<string, PayrollStatisticsEmployee>();
  const storeCosts = new Map(input.stores.map((store) => [store.id, { cost: 0, hours: 0 }]));
  const payslipByKey = new Map(input.payslips.map((item) => [`${item.profileId}:${item.payrollMonth}`, item]));

  for (const { end, segment, start } of estimatePairs) {
    const endByProfile = new Map(end.items.map((item) => [item.profileId, item]));
    const startByProfile = new Map(start?.items.map((item) => [item.profileId, item]) ?? []);
    for (const profile of input.profiles) {
      const fullMonth = segment.from === segment.month && segment.to === segment.monthEnd;
      const formal = fullMonth ? payslipByKey.get(`${profile.id}:${segment.month}`) : undefined;
      const endEstimate = formal?.estimate ?? endByProfile.get(profile.id);
      if (!endEstimate) continue;
      const startEstimate = formal ? undefined : startByProfile.get(profile.id);
      const breakdown = formal
        ? breakdownFromEstimate(formal.estimate, true)
        : subtractBreakdown(breakdownFromEstimate(endEstimate), startEstimate ? breakdownFromEstimate(startEstimate) : undefined);
      const salaryCost = money(Math.max(breakdown.grossIncome - breakdown.fines, 0));
      const monthWork = input.work.filter((row) => row.payrollMonth === segment.month && row.profileId === profile.id);
      const attendanceHours = monthWork.reduce((sum, row) => sum + row.attendanceHours, 0);
      const overtimeHours = monthWork.reduce((sum, row) => sum + row.overtimeHours, 0);
      const periodHours = hours(attendanceHours + overtimeHours);
      if (salaryCost <= 0 && periodHours <= 0) continue;

      const period: PayrollStatisticsPeriod = {
        breakdown,
        estimate: endEstimate,
        from: segment.from,
        hours: periodHours,
        payrollMonth: segment.month,
        payslipId: formal?.id ?? null,
        payslipStatus: formal?.status ?? null,
        salaryCost,
        source: formal ? 'payslip' : 'realtime',
        to: segment.to,
      };
      const current = employeeMap.get(profile.id) ?? {
        averageHourlyCost: null,
        breakdown: emptyBreakdown(),
        displayName: profile.displayName,
        employmentType: profile.employmentType,
        hours: 0,
        periods: [],
        profileId: profile.id,
        salaryCost: 0,
      };
      current.hours = hours(current.hours + periodHours);
      current.salaryCost = money(current.salaryCost + salaryCost);
      current.breakdown = addBreakdown(current.breakdown, breakdown);
      current.periods.push(period);
      employeeMap.set(profile.id, current);

      const attendanceWeights = new Map(monthWork.map((row) => [row.storeId, row.attendanceHours]));
      const overtimeWeights = new Map(monthWork.map((row) => [row.storeId, row.overtimeCost > 0 ? row.overtimeCost : row.overtimeHours]));
      const overtimeComponent = formal
        ? Math.min(salaryCost, Math.max(formal.estimate.accruedOvertime, profile.employmentType === 'part_time' ? formal.estimate.accruedPartTimeWage : 0))
        : Math.min(salaryCost, Math.max((endEstimate.accruedOvertime + (profile.employmentType === 'part_time' ? endEstimate.accruedPartTimeWage : 0)) - ((startEstimate?.accruedOvertime ?? 0) + (profile.employmentType === 'part_time' ? startEstimate?.accruedPartTimeWage ?? 0 : 0)), 0));
      const baseCost = profile.employmentType === 'part_time' ? 0 : money(Math.max(salaryCost - overtimeComponent, 0));
      const overtimeCost = profile.employmentType === 'part_time' ? salaryCost : money(salaryCost - baseCost);
      const baseParts = splitCents(baseCost, attendanceWeights, profile.primaryStoreId);
      const overtimeParts = splitCents(overtimeCost, overtimeWeights, profile.primaryStoreId);
      for (const storeId of new Set([...baseParts.keys(), ...overtimeParts.keys(), ...monthWork.map((row) => row.storeId)])) {
        const store = storeCosts.get(storeId) ?? { cost: 0, hours: 0 };
        store.cost = money(store.cost + (baseParts.get(storeId) ?? 0) + (overtimeParts.get(storeId) ?? 0));
        store.hours = hours(store.hours + monthWork.filter((row) => row.storeId === storeId).reduce((sum, row) => sum + row.attendanceHours + row.overtimeHours, 0));
        storeCosts.set(storeId, store);
      }
    }
  }

  const employees = [...employeeMap.values()].map((employee) => ({
    ...employee,
    averageHourlyCost: employee.hours > 0 ? money(employee.salaryCost / employee.hours) : null,
    periods: employee.periods.sort((left, right) => left.payrollMonth.localeCompare(right.payrollMonth)),
  })).sort((left, right) => right.salaryCost - left.salaryCost || left.displayName.localeCompare(right.displayName, 'zh-CN'));
  const totalSalaryCost = money(employees.reduce((sum, employee) => sum + employee.salaryCost, 0));
  const totalHours = hours(employees.reduce((sum, employee) => sum + employee.hours, 0));
  const stores = input.stores.map((store): PayrollStatisticsStore => {
    const values = storeCosts.get(store.id) ?? { cost: 0, hours: 0 };
    const revenue = money(input.revenues.get(store.id) ?? 0);
    return {
      averageHourlyCost: values.hours > 0 ? money(values.cost / values.hours) : null,
      hours: values.hours,
      name: store.name,
      payrollShare: totalSalaryCost > 0 ? values.cost / totalSalaryCost : null,
      payrollToRevenueRatio: revenue > 0 ? values.cost / revenue : null,
      revenue,
      salaryCost: values.cost,
      storeId: store.id,
    };
  }).sort((left, right) => right.salaryCost - left.salaryCost || left.name.localeCompare(right.name, 'zh-CN'));
  const totalRevenue = money(stores.reduce((sum, store) => sum + store.revenue, 0));
  return {
    averageHourlyCost: totalHours > 0 ? money(totalSalaryCost / totalHours) : null,
    employees,
    from,
    overallPayrollRatio: totalRevenue > 0 ? totalSalaryCost / totalRevenue : null,
    stores,
    to,
    totalHours,
    totalRevenue,
    totalSalaryCost,
  };
}
