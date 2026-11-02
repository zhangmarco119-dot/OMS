import { useState } from 'react';
import { FormField } from '../../components/ui/FormField';
import { SectionCard } from '../../components/ui/Surface';
import { supabase } from '../../lib/supabase';
import { saveTaxMonthlySalary, type TaxPerson } from '../../services/tax-accounting.service';

export function TaxSalaryEditor({ actorId, initialAmount, month, onClose, onSaved, person }: { actorId: string; initialAmount: number | null; month: string; onClose: () => void; onSaved: () => Promise<void>; person: TaxPerson }) {
  const [amount, setAmount] = useState(initialAmount == null ? '' : String(initialAmount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!supabase) return;
    const value = Number(amount);
    if (!amount.trim() || !Number.isFinite(value) || value < 0 || value >= 10000000000) { setError('请输入有效的非负薪资金额。'); return; }
    setBusy(true); setError('');
    try { await saveTaxMonthlySalary(supabase, actorId, person.id, month, value); await onSaved(); }
    catch { setError('薪资保存失败，请稍后重试。'); }
    finally { setBusy(false); }
  };
  return <div role="dialog" aria-modal="true" aria-labelledby="tax-salary-title" className="fixed inset-0 z-50 overflow-y-auto bg-canvas p-4">
    <div className="mx-auto grid max-w-xl gap-3"><header className="ui-card p-4"><button className="ui-button-secondary" type="button" disabled={busy} onClick={onClose}>返回税务与记账</button><h2 id="tax-salary-title" className="mt-3 text-xl font-bold">填写申报薪资</h2><p className="mt-1 text-sm text-slate-600">{person.full_name} · {month.replace('-', '年')}月</p></header>
      <SectionCard><FormField label="申报薪资（元）" required><input autoFocus className="ui-input" type="number" min="0" step="0.01" inputMode="decimal" placeholder="请输入该月薪资" value={amount} disabled={busy} onChange={(event) => setAmount(event.target.value)} /></FormField>{error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}<button className="ui-button-primary mt-4 w-full" type="button" disabled={busy} onClick={() => void save()}>{busy ? '正在保存' : '保存并返回'}</button></SectionCard>
    </div>
  </div>;
}
