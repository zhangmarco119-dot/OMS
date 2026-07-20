import { SegmentedControl } from '../../components/ui/FormField';
import type { ArrivalPeriodMode, ArrivalPeriodValue } from './arrivalPeriod';

interface ArrivalPeriodFilterProps {
  compact?: boolean;
  onChange: (value: ArrivalPeriodValue) => void;
  value: ArrivalPeriodValue;
}

const modes: Array<{ label: string; value: ArrivalPeriodMode }> = [
  { label: '选择某日', value: 'day' },
  { label: '选择某月', value: 'month' },
  { label: '选择时间区间', value: 'range' },
];

export function ArrivalPeriodFilter({ compact = false, onChange, value }: ArrivalPeriodFilterProps) {
  const update = (patch: Partial<ArrivalPeriodValue>) => onChange({ ...value, ...patch });
  const labelClass = compact ? 'text-xs font-semibold text-slate-600' : 'text-sm font-semibold text-slate-700';
  const inputClass = compact ? 'ui-input mt-0.5 min-h-9 py-1 text-sm' : 'ui-input mt-1';

  return <div>
    <SegmentedControl
      className={`grid-cols-3 ${compact ? 'p-0.5 [&>button]:min-h-8 [&>button]:px-1 [&>button]:text-xs' : ''}`}
      items={modes.map((mode) => ({
        active: value.mode === mode.value,
        label: mode.label,
        onClick: () => update({ mode: mode.value }),
      }))}
    />
    <div className={`${compact ? 'mt-2 gap-2' : 'mt-3 gap-3'} grid ${value.mode === 'range' ? 'grid-cols-2' : ''}`}>
      {value.mode === 'day' ? <label className={labelClass}>日期<input className={inputClass} onChange={(event) => update({ day: event.target.value })} type="date" value={value.day} /></label> : null}
      {value.mode === 'month' ? <label className={labelClass}>月份<input className={inputClass} onChange={(event) => update({ month: event.target.value })} type="month" value={value.month} /></label> : null}
      {value.mode === 'range' ? <>
        <label className={labelClass}>开始日期<input className={inputClass} onChange={(event) => update({ dateFrom: event.target.value })} type="date" value={value.dateFrom} /></label>
        <label className={labelClass}>结束日期<input className={inputClass} onChange={(event) => update({ dateTo: event.target.value })} type="date" value={value.dateTo} /></label>
      </> : null}
    </div>
  </div>;
}
