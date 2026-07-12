import { ClipboardList, History, ListTodo, PackageCheck, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { useAuth } from '../features/auth/AuthContext';
import { loadSubmittedTasks } from '../features/history/historyService';
import { supabase } from '../lib/supabase';
import { loadArrivalHistory } from '../services/arrivals.service';
import { loadV2Tasks } from '../services/v2-tasks.service';

export function OperationsHistoryPage() {
  const auth = useAuth();
  const [counts, setCounts] = useState({ arrivals: 0, legacy: 0, v2Tasks: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isAdmin = auth.profile?.role === 'admin';
  const load = useCallback(async () => {
    if (!supabase || !auth.profile) { setMessage('需要先登录后查看运营历史。'); setLoading(false); return; }
    setLoading(true);
    try {
      const arrivalCount = isAdmin
        ? supabase.from('arrival_reports').select('id', { count: 'exact', head: true })
        : auth.store ? loadArrivalHistory(supabase, auth.store.id).then((rows) => ({ count: rows.length, error: null })) : Promise.resolve({ count: 0, error: null });
      const [legacy, v2Tasks, arrivals] = await Promise.all([
        loadSubmittedTasks(supabase, auth.profile),
        loadV2Tasks(supabase, isAdmin ? undefined : auth.store?.id),
        arrivalCount,
      ]);
      if (arrivals.error) throw new Error(arrivals.error.message);
      setCounts({ arrivals: arrivals.count ?? 0, legacy: legacy.length, v2Tasks: v2Tasks.length }); setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : '加载运营历史失败。'); }
    finally { setLoading(false); }
  }, [auth.profile, auth.store, isAdmin]);
  useEffect(() => { void load(); }, [load]);
  const arrivalTo = isAdmin ? '/app/admin/arrivals' : '/app/arrivals/history';
  const taskTo = isAdmin ? '/app/admin/tasks' : '/app/tasks';
  return <PageShell eyebrow="门店运营系统 · 阶段 8" title="运营历史中心" backTo="/app"><section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-brand-700">跨模块历史入口</p><p className="mt-1 text-sm text-slate-500">保留原有权限范围：员工看本人记录，店长看本店记录，管理员看授权门店。</p></div><button aria-label="刷新运营历史" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200" onClick={() => void load()} type="button"><RefreshCw className="h-4 w-4" /></button></div></section>{message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}{loading ? <p className="rounded-lg bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">正在汇总历史记录</p> : <section className="grid gap-3 sm:grid-cols-3"><HistoryCard count={counts.legacy} icon={ClipboardList} label="点货与订货" note="已提交的 V1 单据和明细" to="/app/history" /><HistoryCard count={counts.arrivals} icon={PackageCheck} label="到货记录" note="到货上报及每日汇总" to={arrivalTo} /><HistoryCard count={counts.v2Tasks} icon={ListTodo} label="任务记录" note="周清、月清、巡店和临时任务" to={taskTo} /></section>}</PageShell>;
}

function HistoryCard({ count, icon: Icon, label, note, to }: { count: number; icon: typeof History; label: string; note: string; to: string }) {
  return <Link className="rounded-lg bg-white p-4 shadow-sm active:scale-[0.99]" to={to}><Icon className="h-5 w-5 text-brand-700" /><p className="mt-3 text-2xl font-bold text-slate-900">{count}</p><b className="mt-1 block text-slate-900">{label}</b><p className="mt-1 text-sm text-slate-500">{note}</p></Link>;
}
