import { Rocket } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadTaskTemplates, type TaskTemplateListItem } from '../services/task-templates.service';
import { loadV2Tasks, publishV2Tasks, type V2TaskRow } from '../services/v2-tasks.service';

export function AdminV2TasksPage() {
  const auth = useAuth(); const [templates, setTemplates] = useState<TaskTemplateListItem[]>([]); const [tasks, setTasks] = useState<V2TaskRow[]>([]);
  const [templateId, setTemplateId] = useState(''); const [storeIds, setStoreIds] = useState<string[]>([]); const [due, setDue] = useState(''); const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => { if (!supabase) return; try { const [nextTemplates, instances] = await Promise.all([loadTaskTemplates(supabase), loadV2Tasks(supabase)]); setTemplates(nextTemplates.filter((item) => item.status === 'published')); setTasks(instances); } catch (error) { setMessage(error instanceof Error ? error.message : '加载任务失败'); } }, []);
  useEffect(() => { void load(); }, [load]);
  const publish = async () => { if (!supabase) return; try { await publishV2Tasks(supabase, templateId, storeIds, new Date(due).toISOString()); setMessage('任务已发布'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : '发布失败'); } };
  return <PageShell eyebrow="StoreHub V2 · 管理员" title="任务发布与审核" backTo="/app">
    <Link className="flex min-h-11 items-center justify-center rounded-lg border bg-white font-bold text-brand-700" to="/app/admin/task-templates">管理任务模板</Link>
    <section className="rounded-lg bg-white p-4 shadow-sm"><h2 className="font-bold">从已发布模板创建任务</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><select className="min-h-11 rounded-lg border px-3" onChange={(event) => setTemplateId(event.target.value)} value={templateId}><option value="">选择模板</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name} v{item.current_version}</option>)}</select><input className="min-h-11 rounded-lg border px-3" onChange={(event) => setDue(event.target.value)} type="datetime-local" value={due} /></div><div className="mt-3 flex flex-wrap gap-2">{auth.availableStores.map((store) => <label className="rounded-lg border p-3 text-sm" key={store.id}><input checked={storeIds.includes(store.id)} onChange={() => setStoreIds(storeIds.includes(store.id) ? storeIds.filter((id) => id !== store.id) : [...storeIds, store.id])} type="checkbox" /> {store.name}</label>)}</div><button className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white" onClick={() => void publish()}><Rocket className="h-4 w-4" />发布任务</button></section>
    {message ? <p className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p> : null}
    <section className="space-y-3"><h2 className="font-bold">任务实例</h2>{tasks.map((task) => <Link className="block rounded-lg bg-white p-4 shadow-sm" key={task.id} to={`/app/admin/tasks/${task.id}`}><div className="flex justify-between"><b>{task.name}</b><span>{task.status}</span></div><p className="mt-2 text-sm text-slate-500">{task.task_no} · {auth.availableStores.find((store) => store.id === task.store_id)?.name} · 截止 {new Date(task.due_at).toLocaleString('zh-CN')}</p></Link>)}</section>
  </PageShell>;
}
