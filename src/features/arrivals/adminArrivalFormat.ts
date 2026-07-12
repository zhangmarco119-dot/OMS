import type { AdminArrivalReport } from '../../services/admin-arrivals.service';

export const arrivalStatusLabel: Record<AdminArrivalReport['status'], string> = {
  draft: '草稿',
  submitted: '待查看',
  viewed: '已查看',
  voided: '已作废',
};

export const arrivalStatusClass: Record<AdminArrivalReport['status'], string> = {
  draft: 'bg-slate-100 text-slate-700',
  submitted: 'bg-amber-100 text-amber-800',
  viewed: 'bg-brand-50 text-brand-700',
  voided: 'bg-red-50 text-red-700',
};

export const formatArrivalDateTime = (date: string, time: string | null) =>
  `${date} ${time?.slice(0, 5) ?? ''}`.trim();

export const formatTimestamp = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};
