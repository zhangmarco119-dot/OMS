import { validPayrollCustomItems } from './model';
import { useState } from 'react';
import { SectionCard, SectionHeader } from '../../components/ui/Surface';
import { supabase } from '../../lib/supabase';
import { savePayrollCustomItems } from '../../services/payroll.service';
import type { PayrollEstimate } from './model';
import { PayrollCustomItemsEditor } from './PayrollCustomItemsEditor';

export function AdminPayrollCustomItems({ estimate, onSaved }: { estimate: PayrollEstimate; onSaved: () => Promise<void> }) {
  const [items, setItems] = useState(estimate.customItems ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const save = async () => {
    if (!supabase) return;
    if (!validPayrollCustomItems(items)) { setMessage('请填写条目名称和有效的非负金额。'); return; }
    setBusy(true); setMessage('');
    try { await savePayrollCustomItems(supabase, estimate.profileId, estimate.monthStart, items); await onSaved(); setMessage('工资条目已保存。已有工资单请重新生成草稿或在工资单中修改。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '工资条目保存失败。'); }
    finally { setBusy(false); }
  };
  return <SectionCard><SectionHeader title={`${estimate.monthStart.slice(0, 7)} 工资条目`} description="按所选员工和月份保存，计入实时薪资及新生成的工资单。" /><PayrollCustomItemsEditor disabled={busy} items={items} onChange={setItems} /><button className="ui-button-primary mt-3 w-full" disabled={busy} type="button" onClick={() => void save()}>{busy ? '正在保存' : '保存本月工资条目'}</button>{message ? <p role="status" className="mt-2 text-xs text-slate-600">{message}</p> : null}</SectionCard>;
}
