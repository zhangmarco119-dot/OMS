import { ClipboardCheck, Clock3, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { featureFlags } from '../config/featureFlags';
import { categoryLabel } from '../features/task-templates/templateForm';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadPublishedTemplatesForStore, type TaskTemplateRow } from '../services/task-templates.service';

const recurrenceLabel = { monthly: '每月', none: '按需发布', weekly: '每周' } as const;

export function V2TaskCenterPage() {
  const auth = useAuth();
  const [templates, setTemplates] = useState<TaskTemplateRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !auth.store) { setStatus('error'); setMessage('需要先登录并选择门店。'); return; }
    setStatus('loading');
    try { setTemplates(await loadPublishedTemplatesForStore(supabase, auth.store.id)); setStatus('ready'); setMessage(null); }
    catch (error) { setStatus('error'); setMessage(error instanceof Error ? error.message : '加载任务中心失败。'); }
  }, [auth.store]);
  useEffect(() => { void load(); }, [load]);

  if (!featureFlags.taskTemplates) {
    return <PageShell eyebrow="StoreHub V2" title="任务中心暂未开放" backTo="/app"><p className="rounded-lg bg-white p-5 text-sm text-slate-600 shadow-sm">当前环境已关闭 V2 任务模板功能。</p></PageShell>;
  }

  if (auth.profile?.role === 'admin') {
    return <PageShell eyebrow="管理员" title="任务中心" backTo="/app"><div className="rounded-lg bg-white p-5 shadow-sm"><p className="text-sm leading-6 text-slate-600">管理员负责创建和发布任务模板，不执行门店任务。</p><Link className="mt-4 flex min-h-12 items-center justify-center rounded-lg bg-brand-600 font-bold text-white" to="/app/admin/task-templates">管理任务模板</Link></div></PageShell>;
  }

  return <PageShell eyebrow="StoreHub V2 · 阶段 5" title="任务中心" backTo="/app">
    <section className="rounded-lg border border-brand-100 bg-brand-50 p-4"><div className="flex gap-3"><ShieldCheck className="h-6 w-6 shrink-0 text-brand-700" /><div><h2 className="font-bold text-brand-900">模板已就绪</h2><p className="mt-1 text-sm leading-6 text-brand-800">这里显示当前门店可用的周清、月清和巡店模板。任务发布、填写和提交将在阶段 6 开放。</p></div></div></section>
    {message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}
    {status === 'loading' ? <p className="rounded-lg bg-white p-5 font-semibold text-slate-600 shadow-sm">正在加载任务模板</p> : null}
    {status === 'ready' && templates.length === 0 ? <div className="rounded-lg bg-white p-8 text-center shadow-sm"><ClipboardCheck className="mx-auto h-12 w-12 text-slate-300" /><p className="mt-4 font-bold text-slate-900">当前门店暂无已发布模板</p><p className="mt-2 text-sm text-slate-500">管理员发布模板后会显示在这里。</p></div> : null}
    {status === 'ready' ? <div className="grid gap-3 sm:grid-cols-2">{templates.map((template) => <article className="rounded-lg bg-white p-4 shadow-sm" key={template.id}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-brand-700">{categoryLabel[template.category]} · v{template.current_version}</p><h2 className="mt-1 text-lg font-bold text-slate-900">{template.name}</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">尚未发布任务</span></div><p className="mt-3 text-sm leading-6 text-slate-600">{template.description || '暂无额外说明'}</p><div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{recurrenceLabel[template.recurrence]} · {template.due_time?.slice(0, 5) ?? '无默认截止时间'}</span><span>{template.requires_review ? '提交后需要审核' : '提交后自动完成'}</span></div></article>)}</div> : null}
  </PageShell>;
}
