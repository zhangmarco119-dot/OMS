import type { PayrollEstimate } from '../payroll/model';

export interface CostAllocationPayslip {
  estimate: PayrollEstimate;
  profileId: string;
  status: 'draft' | 'issued' | 'confirmed' | 'withdrawn';
  storeId: string | null;
}

export interface CostAttendanceEntry {
  attendanceDate: string;
  isAttended: boolean;
  profileId: string;
  storeId: string;
}

export interface CostOvertimeEntry {
  approvedHourlyRate: number | null;
  hours: number;
  profileId: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  storeId: string;
}

export interface EmployeeStoreAllocation {
  amount: number;
  attendanceDays: number;
  overtimeHours: number;
  profileId: string;
  storeId: string;
}

export interface StoreCostAllocation {
  amount: number;
  employees: EmployeeStoreAllocation[];
  storeId: string;
}

export function includeEmptyStoreAllocations(
  storeIds: string[],
  allocations: StoreCostAllocation[],
): StoreCostAllocation[] {
  const byStore = new Map(allocations.map((item) => [item.storeId, item]));
  return storeIds.map((storeId) => byStore.get(storeId) ?? {
    amount: 0,
    employees: [],
    storeId,
  });
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const toCents = (value: number) => Math.max(0, Math.round((Number.isFinite(value) ? value : 0) * 100));

function splitCents(totalCents: number, weights: Map<string, number>, fallbackStoreId: string) {
  const positive = [...weights.entries()].filter(([, weight]) => weight > 0);
  const entries = positive.length ? positive : [[fallbackStoreId, 1] as [string, number]];
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const parts = entries.map(([storeId, weight]) => {
    const exact = totalCents * weight / totalWeight;
    return { storeId, cents: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remainder = totalCents - parts.reduce((sum, item) => sum + item.cents, 0);
  parts.sort((a, b) => b.fraction - a.fraction || a.storeId.localeCompare(b.storeId));
  for (let index = 0; remainder > 0; index = (index + 1) % parts.length) {
    parts[index].cents += 1;
    remainder -= 1;
  }
  return new Map(parts.map((item) => [item.storeId, item.cents]));
}

const payslipTotal = (estimate: PayrollEstimate) =>
  estimate.estimatedPayable ?? estimate.knownEstimatedPayable ?? 0;

export function allocatePayrollCosts(
  payslips: CostAllocationPayslip[],
  attendance: CostAttendanceEntry[],
  overtime: CostOvertimeEntry[],
): StoreCostAllocation[] {
  const activePayslips = payslips.filter((item) => item.status !== 'withdrawn');
  const allocations: EmployeeStoreAllocation[] = [];

  for (const payslip of activePayslips) {
    const estimate = payslip.estimate;
    const fallbackStoreId = estimate.primaryStoreId || payslip.storeId;
    if (!fallbackStoreId) continue;

    const dayKeys = new Set<string>();
    const attendanceWeights = new Map<string, number>();
    for (const row of attendance) {
      if (row.profileId !== payslip.profileId || !row.isAttended) continue;
      const key = `${row.storeId}:${row.attendanceDate}`;
      if (dayKeys.has(key)) continue;
      dayKeys.add(key);
      attendanceWeights.set(row.storeId, (attendanceWeights.get(row.storeId) ?? 0) + 1);
    }

    const overtimeRows = overtime.filter((row) => row.profileId === payslip.profileId && row.status === 'approved');
    const overtimeHours = new Map<string, number>();
    const overtimeWeights = new Map<string, number>();
    for (const row of overtimeRows) {
      overtimeHours.set(row.storeId, (overtimeHours.get(row.storeId) ?? 0) + row.hours);
      const weight = row.approvedHourlyRate == null ? row.hours : row.hours * row.approvedHourlyRate;
      overtimeWeights.set(row.storeId, (overtimeWeights.get(row.storeId) ?? 0) + weight);
    }

    const totalCents = toCents(payslipTotal(estimate));
    let centsByStore: Map<string, number>;
    if (estimate.employmentType === 'part_time') {
      centsByStore = splitCents(totalCents, overtimeWeights.size ? overtimeWeights : overtimeHours, fallbackStoreId);
    } else {
      const overtimeCents = Math.min(totalCents, toCents(estimate.accruedOvertime));
      const baseCents = totalCents - overtimeCents;
      const baseParts = splitCents(baseCents, attendanceWeights, fallbackStoreId);
      const overtimeParts = splitCents(overtimeCents, overtimeWeights.size ? overtimeWeights : overtimeHours, fallbackStoreId);
      const stores = new Set([...baseParts.keys(), ...overtimeParts.keys()]);
      centsByStore = new Map([...stores].map((storeId) => [
        storeId,
        (baseParts.get(storeId) ?? 0) + (overtimeParts.get(storeId) ?? 0),
      ]));
    }

    for (const [storeId, cents] of centsByStore) {
      if (cents === 0 && !attendanceWeights.has(storeId) && !overtimeHours.has(storeId)) continue;
      allocations.push({
        amount: cents / 100,
        attendanceDays: attendanceWeights.get(storeId) ?? 0,
        overtimeHours: money(overtimeHours.get(storeId) ?? 0),
        profileId: payslip.profileId,
        storeId,
      });
    }
  }

  const byStore = new Map<string, EmployeeStoreAllocation[]>();
  for (const item of allocations) {
    const current = byStore.get(item.storeId) ?? [];
    current.push(item);
    byStore.set(item.storeId, current);
  }
  return [...byStore.entries()].map(([storeId, employees]) => ({
    amount: money(employees.reduce((sum, item) => sum + item.amount, 0)),
    employees,
    storeId,
  })).sort((a, b) => a.storeId.localeCompare(b.storeId));
}
