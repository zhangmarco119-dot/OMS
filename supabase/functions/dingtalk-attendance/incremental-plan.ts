export type AttendanceDayState = {
  lastSyncedAt: string;
  syncDate: string;
};
const DAY_MS = 86_400_000;

export const eachDate = (startDate: string, endDate: string) => {
  const dates: string[] = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const final = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(final.getTime()) || cursor > final) throw new Error('无效的考勤日期范围。');
  while (cursor <= final) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return dates;
};

export const previousDate = (date: string) => new Date(new Date(`${date}T00:00:00Z`).getTime() - DAY_MS).toISOString().slice(0, 10);

export const selectIncrementalDates = (
  startDate: string,
  endDate: string,
  today: string,
  states: AttendanceDayState[],
  recheckDates: string[] = [],
) => {
  const stateByDate = new Map(states.map((state) => [state.syncDate, state.lastSyncedAt]));
  const recheck = new Set(recheckDates);
  const yesterday = previousDate(today);
  const todayStart = new Date(`${today}T00:00:00+08:00`).getTime();
  return eachDate(startDate, endDate).filter((date) => {
    if (recheck.has(date)) return true;
    const lastSyncedAt = stateByDate.get(date);
    if (!lastSyncedAt) return true;
    if (date === today) return true;
    if (date === yesterday && new Date(lastSyncedAt).getTime() < todayStart) return true;
    return false;
  });
};

export const groupContiguousDates = (dates: string[], maxDays = 7) => {
  const sorted = [...new Set(dates)].sort();
  const groups: Array<{ startDate: string; endDate: string }> = [];
  for (const date of sorted) {
    const last = groups.at(-1);
    if (!last) {
      groups.push({ startDate: date, endDate: date });
      continue;
    }
    const expected = new Date(new Date(`${last.endDate}T00:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10);
    const groupDays = Math.round((new Date(`${last.endDate}T00:00:00Z`).getTime() - new Date(`${last.startDate}T00:00:00Z`).getTime()) / DAY_MS) + 1;
    if (date === expected && groupDays < maxDays) last.endDate = date;
    else groups.push({ startDate: date, endDate: date });
  }
  return groups;
};
