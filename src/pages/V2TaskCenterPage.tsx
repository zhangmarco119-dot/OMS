import { ClipboardCheck, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { EmptyState, FeedbackBanner, LoadingState } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { featureFlags } from '../config/featureFlags';
import { useAuth } from '../features/auth/AuthContext';
import { v2TaskStatusClass, v2TaskStatusLabel } from '../features/v2-tasks/taskPresentation';
import { supabase } from '../lib/supabase';
import { loadV2Tasks, type V2TaskRow } from '../services/v2-tasks.service';

export function V2TaskCenterPage() {
  const auth = useAuth();
  const [tasks, setTasks] = useState<V2TaskRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const historyOnly = searchParams.get('view') === 'history';

  const load = useCallback(async () => {
    if (!supabase || !auth.store) { setStatus('error'); setMessage('需要先登录并选择门店。'); return; }
    setStatus('loading');
    try {
      setTasks(await loadV2Tasks(supabase, auth.store.id));
      setStatus('ready');
      setMessage(null);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '加载任务中心失败。');
    }
  }, [auth.store]);
  useEffect(() => { void load(); }, [load]);

  if (!featureFlags.taskTemplates) {
    return <PageShell eyebrow="门店运营系统" title="任务中心暂未开放" backTo="/app"><FeedbackBanner>当前环境已关闭任务中心功能。</FeedbackBanner></PageShell>;
  }
  if (auth.profile?.role === 'admin') {
    return <PageShell eyebrow="门店运营系统 · 管理员" title="任务中心" backTo="/app"><SectionCard><p className="text-sm leading-6 text-slate-600">管理员负责配置模板、创建任务、发布任务和审核结果。模板不会显示给员工或店长。</p><Link className="ui-button-primary mt-4 w-full" to="/app/admin/tasks">进入任务管理</Link></SectionCard></PageShell>;
  }

  const visibleTasks = historyOnly ? tasks.filter((task) => ['submitted', 'resubmitted', 'approved'].includes(task.status)) : tasks;
  return <PageShell eyebrow="门店运营系统 · 任务执行" title={historyOnly ? '已提交任务' : '任务中心'} backTo="/app" contentGapClassName="gap-3">
    <SectionCard><SectionHeader description="仅显示已发布到当前门店的任务；填写会自动保存，退回后按指定项目整改。" icon={ShieldCheck} title="门店任务" /></SectionCard>
    {message ? <FeedbackBanner tone="danger">{message}</FeedbackBanner> : null}
    {status === 'loading' ? <LoadingState label="正在加载任务" /> : null}
    {status === 'ready' && visibleTasks.length === 0 ? <EmptyState description={historyOnly ? '提交任务后，记录会显示在这里。' : '管理员发布任务后，会显示在这里。'} icon={ClipboardCheck} title={historyOnly ? '暂无已提交任务' : '当前门店暂无任务'} /> : null}
    {status === 'ready' ? <div className="space-y-2.5">{visibleTasks.map((task) => <Link className="ui-card ui-interactive block p-4" key={task.id} to={`/app/tasks/${task.id}`}><div className="flex items-start justify-between gap-3"><b className="min-w-0 line-clamp-2 leading-6">{task.name}</b><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${v2TaskStatusClass[task.status]}`}>{v2TaskStatusLabel[task.status]}</span></div><p className="mt-2 text-sm text-slate-500">截止 {new Date(task.due_at).toLocaleString('zh-CN')}</p>{task.status === 'rejected' ? <FeedbackBanner className="mt-2" title="退回整改" tone="danger">{task.review_note?.trim() || '请打开任务查看需要整改的项目。'}</FeedbackBanner> : null}</Link>)}</div> : null}
  </PageShell>;
}
