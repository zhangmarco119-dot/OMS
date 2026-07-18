import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const parseMonth = (value: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? { month: Number(match[2]), year: Number(match[1]) } : null;
};

const formatChineseMonth = (value: string) => {
  const parsed = parseMonth(value);
  return parsed ? `${parsed.year}年${String(parsed.month).padStart(2, '0')}月` : '选择月份';
};

export function MonthPicker({ disabled = false, label, maxMonth, minMonth, onChange, value }: {
  disabled?: boolean;
  label: string;
  maxMonth?: string;
  minMonth?: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const selected = parseMonth(value);
  const [open, setOpen] = useState(false);
  const [visibleYear, setVisibleYear] = useState(selected?.year ?? new Date().getFullYear());
  useEffect(() => { if (open) setVisibleYear(parseMonth(value)?.year ?? new Date().getFullYear()); }, [open, value]);
  const minYear = parseMonth(minMonth ?? '')?.year;
  const maxYear = parseMonth(maxMonth ?? '')?.year;
  const available = (month: string) => (!minMonth || month >= minMonth) && (!maxMonth || month <= maxMonth);

  return <>
    <div className="block text-sm font-semibold text-slate-700"><span>{label}</span><button aria-haspopup="dialog" className="ui-input mt-1 flex items-center justify-between text-left disabled:cursor-not-allowed" disabled={disabled} onClick={() => setOpen(true)} type="button"><span className="tabular-nums">{formatChineseMonth(value)}</span><CalendarDays className="h-5 w-5 text-brand-700" /></button></div>
    {open ? <div className="ui-dialog-overlay" role="dialog" aria-modal="true" aria-label={`${label}选择器`}><section className="ui-dialog-panel max-w-md p-4">
      <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-brand-700">{label}</p><h2 className="mt-1 text-xl font-bold">选择月份</h2></div><button aria-label="关闭月份选择" className="ui-icon-button" onClick={() => setOpen(false)} type="button"><X className="h-5 w-5" /></button></div>
      <div className="mt-4 grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2"><button aria-label="上一年" className="ui-icon-button" disabled={minYear !== undefined && visibleYear <= minYear} onClick={() => setVisibleYear((year) => year - 1)} type="button"><ChevronLeft className="h-5 w-5" /></button><b className="text-center text-lg tabular-nums">{visibleYear} 年</b><button aria-label="下一年" className="ui-icon-button" disabled={maxYear !== undefined && visibleYear >= maxYear} onClick={() => setVisibleYear((year) => year + 1)} type="button"><ChevronRight className="h-5 w-5" /></button></div>
      <div className="mt-4 grid grid-cols-3 gap-2">{Array.from({ length: 12 }, (_, index) => {
        const monthNumber = index + 1;
        const monthValue = `${visibleYear}-${String(monthNumber).padStart(2, '0')}`;
        const active = monthValue === value;
        return <button className={`min-h-12 rounded-lg border text-sm font-bold tabular-nums ${active ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-200 bg-white text-slate-700 disabled:bg-slate-100 disabled:text-slate-300'}`} disabled={!available(monthValue)} key={monthValue} onClick={() => { onChange(monthValue); setOpen(false); }} type="button">{monthNumber} 月</button>;
      })}</div>
      {minMonth || maxMonth ? <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">可选范围：{minMonth ? formatChineseMonth(minMonth) : '不限'} 至 {maxMonth ? formatChineseMonth(maxMonth) : '不限'}</p> : null}
    </section></div> : null}
  </>;
}
