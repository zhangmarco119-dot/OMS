import { History, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { IconButton } from '../components/ui/Actions';
import { FeedbackBanner, LoadingState } from '../components/ui/Feedback';
import { MetricCard, SectionCard, SectionHeader } from '../components/ui/Surface';
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
  return <PageShell eyebrow="门店运营系统" title="运营历史中心" backTo="/app" contentGapClassName="gap-3"><SectionCard><SectionHeader action={<IconButton aria-label="刷新运营历史" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></IconButton>} description="按当前账号权限查看可访问的门店记录。" icon={History} title="历史模块" /></SectionCard>{message ? <FeedbackBanner tone="danger">{message}</FeedbackBanner> : null}{loading ? <LoadingState label="正在汇总历史记录" /> : <section className={`grid grid-cols-2 gap-2.5 ${isAdmin ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}><MetricCard label="点货与订货" note="已提交单据与明细" to="/app/history" value={counts.legacy} /><MetricCard label="到货记录" note="上报与到货汇总" to={arrivalTo} value={counts.arrivals} />{!isAdmin ? <MetricCard label="已提交任务" note="提交、待审与通过" to="/app/tasks?view=history" value={counts.submittedTasks} /> : null}</section>}</PageShell>;
}
