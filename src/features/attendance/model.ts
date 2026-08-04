export type AttendanceStatus = 'normal' | 'late' | 'early' | 'missing' | 'pending' | 'rest' | 'leave' | 'business_trip' | 'fieldwork' | 'abnormal';

export interface AttendancePunch {
  id: string;
  time: string;
  checkType: 'on_duty' | 'off_duty' | 'unknown';
  timeResult: string | null;
  locationResult: string | null;
  locationName: string | null;
  isApprovedCorrection: boolean;
  enterpriseName?: string;
  storeName?: string;
}

export interface AttendanceDaySource {
  corpId: string;
  enterpriseName: string;
  storeId: string;
  storeName: string;
  shiftId: string | null;
  shiftName: string | null;
  plannedOnAt: string | null;
  plannedOffAt: string | null;
  actualOnAt: string | null;
  actualOffAt: string | null;
  status: AttendanceStatus;
}

export interface AttendanceDay {
  id: string;
  date: string;
  timezone: string;
  shiftId: string | null;
  shiftName: string | null;
  plannedOnAt: string | null;
  plannedOffAt: string | null;
  actualOnAt: string | null;
  actualOffAt: string | null;
  onDutyResult: string;
  offDutyResult: string;
  status: AttendanceStatus;
  isAttended: boolean;
  lateMinutes: number;
  earlyMinutes: number;
  missingPunch: 'none' | 'on' | 'off' | 'both';
  exceptionNote: string | null;
  lastSyncedAt: string;
  punches: AttendancePunch[];
  enterpriseCount?: number;
  hasScheduleConflict?: boolean;
  hasFieldwork?: boolean;
  sources?: AttendanceDaySource[];
}

export interface AttendanceMonthSummary {
  attendanceDates: string[];
  attendanceDays: number;
  lateCount: number;
  lateMinutes: number;
  missingCount: number;
  abnormalCount: number;
  overtimeHours: number;
  lastSyncedAt: string | null;
}

export interface AttendanceOvertimeRecord {
  date: string;
  hours: number;
  id: string;
  reason: string;
  storeId: string;
  storeName: string;
}

export interface AttendanceMonthDetail {
  summary: AttendanceMonthSummary;
  days: AttendanceDay[];
  overtimeRecords: AttendanceOvertimeRecord[];
}

export interface AdminAttendanceRow extends AttendanceMonthSummary {
  profileId: string;
  displayName: string;
  storeId: string;
  storeName: string;
  bindingStatus: 'active' | 'inactive' | 'error' | 'unbound';
}

export const statusMeta: Record<AttendanceStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  normal: { label: '正常', tone: 'success' },
  late: { label: '迟到', tone: 'warning' },
  early: { label: '早退', tone: 'warning' },
  missing: { label: '缺卡', tone: 'danger' },
  pending: { label: '待打卡', tone: 'info' },
  rest: { label: '休息', tone: 'neutral' },
  leave: { label: '请假', tone: 'info' },
  business_trip: { label: '出差', tone: 'info' },
  fieldwork: { label: '外勤', tone: 'info' },
  abnormal: { label: '异常', tone: 'danger' },
};

export const currentMonth = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Shanghai' }).formatToParts(date);
  const at = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${at('year')}-${at('month')}`;
};

export const formatAttendanceTime = (value: string | null) => value
  ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }).format(new Date(value))
  : '--:--';

export const filterAttendanceDays = (days: AttendanceDay[], filter: 'all' | 'exceptions') => filter === 'all'
  ? days
  : days.filter((day) => !['normal', 'pending', 'rest', 'leave', 'business_trip', 'fieldwork'].includes(day.status));

export const emptyAttendanceMonth = (): AttendanceMonthDetail => ({
  summary: { attendanceDates: [], attendanceDays: 0, lateCount: 0, lateMinutes: 0, missingCount: 0, abnormalCount: 0, overtimeHours: 0, lastSyncedAt: null },
  days: [],
  overtimeRecords: [],
});
