import { useCallback, useEffect, useState } from 'react';
import { SectionCard, SectionHeader } from '../../components/ui/Surface';
import { ErrorState, StatusBadge } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Actions';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { todayInChina } from '../payroll/model';
import { loadStoreClosures, setStoreOperating, storeOperatesOn, type StoreClosure } from '../../services/store-business.service';

export function StoreBusinessSettings({ onChanged }: { onChanged: () => void }) {
  const auth = useAuth();
  const [closures, setClosures] = useState<StoreClosure[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [closedDates, setClosedDates] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<{ id: string; name: string; operating: boolean; effectiveDate: string } | null>(null);
  const load = useCallback(async () => { if (!supabase) return; try { const rows = await loadStoreClosures(supabase); setClosures(rows); setReady(true); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '经营状态加载失败'); } }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    if (!supabase || !action) return;
    setBusy(true);
    try { await setStoreOperating(supabase, action.id, action.operating, action.effectiveDate); setDates({}); setClosedDates({}); setAction(null); await load(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : '经营状态保存失败'); setAction(null); }
    finally { setBusy(false); }
  };
  return <SectionCard><SectionHeader title="门店经营状态" description="关店日起停止营业额同步及该门店的提成、绩效累计，关店前的数据保留用于历史结算。恢复营业可重新启用。" />
    {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
    <div className="mt-3 space-y-3">{auth.availableStores.map((store) => {
      const operating = storeOperatesOn(closures, store.id, todayInChina());
      const closure = closures.find((row) => row.store_id === store.id && !row.reopened_from);
      return <div className="rounded-xl border border-slate-200 p-3" key={store.id}><div className="flex items-center justify-between gap-2"><b className="text-sm">{store.name}</b><StatusBadge tone={operating ? 'success' : 'warning'}>{operating ? '营业中' : '已关店'}</StatusBadge></div>{closure ? <><p className="mt-1 text-xs text-slate-500">关店生效日：{closure.closed_from}</p><label className="mt-3 block text-xs font-semibold">调整关店日期<input aria-label={`${store.name}调整关店日期`} className="ui-input mt-1" max={todayInChina()} onChange={(e) => setClosedDates((v) => ({ ...v, [store.id]: e.target.value }))} type="date" value={closedDates[store.id] || closure.closed_from} /></label><button className="ui-button-secondary mt-2 w-full" disabled={busy || !ready || !closedDates[store.id] || closedDates[store.id] === closure.closed_from} onClick={() => setAction({ id: store.id, name: store.name, operating: false, effectiveDate: closedDates[store.id] || closure.closed_from })} type="button">更新关店日期</button></> : null}<label className="mt-3 block text-xs font-semibold">{operating ? '关店生效日期' : '恢复营业日期'}<input aria-label={`${store.name}${operating ? '关店' : '恢复营业'}日期`} className="ui-input mt-1" max={todayInChina()} min={!operating && closure ? closure.closed_from : undefined} onChange={(e) => setDates((v) => ({ ...v, [store.id]: e.target.value }))} type="date" value={dates[store.id] || todayInChina()} /></label><button className="ui-button-secondary mt-2 w-full" disabled={!ready || busy} onClick={() => setAction({ id: store.id, name: store.name, operating: !operating, effectiveDate: dates[store.id] || todayInChina() })} type="button">{operating ? '设置为关店' : '恢复营业'}</button></div>;
    })}</div>
    <ConfirmDialog confirmLabel={busy ? '正在保存' : '确认设置'} danger={!action?.operating} onCancel={() => { if (!busy) setAction(null); }} onConfirm={() => { if (!busy) void save(); }} open={Boolean(action)} title={action?.operating ? '恢复门店营业' : '设置门店关店'}><p>{action?.name}将从 {action?.effectiveDate ?? ''} 起{action?.operating ? '恢复营业，重新参与营业额、提成及绩效计算。' : '停止营业额同步，不再累计该日期起的门店提成及绩效。'}</p></ConfirmDialog>
  </SectionCard>;
}
