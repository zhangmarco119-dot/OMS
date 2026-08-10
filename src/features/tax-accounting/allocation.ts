import type { PayrollEstimate } from '../payroll/model';

export interface CostAllocationPayslip {
  estimate: PayrollEstimate;
  profileId: string;
  status: 'draft' | 'issued' | 'confirmed' | 'withdrawn';
  storeId: string | null;
}

export interface CostAttendanceEntry {
  actualOffAt: string | null;
  actualOnAt: string | null;
  attendanceDate: string;
  dailyStatus?: string;
  id: string;
  isAttended: boolean;
  offDutyResult?: string;
  onDutyResult?: string;
  plannedOffAt: string | null;
  plannedOnAt: string | null;
  profileId: string;
  storeId: string;
}

export interface CostAttendancePunch {
  checkType?: 'on_duty' | 'off_duty' | 'unknown';
  dailyRecordId: string;
  locationName: string | null;
  locationResult?: string | null;
  sourceType?: string | null;
  storeId: string;
}

export interface CostAttendanceAllocationRule {
  effectiveFrom: string;
  effectiveTo: string | null;
  isEnabled: boolean;
  profileId: string;
  punchScope: 'any' | 'on_duty' | 'off_duty';
  sourceStoreId: string;
  targetRatio: number;
  targetStoreId: string;
}

export interface CostStore {
  id: string;
  name: string;
  shortName: string;
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
  attendanceHours: number;
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
const hour = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const toCents = (value: number) => Math.max(0, Math.round((Number.isFinite(value) ? value : 0) * 100));

const normalizedLocation = (value: string) => value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\p{P}\p{S}\s]/gu, '');

function resolvePunchStoreId(punch: CostAttendancePunch, stores: CostStore[]) {
  const location = normalizedLocation(punch.locationName ?? '');
  if (!location) return punch.storeId;
  const matches = stores.filter((store) => {
    const fullName = normalizedLocation(store.name);
    const shortName = normalizedLocation(store.shortName);
    const shortBase = shortName.replace(/(?:门店|店)$/u, '');
    return (fullName.length >= 2 && location.includes(fullName))
      || (shortName.length >= 2 && location.includes(shortName))
      || (shortBase.length >= 2 && location.includes(shortBase));
  });
  return matches.length === 1 ? matches[0].id : punch.storeId;
}

function scheduledHours(row: CostAttendanceEntry) {
  const duration = (from: string | null, to: string | null) => {
    if (!from || !to) return null;
    const milliseconds = new Date(to).getTime() - new Date(from).getTime();
    return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds / 3_600_000 : null;
  };
  const value = duration(row.plannedOnAt, row.plannedOffAt) ?? duration(row.actualOnAt, row.actualOffAt) ?? 0;
  return Math.max(value - 1, 0);
}

const fieldworkPattern = /(outside|field|外勤)/iu;
const isFieldworkPunch = (punch: CostAttendancePunch) => fieldworkPattern.test(`${punch.sourceType ?? ''} ${punch.locationResult ?? ''}`);

function dayHasFieldwork(rows: CostAttendanceEntry[], punches: CostAttendancePunch[], scope: CostAttendanceAllocationRule['punchScope']) {
  const statusFieldwork = scope === 'on_duty'
    ? rows.some((row) => row.onDutyResult === 'fieldwork')
    : scope === 'off_duty'
      ? rows.some((row) => row.offDutyResult === 'fieldwork')
      : rows.some((row) => row.dailyStatus === 'fieldwork' || row.onDutyResult === 'fieldwork' || row.offDutyResult === 'fieldwork');
  if (statusFieldwork) return true;
  return punches.some((punch) => isFieldworkPunch(punch) && (scope === 'any' || punch.checkType === scope));
}

function attendanceHoursByStore(
  attendance: CostAttendanceEntry[],
  punches: CostAttendancePunch[],
  stores: CostStore[],
  rules: CostAttendanceAllocationRule[],
  profileId: string,
) {
  const rowsByDay = new Map<string, CostAttendanceEntry[]>();
  for (const row of attendance) {
    if (row.profileId !== profileId) continue;
    const rows = rowsByDay.get(row.attendanceDate) ?? [];
    rows.push(row);
    rowsByDay.set(row.attendanceDate, rows);
  }
  const punchesByDailyId = new Map<string, CostAttendancePunch[]>();
  for (const punch of punches) {
    const rows = punchesByDailyId.get(punch.dailyRecordId) ?? [];
    rows.push(punch);
    punchesByDailyId.set(punch.dailyRecordId, rows);
  }
  const result = new Map<string, number>();
  for (const rows of rowsByDay.values()) {
    const attended = rows.filter((row) => row.isAttended);
    if (!attended.length) continue;
    const involvedStores = new Set(attended.map((row) => row.storeId));
    const dayPunches = rows.flatMap((row) => punchesByDailyId.get(row.id) ?? []);
    for (const row of rows) {
      for (const punch of punchesByDailyId.get(row.id) ?? []) involvedStores.add(resolvePunchStoreId(punch, stores));
    }
    const dayHours = Math.max(...rows.map(scheduledHours), 0);
    const storeIds = [...involvedStores].filter(Boolean);
    if (!storeIds.length || dayHours <= 0) continue;
    const attendanceDate = rows[0].attendanceDate;
    const rule = rules.find((item) => item.profileId === profileId
      && item.isEnabled
      && item.effectiveFrom <= attendanceDate
      && (!item.effectiveTo || item.effectiveTo >= attendanceDate)
      && attended.some((row) => row.storeId === item.sourceStoreId)
      && dayHasFieldwork(rows, dayPunches, item.punchScope));
    if (rule) {
      result.set(rule.sourceStoreId, (result.get(rule.sourceStoreId) ?? 0) + dayHours * (1 - rule.targetRatio));
      result.set(rule.targetStoreId, (result.get(rule.targetStoreId) ?? 0) + dayHours * rule.targetRatio);
      continue;
    }
    const allocatedHours = dayHours / storeIds.length;
    for (const storeId of storeIds) result.set(storeId, (result.get(storeId) ?? 0) + allocatedHours);
  }
  return result;
}

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
  punches: CostAttendancePunch[] = [],
  stores: CostStore[] = [],
  rules: CostAttendanceAllocationRule[] = [],
): StoreCostAllocation[] {
  const activePayslips = payslips.filter((item) => item.status !== 'withdrawn');
  const allocations: EmployeeStoreAllocation[] = [];

  for (const payslip of activePayslips) {
    const estimate = payslip.estimate;
    const fallbackStoreId = estimate.primaryStoreId || payslip.storeId;
    if (!fallbackStoreId) continue;

    const attendanceWeights = attendanceHoursByStore(attendance, punches, stores, rules, payslip.profileId);

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
        attendanceHours: hour(attendanceWeights.get(storeId) ?? 0),
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
