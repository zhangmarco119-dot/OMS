export type ArrivalPeriodMode = 'day' | 'month' | 'range';

export interface ArrivalPeriodValue {
  dateFrom: string;
  dateTo: string;
  day: string;
  mode: ArrivalPeriodMode;
  month: string;
}

export interface ArrivalDateRange {
  dateFrom: string;
  dateTo: string;
}

export const createDefaultArrivalPeriod = (today: string): ArrivalPeriodValue => ({
  dateFrom: today,
  dateTo: today,
  day: today,
  mode: 'day',
  month: today.slice(0, 7),
});

const assertDate = (value: string, label: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`请选择${label}。`);
  return value;
};

const monthRange = (month: string): ArrivalDateRange => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('请选择月份。');
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) throw new Error('请选择有效月份。');
  const finalDay = new Date(year, monthNumber, 0).getDate();
  return {
    dateFrom: `${month}-01`,
    dateTo: `${month}-${String(finalDay).padStart(2, '0')}`,
  };
};

export const resolveArrivalPeriod = (period: ArrivalPeriodValue): ArrivalDateRange => {
  if (period.mode === 'day') {
    const day = assertDate(period.day, '日期');
    return { dateFrom: day, dateTo: day };
  }
  if (period.mode === 'month') return monthRange(period.month);

  const dateFrom = assertDate(period.dateFrom, '开始日期');
  const dateTo = assertDate(period.dateTo, '结束日期');
  if (dateFrom > dateTo) throw new Error('开始日期不能晚于结束日期。');
  return { dateFrom, dateTo };
};

export const arrivalPeriodLabel = (period: ArrivalPeriodValue) => {
  if (period.mode === 'day') return period.day;
  if (period.mode === 'month') return period.month;
  return `${period.dateFrom}至${period.dateTo}`;
};
