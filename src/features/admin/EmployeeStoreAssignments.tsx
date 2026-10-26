import { useCallback, useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';

import { SectionCard, SectionHeader } from '../../components/ui/Surface';
import { todayInChina } from '../payroll/model';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database';

type Period = Database['public']['Tables']['profile_store_assignment_periods']['Row'];
type Store = { id: string; name: string; is_active: boolean };

export function EmployeeStoreAssignments({ profileId, stores, onChanged }: { profileId: string; stores: Store[]; onChanged?: () => void }) {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [endingStore, setEndingStore] = useState('');
  const [date, setDate] = useState(todayInChina);
  const [addingStore, setAddingStore] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const today = todayInChina();
  const current = periods.filter((row) => row.effective_from <= today && (!row.effective_to || row.effective_to > today));
  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase.from('profile_store_assignment_periods').select('*').eq('profile_id', profileId).order('effective_from');
      if (error) throw error;
      setPeriods(data ?? []); setStatus('ready');
    } catch { setStatus('error'); }
  }, [profileId]);
  useEffect(() => { setStatus('loading'); setEndingStore(''); setMessage(''); void load(); }, [load]);
  const save = async (action: 'end' | 'add') => {
    if (!supabase || busy) return;
    setBusy(true); setMessage('');
    try {
      const result = action === 'end'
        ? await supabase.rpc('admin_end_profile_store', { p_profile_id: profileId, p_store_id: endingStore, p_effective_date: date })
        : await supabase.rpc('admin_set_profile_stores', { p_profile_id: profileId, p_store_ids: [...new Set([...current.map((row) => row.store_id), addingStore])] });
      if (result.error) throw new Error(result.error.message);
      await load(); onChanged?.(); setEndingStore(''); setAddingStore('');
      setMessage(action === 'end' ? `已保存：从 ${date} 起取消该门店关联；此前考勤和薪资历史保留。` : '已增加门店关联，可在薪资设置中配置跨店规则。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '门店关联保存失败，请重试。'); }
    finally { setBusy(false); }
  };
  return <SectionCard>
    <SectionHeader icon={MapPin} title="门店关联与生效日期" description="取消日期当天起不再参与该店工时及薪资分摊；月中变更时，绩效按变更前后有效日期分别折算。" />
    {status === 'loading' ? <p className="mt-3 text-sm text-slate-500">正在加载门店关联</p> : null}
    {status === 'error' ? <button className="ui-button-secondary mt-3" onClick={() => void load()} type="button">关联加载失败，点击重试</button> : null}
    {status === 'ready' ? <>
      <div className="mt-3 space-y-2">{current.map((row) => <div className="rounded-lg border border-slate-200 p-3" key={row.id}>
        <b className="text-sm">{stores.find((store) => store.id === row.store_id)?.name ?? '门店'}</b>
        {row.effective_to ? <p className="mt-1 text-xs text-amber-700">已安排从 {row.effective_to} 起取消关联</p> : null}
        <button className="ui-button-secondary mt-2 w-full" disabled={busy || current.length < 2} onClick={() => { setEndingStore(row.store_id); setDate(today); setMessage(''); }} type="button">按日期取消关联</button>
      </div>)}</div>
      {current.length < 2 ? <p className="mt-2 text-xs text-slate-500">仅关联一个门店，跨店工时、薪资分配已停用；增加门店后可重新设置。</p> : null}
      {endingStore ? <div className="mt-3 rounded-lg bg-amber-50 p-3">
        <label className="text-sm font-semibold">取消关联生效日期<input className="ui-input mt-1" onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label>
        <p className="mt-2 text-xs leading-5 text-amber-900">从该日起停止关联，此前的记录保留。月底前已参与的绩效仍按有效日期计入，不会删除历史工资单。</p>
        <button className="ui-button-primary mt-3 w-full" disabled={busy || !date} onClick={() => void save('end')} type="button">{busy ? '正在保存' : '保存取消日期'}</button>
      </div> : null}
      <label className="mt-3 block text-sm font-semibold">增加关联门店<select className="ui-input mt-1" onChange={(event) => setAddingStore(event.target.value)} value={addingStore}><option value="">选择门店</option>{stores.filter((store) => store.is_active && !current.some((row) => row.store_id === store.id)).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
      <button className="ui-button-secondary mt-2 w-full" disabled={busy || !addingStore} onClick={() => void save('add')} type="button">增加门店关联</button>
      {periods.some((row) => row.effective_to && row.effective_to <= today) ? <details className="mt-3 text-xs text-slate-500"><summary>查看历史门店关联</summary>{periods.filter((row) => row.effective_to && row.effective_to <= today).map((row) => <p className="mt-2" key={row.id}>{stores.find((store) => store.id === row.store_id)?.name ?? '门店'} · {row.effective_from === '1900-01-01' ? '原有关联' : row.effective_from} · 从 {row.effective_to} 起取消</p>)}</details> : null}
    </> : null}
    {message ? <p aria-live="polite" className="mt-3 text-sm text-slate-700">{message}</p> : null}
  </SectionCard>;
}
