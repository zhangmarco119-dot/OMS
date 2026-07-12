import { ClipboardCheck, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
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
    return <PageShell eyebrow="StoreHub V2" title="任务中心暂未开放" backTo="/app"><p className="rounded-lg bg-white p-5 text-sm text-slate-600 shadow-sm">当前环境已关闭 V2 任务功能。</p></PageShell>;
  }
  if (auth.profile?.role === 'admin') {
    return <PageShell eyebrow="管理员" title="任务中心" backTo="/app"><div className="rounded-lg bg-white p-5 shadow-sm"><p className="text-sm leading-6 text-slate-600">管理员负责配置模板、发布任务和审核结果。模板不会显示给员工或店长。</p><Link className="mt-4 flex min-h-12 items-center justify-center rounded-lg bg-brand-600 font-bold text-white" to="/app/admin/tasks">发布与审核任务</Link></div></PageShell>;
  }

  return <PageShell eyebrow="StoreHub V2 · 任务执行" title="任务中心" backTo="/app">
    <section className="rounded-lg border border-brand-100 bg-brand-50 p-4"><div className="flex gap-3"><ShieldCheck className="h-6 w-6 shrink-0 text-brand-700" /><div><h2 className="font-bold text-brand-900">门店任务</h2><p className="mt-1 text-sm leading-6 text-brand-800">这里仅显示已发布到当前门店的任务。填写内容会自动保存；被退回后按指定项目整改并重新提交。</p></div></div></section>
    {message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}
    {status === 'loading' ? <p className="rounded-lg bg-white p-5 font-semibold text-slate-600 shadow-sm">正在加载任务</p> : null}
    {status === 'ready' && tasks.length === 0 ? <div className="rounded-lg bg-white p-8 text-center shadow-sm"><ClipboardCheck className="mx-auto h-12 w-12 text-slate-300" /><p className="mt-4 font-bold text-slate-900">当前门店暂无任务</p><p className="mt-2 text-sm text-slate-500">管理员发布任务后，会显示在这里。</p></div> : null}
    {status === 'ready' ? <div className="space-y-3">{tasks.map((task) => <Link className="block rounded-lg bg-white p-4 shadow-sm" key={task.id} to={`/app/tasks/${task.id}`}><div className="flex justify-between gap-3"><b>{task.name}</b><span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${v2TaskStatusClass[task.status]}`}>{v2TaskStatusLabel[task.status]}</span></div><p className="mt-2 text-sm text-slate-500">截止 {new Date(task.due_at).toLocaleString('zh-CN')}</p>{task.status === 'rejected' ? <p className="mt-2 text-sm text-red-700">退回原因：{task.review_note}</p> : null}</Link>)}</div> : null}
  </PageShell>;
}
