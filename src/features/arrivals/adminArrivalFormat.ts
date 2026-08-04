import type { AdminArrivalReport } from '../../services/admin-arrivals.service';

export const arrivalStatusLabel: Record<AdminArrivalReport['status'], string> = {
  draft: '草稿',
  submitted: '待查看',
  viewed: '已读',
  voided: '已作废',
};

export const arrivalStatusClass: Record<AdminArrivalReport['status'], string> = {
  draft: 'border border-slate-200 bg-slate-100 text-slate-700',
  submitted: 'border border-amber-200 bg-amber-50 text-amber-900',
  viewed: 'border border-emerald-200 bg-emerald-50 text-emerald-800',
  voided: 'border border-red-200 bg-red-50 text-red-800',
};

export const formatArrivalDateTime = (date: string, time: string | null) =>
  `${date} ${time?.slice(0, 5) ?? ''}`.trim();

export const formatTimestamp = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};
