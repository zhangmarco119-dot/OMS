import { Rocket } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { nextRecurringDueAt, formatRecurringDeadline } from '../features/task-templates/recurrence';
import { v2TaskStatusClass, v2TaskStatusLabel } from '../features/v2-tasks/taskPresentation';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadTaskTemplates, type TaskTemplateListItem } from '../services/task-templates.service';
import { loadV2Tasks, publishV2Tasks, type V2TaskRow } from '../services/v2-tasks.service';

const toDatetimeLocalValue = (iso: string) => {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function AdminV2TasksPage() {
  const auth = useAuth();
  const [templates, setTemplates] = useState<TaskTemplateListItem[]>([]);
  const [tasks, setTasks] = useState<V2TaskRow[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const [nextTemplates, instances] = await Promise.all([loadTaskTemplates(supabase), loadV2Tasks(supabase)]);
      setTemplates(nextTemplates.filter((item) => item.status === 'published'));
      setTasks(instances);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载任务失败');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selectedTemplate = useMemo(() => templates.find((template) => template.id === templateId) ?? null, [templateId, templates]);
  const selectTemplate = (id: string) => {
    const template = templates.find((entry) => entry.id === id);
    setTemplateId(id);
    setStoreIds(template?.storeIds ?? []);
    const nextDue = template ? nextRecurringDueAt(template.recurrence, template.recurrence_day, template.due_time) : null;
    setDue(nextDue ? toDatetimeLocalValue(nextDue) : '');
  };
  const publish = async () => {
    if (!supabase || !selectedTemplate) { setMessage('请先选择已发布的任务模板。'); return; }
    if (storeIds.length === 0) { setMessage('请至少选择一个门店。'); return; }
    if (selectedTemplate.recurrence === 'none' && !due) { setMessage('不重复任务需要设置本次截止时间。'); return; }
    try {
      await publishV2Tasks(supabase, templateId, storeIds, due ? new Date(due).toISOString() : null);
      setMessage('任务已发布，员工和店长现在可以在任务中心查看。');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发布失败');
    }
  };

  return <PageShell eyebrow="StoreHub V2 · 管理员" title="任务发布与审核" backTo="/app">
    <Link className="flex min-h-11 items-center justify-center rounded-lg border bg-white font-bold text-brand-700" to="/app/admin/task-templates">管理任务模板</Link>
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="font-bold">从已发布模板创建任务</h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">模板仅供管理员配置。只有在这里发布任务实例后，员工和店长才能看到并执行。</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">任务模板<select className="mt-1 min-h-11 w-full rounded-lg border px-3" onChange={(event) => selectTemplate(event.target.value)} value={templateId}><option value="">选择模板</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name} v{item.current_version}</option>)}</select></label>
        <label className="text-sm font-semibold">{selectedTemplate?.recurrence === 'none' ? '本次截止时间' : '本次周期截止时间'}<input className="mt-1 min-h-11 w-full rounded-lg border px-3" onChange={(event) => setDue(event.target.value)} type="datetime-local" value={due} /></label>
      </div>
      {selectedTemplate ? <p className="mt-3 rounded-lg bg-brand-50 p-3 text-sm text-brand-800">周期规则：{formatRecurringDeadline(selectedTemplate.recurrence, selectedTemplate.recurrence_day, selectedTemplate.due_time)}{selectedTemplate.recurrence !== 'none' ? '。已自动带入下一次截止时间，可按需要调整。' : ''}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">{auth.availableStores.map((store) => <label className="rounded-lg border p-3 text-sm" key={store.id}><input checked={storeIds.includes(store.id)} disabled={Boolean(selectedTemplate && !selectedTemplate.storeIds.includes(store.id))} onChange={() => setStoreIds(storeIds.includes(store.id) ? storeIds.filter((id) => id !== store.id) : [...storeIds, store.id])} type="checkbox" /> {store.name}</label>)}</div>
      <button className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white" onClick={() => void publish()} type="button"><Rocket className="h-4 w-4" />发布任务</button>
    </section>
    {message ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{message}</p> : null}
    <section className="space-y-3"><h2 className="font-bold">任务实例</h2>{tasks.map((task) => <Link className="block rounded-lg bg-white p-4 shadow-sm" key={task.id} to={`/app/admin/tasks/${task.id}`}><div className="flex justify-between gap-3"><b>{task.name}</b><span className={`rounded-full px-3 py-1 text-xs font-bold ${v2TaskStatusClass[task.status]}`}>{v2TaskStatusLabel[task.status]}</span></div><p className="mt-2 text-sm text-slate-500">{task.task_no} · {auth.availableStores.find((store) => store.id === task.store_id)?.name} · 截止 {new Date(task.due_at).toLocaleString('zh-CN')}</p></Link>)}</section>
  </PageShell>;
}
