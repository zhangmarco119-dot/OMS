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
  const [counts, setCounts] = useState({ arrivals: 0, legacy: 0, submittedTasks: 0 });
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
      const [legacy, arrivals, v2Tasks] = await Promise.all([
        loadSubmittedTasks(supabase, auth.profile),
        arrivalCount,
        isAdmin ? Promise.resolve([]) : loadV2Tasks(supabase, auth.store?.id),
      ]);
      if (arrivals.error) throw new Error(arrivals.error.message);
      setCounts({ arrivals: arrivals.count ?? 0, legacy: legacy.length, submittedTasks: v2Tasks.filter((task) => ['submitted', 'resubmitted', 'approved'].includes(task.status)).length }); setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : '加载运营历史失败。'); }
    finally { setLoading(false); }
  }, [auth.profile, auth.store, isAdmin]);
  useEffect(() => { void load(); }, [load]);
  const arrivalTo = isAdmin ? '/app/admin/arrivals' : '/app/arrivals/history';
  return <PageShell eyebrow="门店运营系统 · 阶段 8" title="运营历史中心" backTo="/app"><section className="rounded-lg bg-white p-3 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-brand-700">跨模块历史入口</p><p className="mt-0.5 text-xs text-slate-500">按当前账号权限查看可访问的门店记录。</p></div><button aria-label="刷新运营历史" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200" onClick={() => void load()} type="button"><RefreshCw className="h-4 w-4" /></button></div></section>{message ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p> : null}{loading ? <p className="rounded-lg bg-white p-4 text-sm font-semibold text-slate-600 shadow-sm">正在汇总历史记录</p> : <section className={`grid grid-cols-2 gap-2 ${isAdmin ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}><HistoryCard count={counts.legacy} icon={ClipboardList} label="点货与订货" note="已提交单据与明细" to="/app/history" /><HistoryCard count={counts.arrivals} icon={PackageCheck} label="到货记录" note="上报与到货汇总" to={arrivalTo} />{!isAdmin ? <HistoryCard count={counts.submittedTasks} icon={ListTodo} label="已提交任务" note="提交、待审与通过" to="/app/tasks?view=history" /> : null}</section>}</PageShell>;
}

function HistoryCard({ count, icon: Icon, label, note, to }: { count: number; icon: typeof History; label: string; note: string; to: string }) {
  return <Link className="rounded-lg bg-white p-3 shadow-sm active:scale-[0.99]" to={to}><Icon className="h-4 w-4 text-brand-700" /><p className="mt-1.5 text-xl font-bold text-slate-900">{count}</p><b className="mt-0.5 block text-sm text-slate-900">{label}</b><p className="mt-0.5 text-xs leading-4 text-slate-500">{note}</p></Link>;
}
