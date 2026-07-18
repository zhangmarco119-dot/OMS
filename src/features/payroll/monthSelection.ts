export const payrollMonthEndDate = (month: string, currentDate: string) => {
  if (month === currentDate.slice(0, 7)) return currentDate;
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return currentDate;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const day = new Date(year, monthNumber, 0).getDate();
  return `${month}-${String(day).padStart(2, '0')}`;
};
