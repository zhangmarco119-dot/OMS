export type AttendanceStatus = 'normal' | 'late' | 'early' | 'missing' | 'pending' | 'rest' | 'leave' | 'business_trip' | 'fieldwork' | 'abnormal';
export type DutyResult = AttendanceStatus | 'unknown';

export interface AttendanceBindingInput {
  corpId: string;
  dingtalkUserId: string;
  profileId: string;
  storeId: string;
}

export interface NormalizedPunch {
  checkType: 'on_duty' | 'off_duty' | 'unknown';
  corpId: string;
  dingtalkRecordId: string;
  isApprovedCorrection: boolean;
  locationName: string | null;
  locationResult: string | null;
  profileId: string;
  punchTime: string;
  sourceType: string | null;
  storeId: string;
  timeResult: string | null;
}

export interface NormalizedAttendanceDay {
  actualOffAt: string | null;
  actualOnAt: string | null;
  attendanceDate: string;
  corpId: string;
  dailyStatus: AttendanceStatus;
  dingtalkResultIds: string[];
  earlyMinutes: number;
  exceptionNote: string | null;
  isAttended: boolean;
  lateMinutes: number;
  missingPunch: 'none' | 'on' | 'off' | 'both';
  offDutyResult: DutyResult;
  onDutyResult: DutyResult;
  plannedOffAt: string | null;
  plannedOnAt: string | null;
  profileId: string;
  punches: NormalizedPunch[];
  shiftId: string | null;
  shiftName: string | null;
  sourceUpdatedAt: string | null;
  storeId: string;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const read = (row: Record<string, unknown>, keys: string[]) => keys.find((key) => row[key] !== undefined && row[key] !== null) ? row[keys.find((key) => row[key] !== undefined && row[key] !== null)!] : undefined;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value);
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const iso = (value: unknown) => {
  if (value === undefined || value === null || value === '') return null;
  const raw = text(value);
  const numeric = typeof value === 'number' || /^\d{10,13}$/.test(raw) ? Number(value) : null;
  const hasExplicitTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = raw.replace(' ', 'T') + (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw.replace(' ', 'T')) && !hasExplicitTimezone ? '+08:00' : '');
  const date = numeric === null ? new Date(normalized) : new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const localDate = (value: unknown, fallback?: string) => {
  const raw = text(value);
  const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnly) return dateOnly[1];
  const localDateTime = raw.match(/^(\d{4}-\d{2}-\d{2})[ T]\d{2}:\d{2}/);
  const hasExplicitTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (localDateTime && !hasExplicitTimezone) return localDateTime[1];
  const timestamp = iso(value);
  if (!timestamp) return fallback ?? '';
  return new Intl.DateTimeFormat('en-CA', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date(timestamp));
};

const resultMap: Record<string, DutyResult> = {
  normal: 'normal', late: 'late', early: 'early', absenteeism: 'abnormal', notsigned: 'missing',
  rest: 'rest', leave: 'leave', vacation: 'leave', business_trip: 'business_trip', trip: 'business_trip',
  fieldwork: 'fieldwork', outside: 'fieldwork', abnormal: 'abnormal',
  '正常': 'normal', '迟到': 'late', '早退': 'early', '缺卡': 'missing', '休息': 'rest', '请假': 'leave',
  '出差': 'business_trip', '外勤': 'fieldwork', '异常': 'abnormal',
};

export const normalizeDutyResult = (value: unknown): DutyResult => resultMap[text(value).toLowerCase().replace(/[\s_-]/g, '')] ?? 'unknown';

const strongerStatus = (statuses: DutyResult[]): AttendanceStatus => {
  const priority: AttendanceStatus[] = ['abnormal', 'missing', 'late', 'early', 'leave', 'business_trip', 'fieldwork', 'normal', 'rest'];
  return priority.find((status) => statuses.includes(status)) ?? 'abnormal';
};

export const normalizeAttendanceBundle = (
  binding: AttendanceBindingInput,
  source: { punches: Record<string, unknown>[]; results: Record<string, unknown>[]; schedules: Record<string, unknown>[] },
  now = new Date(),
): NormalizedAttendanceDay[] => {
  const results = source.results.filter((item) => text(read(record(item), ['userId', 'userid', 'user_id'])) === binding.dingtalkUserId);
  const punches = source.punches.filter((item) => text(read(record(item), ['userId', 'userid', 'user_id'])) === binding.dingtalkUserId);
  const schedules = source.schedules.filter((item) => text(read(record(item), ['userId', 'userid', 'user_id'])) === binding.dingtalkUserId);
  const punchCheckType = (item: Record<string, unknown>) => text(read(item, ['checkType','check_type'])).toLowerCase();
  const scheduleWorkDate = (item: Record<string, unknown>) => localDate(read(item, ['workDate','work_date','checkDate','planCheckTime','plan_check_time']));
  const scheduleEndDate = (item: Record<string, unknown>) => localDate(read(item, ['checkEndTime','plannedOffAt','planOffTime','planCheckTime','plan_check_time']));
  const dates = new Set<string>();
  results.forEach((item) => { const value = localDate(read(record(item), ['workDate', 'work_date', 'baseCheckTime', 'planCheckTime'])); if (value) dates.add(value); });
  schedules.forEach((item) => { const value = scheduleWorkDate(record(item)); if (value) dates.add(value); });
  punches.forEach((item) => {
    const punch = record(item);
    const value = localDate(read(punch, ['userCheckTime', 'checkTime', 'check_time']));
    const belongsToCrossDayShift = punchCheckType(punch) === 'offduty' && schedules.map(record).some((schedule) => scheduleEndDate(schedule) === value && scheduleWorkDate(schedule) !== value);
    if (value && !belongsToCrossDayShift) dates.add(value);
  });

  return [...dates].sort().map((date): NormalizedAttendanceDay => {
    const dayResults = results.map(record).filter((item) => localDate(read(item, ['workDate','work_date','baseCheckTime','planCheckTime'])) === date);
    const daySchedules = schedules.map(record).filter((item) => scheduleWorkDate(item) === date);
    const schedule = daySchedules[0] ?? {};
    const onSchedule = daySchedules.find((item) => text(read(item, ['checkType','check_type'])).toLowerCase() === 'onduty') ?? schedule;
    const offSchedule = daySchedules.find((item) => text(read(item, ['checkType','check_type'])).toLowerCase() === 'offduty') ?? schedule;
    const dayPunches = punches.map(record).filter((item) => {
      const punchDate = localDate(read(item, ['userCheckTime','checkTime','check_time']));
      return punchDate === date || (punchCheckType(item) === 'offduty' && scheduleEndDate(offSchedule) === punchDate && scheduleWorkDate(offSchedule) === date);
    });
    const onResultRow = dayResults.find((item) => text(read(item, ['checkType','check_type'])).toLowerCase() === 'onduty');
    const offResultRow = dayResults.find((item) => text(read(item, ['checkType','check_type'])).toLowerCase() === 'offduty');
    const onDutyResult = normalizeDutyResult(read(onResultRow ?? {}, ['timeResult','time_result','status']));
    const offDutyResult = normalizeDutyResult(read(offResultRow ?? {}, ['timeResult','time_result','status']));
    const scheduleStatus = normalizeDutyResult(read(schedule, ['status','attendanceStatus','attendance_status']));
    const isRestValue = (value: unknown) => value === true || value === 1 || ['Y', 'TRUE', '1', 'REST'].includes(text(value).toUpperCase());
    const isRest = daySchedules.some((item) => isRestValue(read(item, ['isRest','is_rest'])) || normalizeDutyResult(read(item, ['status','attendanceStatus','attendance_status'])) === 'rest');
    const statuses: DutyResult[] = [onDutyResult, offDutyResult, scheduleStatus];
    if (isRest) statuses.push('rest');
    const normalizedPunches: NormalizedPunch[] = dayPunches.map((item, index) => ({
      checkType: text(read(item, ['checkType','check_type'])).toLowerCase() === 'onduty' ? 'on_duty' : text(read(item, ['checkType','check_type'])).toLowerCase() === 'offduty' ? 'off_duty' : 'unknown',
      corpId: binding.corpId,
      dingtalkRecordId: text(read(item, ['id','recordId','record_id'])) || `${binding.dingtalkUserId}:${date}:${text(read(item, ['userCheckTime','checkTime','check_time']))}:${index}`,
      isApprovedCorrection: ['approve','approved','repair'].includes(text(read(item, ['sourceType','source_type'])).toLowerCase()),
      locationName: text(read(item, ['userAddress','locationName','location_name'])) || null,
      locationResult: text(read(item, ['locationResult','location_result'])) || null,
      profileId: binding.profileId,
      punchTime: iso(read(item, ['userCheckTime','checkTime','check_time'])) ?? `${date}T00:00:00.000Z`,
      sourceType: text(read(item, ['sourceType','source_type'])) || null,
      storeId: binding.storeId,
      timeResult: text(read(item, ['timeResult','time_result'])) || null,
    }));
    const actualOnAt = iso(read(onResultRow ?? {}, ['userCheckTime','user_check_time'])) ?? normalizedPunches.find((item) => item.checkType === 'on_duty')?.punchTime ?? null;
    const actualOffAt = iso(read(offResultRow ?? {}, ['userCheckTime','user_check_time'])) ?? [...normalizedPunches].reverse().find((item) => item.checkType === 'off_duty')?.punchTime ?? null;
    const plannedOnAt = iso(read(onResultRow ?? onSchedule, ['baseCheckTime','planCheckTime','plan_check_time','plannedOnAt','checkBeginTime']));
    const plannedOffAt = iso(read(offResultRow ?? offSchedule, ['baseCheckTime','planCheckTime','plan_check_time','plannedOffAt','checkEndTime']));
    const hasPassed = (value: string | null) => Boolean(value && new Date(value).getTime() <= now.getTime());
    const missingOn = !isRest && hasPassed(plannedOnAt) && !actualOnAt && (onDutyResult === 'missing' || Boolean(plannedOnAt));
    const missingOff = !isRest && hasPassed(plannedOffAt) && !actualOffAt && (offDutyResult === 'missing' || Boolean(plannedOffAt));
    const lateMinutes = Math.max(number(read(onResultRow ?? {}, ['lateMinutes','late_minutes','durationMinutes'])), onDutyResult === 'late' && plannedOnAt && actualOnAt ? Math.max(0, Math.round((new Date(actualOnAt).getTime() - new Date(plannedOnAt).getTime()) / 60_000)) : 0);
    const earlyMinutes = Math.max(number(read(offResultRow ?? {}, ['earlyMinutes','early_minutes','durationMinutes'])), offDutyResult === 'early' && plannedOffAt && actualOffAt ? Math.max(0, Math.round((new Date(plannedOffAt).getTime() - new Date(actualOffAt).getTime()) / 60_000)) : 0);
    if (missingOn || missingOff) statuses.push('missing');
    const knownStatuses = statuses.filter((status) => status !== 'unknown');
    const hasFuturePlan = [plannedOnAt, plannedOffAt].some((value) => value && new Date(value).getTime() > now.getTime());
    const hasAttendanceEvidence = Boolean(actualOnAt || actualOffAt || normalizedPunches.length);
    const dailyStatus: AttendanceStatus = isRest
      ? 'rest'
      : missingOn || missingOff
        ? 'missing'
        : knownStatuses.length
          ? strongerStatus(knownStatuses)
          : hasAttendanceEvidence
            ? 'normal'
            : hasFuturePlan
              ? 'pending'
              : 'rest';
    return {
      actualOffAt, actualOnAt, attendanceDate: date, corpId: binding.corpId, dailyStatus,
      dingtalkResultIds: dayResults.map((item) => text(read(item, ['id','recordId','record_id']))).filter(Boolean),
      earlyMinutes, exceptionNote: text(read(schedule, ['exceptionNote','remark'])) || null,
      isAttended: Boolean(actualOnAt || actualOffAt || normalizedPunches.length) && !['rest','leave','business_trip'].includes(dailyStatus),
      lateMinutes, missingPunch: missingOn && missingOff ? 'both' : missingOn ? 'on' : missingOff ? 'off' : 'none',
      offDutyResult, onDutyResult, plannedOffAt, plannedOnAt, profileId: binding.profileId,
      punches: normalizedPunches, shiftId: text(read(onSchedule, ['classId','shiftId','class_id'])) || text(read(offSchedule, ['classId','shiftId','class_id'])) || null,
      shiftName: text(read(onSchedule, ['className','shiftName','class_name'])) || text(read(offSchedule, ['className','shiftName','class_name'])) || null,
      sourceUpdatedAt: iso(read(onSchedule, ['gmtModified','updatedAt','updated_at'])) ?? iso(read(offSchedule, ['gmtModified','updatedAt','updated_at'])), storeId: binding.storeId,
    };
  });
};
