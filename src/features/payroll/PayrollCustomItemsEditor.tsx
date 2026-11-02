import { createUuid } from '../../lib/uuid';
import { formatMoney, type PayrollCustomItem } from './model';


export function PayrollCustomItemsEditor({ items, onChange, disabled = false }: { items: PayrollCustomItem[]; onChange: (items: PayrollCustomItem[]) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled} className="mt-3 min-w-0 space-y-2"><legend className="text-sm font-bold">本月临时工资条目</legend>
    {items.map((item, index) => <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)_auto] items-end gap-2" key={item.id}>
      <label className="min-w-0 text-xs">条目名称<input aria-label={`条目 ${index + 1} 名称`} className="ui-input mt-1" maxLength={50} value={item.name} onChange={(event) => onChange(items.map((row) => row.id === item.id ? { ...row, name: event.target.value } : row))} /></label>
      <label className="min-w-0 text-xs">金额（元）<input aria-label={`条目 ${index + 1} 金额`} className="ui-input mt-1" type="number" min="0" step="0.01" value={Number.isNaN(item.amount) ? '' : item.amount} onChange={(event) => onChange(items.map((row) => row.id === item.id ? { ...row, amount: event.target.value === '' ? NaN : Number(event.target.value) } : row))} /></label>
      <button aria-label={`删除条目 ${index + 1}`} className="ui-button-secondary px-2" type="button" onClick={() => onChange(items.filter((row) => row.id !== item.id))}>删除</button>
    </div>)}
    <button className="ui-button-secondary w-full" disabled={items.length >= 50} type="button" onClick={() => onChange([...items, { id: createUuid(), name: '', amount: 0 }])}>增加工资条目</button>
    <p className="text-xs text-slate-500">条目合计 {formatMoney(items.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0))}</p>
  </fieldset>;
}
