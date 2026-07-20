import { SegmentedControl } from '../../components/ui/FormField';
import type { ArrivalPeriodMode, ArrivalPeriodValue } from './arrivalPeriod';

interface ArrivalPeriodFilterProps {
  onChange: (value: ArrivalPeriodValue) => void;
  value: ArrivalPeriodValue;
}

const modes: Array<{ label: string; value: ArrivalPeriodMode }> = [
  { label: '选择某日', value: 'day' },
  { label: '选择某月', value: 'month' },
  { label: '选择时间区间', value: 'range' },
];

export function ArrivalPeriodFilter({ onChange, value }: ArrivalPeriodFilterProps) {
  const update = (patch: Partial<ArrivalPeriodValue>) => onChange({ ...value, ...patch });

  return <div>
    <SegmentedControl
      className="grid-cols-3"
      items={modes.map((mode) => ({
        active: value.mode === mode.value,
        label: mode.label,
        onClick: () => update({ mode: mode.value }),
      }))}
    />
    <div className={`mt-3 grid gap-3 ${value.mode === 'range' ? 'sm:grid-cols-2' : ''}`}>
      {value.mode === 'day' ? <label className="text-sm font-semibold text-slate-700">日期<input className="ui-input mt-1" onChange={(event) => update({ day: event.target.value })} type="date" value={value.day} /></label> : null}
      {value.mode === 'month' ? <label className="text-sm font-semibold text-slate-700">月份<input className="ui-input mt-1" onChange={(event) => update({ month: event.target.value })} type="month" value={value.month} /></label> : null}
      {value.mode === 'range' ? <>
        <label className="text-sm font-semibold text-slate-700">开始日期<input className="ui-input mt-1" onChange={(event) => update({ dateFrom: event.target.value })} type="date" value={value.dateFrom} /></label>
        <label className="text-sm font-semibold text-slate-700">结束日期<input className="ui-input mt-1" onChange={(event) => update({ dateTo: event.target.value })} type="date" value={value.dateTo} /></label>
      </> : null}
    </div>
  </div>;
}
