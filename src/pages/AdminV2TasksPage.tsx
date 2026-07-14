import { PauseCircle, Rocket } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { nextRecurringDueAt, weeklyDeadlineOptions } from '../features/task-templates/recurrence';
import { v2TaskStatusClass, v2TaskStatusLabel } from '../features/v2-tasks/taskPresentation';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadTaskTemplates, type TaskTemplateListItem } from '../services/task-templates.service';
import { createV2TaskSchedule, loadV2TaskSchedules, loadV2Tasks, pauseV2TaskSchedule, publishV2Tasks, resumeV2TaskSchedule, type V2TaskRow, type V2TaskScheduleRow } from '../services/v2-tasks.service';

const toDatetimeLocalValue = (iso: string) => {
  const date = new Date(iso); const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function AdminV2TasksPage({ publisherOnly = false }: { publisherOnly?: boolean }) {
  const auth = useAuth();
  const [templates, setTemplates] = useState<TaskTemplateListItem[]>([]);
  const [tasks, setTasks] = useState<V2TaskRow[]>([]);
  const [schedules, setSchedules] = useState<V2TaskScheduleRow[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const [creationMode, setCreationMode] = useState<'single' | 'recurring'>('single');
  const [scheduleType, setScheduleType] = useState<'interval_days' | 'weekly' | 'monthly'>('interval_days');
  const [intervalDays, setIntervalDays] = useState(7);
  const [monthDay, setMonthDay] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creatorOpen] = useState(publisherOnly);

  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const [nextTemplates, instances, nextSchedules] = await Promise.all([loadTaskTemplates(supabase), loadV2Tasks(supabase), loadV2TaskSchedules(supabase)]);
      setTemplates(nextTemplates.filter((item) => item.status === 'published'));
      setTasks(instances);
      setSchedules(nextSchedules);
    } catch (error) { setMessage(error instanceof Error ? error.message : '加载任务失败'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selectedTemplate = useMemo(() => templates.find((template) => template.id === templateId) ?? null, [templateId, templates]);
  const selectTemplate = (id: string) => {
    const template = templates.find((entry) => entry.id === id);
    setTemplateId(id); setStoreIds(template?.storeIds ?? []);
    const nextDue = template ? nextRecurringDueAt(template.recurrence, template.recurrence_day, template.due_time) : null;
    setDue(nextDue ? toDatetimeLocalValue(nextDue) : '');
  };
  const validate = () => {
    if (!selectedTemplate) return '请先选择已发布的任务模板。';
    if (storeIds.length === 0) return '请至少选择一个门店。';
    if (!due || Number.isNaN(new Date(due).getTime()) || new Date(due) <= new Date()) return '请设置未来的首次任务截止时间。';
    if (creationMode === 'recurring' && scheduleType === 'interval_days' && (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 31)) return '周期天数请填写 1 到 31 天。';
    if (creationMode === 'recurring' && scheduleType === 'weekly') {
      if (weekdays.length === 0) return '请至少选择一个每周截止日。';
      const dueWeekday = new Date(due).getDay() || 7;
      if (!weekdays.includes(dueWeekday)) return '首次任务截止日期必须是已选择的每周截止日。';
    }
    if (creationMode === 'recurring' && scheduleType === 'monthly') {
      if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) return '每月截止日请填写 1 到 31 日。';
      const dueDate = new Date(due); const lastDay = new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0).getDate();
      if (dueDate.getDate() !== Math.min(monthDay, lastDay)) return '首次任务截止日期必须与每月截止日一致。';
    }
    return null;
  };
  const publish = async () => {
    if (!supabase) return;
    const issue = validate(); if (issue) { setMessage(issue); return; }
    setBusy(true);
    try {
      if (creationMode === 'single') {
        await publishV2Tasks(supabase, templateId, storeIds, new Date(due).toISOString());
        setMessage('单次任务已发布，员工和店长现在可以在任务中心查看。');
      } else {
        await createV2TaskSchedule(supabase, { firstDueAt: new Date(due).toISOString(), intervalDays: scheduleType === 'interval_days' ? intervalDays : null, monthDay: scheduleType === 'monthly' ? monthDay : null, scheduleType, storeIds, templateId, weekdays: scheduleType === 'weekly' ? weekdays : [] });
        setMessage('周期任务计划已创建，首个任务已推送；之后系统会自动按周期推送。');
      }
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '发布失败'); }
    finally { setBusy(false); }
  };
  const pause = async (schedule: V2TaskScheduleRow) => {
    if (!supabase || !window.confirm('暂停后系统不会再自动推送后续任务，确认暂停吗？')) return;
    setBusy(true);
    try { await pauseV2TaskSchedule(supabase, schedule.id); window.dispatchEvent(new Event('storehub:todos-changed')); setMessage('周期任务计划已暂停，未完成周期任务已从当前待办移除。'); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '暂停失败'); }
    finally { setBusy(false); }
  };
  const resume = async (schedule: V2TaskScheduleRow) => {
    if (!supabase || !window.confirm('继续后将从下一个未来周期恢复推送，暂停期间不会补发历史任务。确认继续吗？')) return;
    setBusy(true);
    try { await resumeV2TaskSchedule(supabase, schedule.id); window.dispatchEvent(new Event('storehub:todos-changed')); setMessage('周期任务已继续运行，下一周期任务已重新推送。'); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '继续失败'); }
    finally { setBusy(false); }
  };
  const toggleWeekday = (weekday: number) => setWeekdays((current) => current.includes(weekday) ? current.filter((entry) => entry !== weekday) : [...current, weekday].sort((left, right) => left - right));

  return <PageShell eyebrow="门店运营系统 · 管理员" title={publisherOnly ? '任务发布' : '任务管理'} backTo="/app/workbench">
    {!publisherOnly ? <section className="grid grid-cols-2 gap-2"><Link className="flex min-h-12 items-center justify-center rounded-lg bg-brand-600 font-bold text-white" to="/app/admin/task-templates">管理任务模板</Link><Link className="flex min-h-12 items-center justify-center rounded-lg bg-brand-600 font-bold text-white" to="/app/admin/tasks/publish">任务发布</Link></section> : null}
    {creatorOpen ? <section className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="font-bold">从已发布模板创建任务</h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">模板仅供管理员配置。单次任务发布后立即推送；周期任务会自动向员工和店长持续推送，无需重复手工发布。</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">任务模板<select className="mt-1 min-h-11 w-full rounded-lg border px-3" onChange={(event) => selectTemplate(event.target.value)} value={templateId}><option value="">选择模板</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name} v{item.current_version}</option>)}</select></label><label className="text-sm font-semibold">首次任务截止时间<input className="mt-1 min-h-11 w-full rounded-lg border px-3" onChange={(event) => setDue(event.target.value)} type="datetime-local" value={due} /></label></div>
      {selectedTemplate ? <p className="mt-3 rounded-lg bg-brand-50 p-3 text-sm leading-6 text-brand-800">模板中设置的默认验收时间只用于预填“首次任务截止时间”。本次发布是单次还是周期任务，以这里的“创建方式”和“周期规则”为准，不会互相覆盖。</p> : null}
      <fieldset className="mt-4"><legend className="text-sm font-semibold">创建方式</legend><div className="mt-2 grid grid-cols-2 gap-3"><label className={`rounded-lg border p-3 text-sm ${creationMode === 'single' ? 'border-brand-600 bg-brand-50' : ''}`}><input checked={creationMode === 'single'} onChange={() => setCreationMode('single')} type="radio" /> 单次任务</label><label className={`rounded-lg border p-3 text-sm ${creationMode === 'recurring' ? 'border-brand-600 bg-brand-50' : ''}`}><input checked={creationMode === 'recurring'} onChange={() => setCreationMode('recurring')} type="radio" /> 周期任务</label></div></fieldset>
      {creationMode === 'recurring' ? <section className="mt-3 rounded-lg bg-slate-50 p-3"><p className="font-semibold">周期规则</p><div className="mt-2 grid gap-3 sm:grid-cols-3"><label className="text-sm"><input checked={scheduleType === 'interval_days'} onChange={() => setScheduleType('interval_days')} type="radio" /> 每 <input className="mx-1 h-9 w-16 rounded border px-2" min="1" onChange={(event) => setIntervalDays(Number(event.target.value))} type="number" value={intervalDays} /> 天完成一次</label><label className="text-sm"><input checked={scheduleType === 'weekly'} onChange={() => setScheduleType('weekly')} type="radio" /> 每周指定日期前完成</label><label className="text-sm"><input checked={scheduleType === 'monthly'} onChange={() => setScheduleType('monthly')} type="radio" /> 每月 <input className="mx-1 h-9 w-16 rounded border px-2" max="31" min="1" onChange={(event) => setMonthDay(Number(event.target.value))} type="number" value={monthDay} /> 日前完成</label></div>{scheduleType === 'weekly' ? <div className="mt-3 flex flex-wrap gap-2">{weeklyDeadlineOptions.map((option) => <label className={`rounded-lg border px-3 py-2 text-sm ${weekdays.includes(option.value) ? 'border-brand-600 bg-brand-50' : ''}`} key={option.value}><input checked={weekdays.includes(option.value)} onChange={() => toggleWeekday(option.value)} type="checkbox" /> {option.label}</label>)}</div> : null}<p className="mt-3 text-xs leading-5 text-slate-500">首个任务会立即推送；当前任务截止后，系统会自动创建并推送下一周期任务。每月 29 至 31 日遇到较短月份时，会按该月最后一天截止。</p></section> : null}
      <div className="mt-3 flex flex-wrap gap-2">{auth.availableStores.map((store) => <label className="rounded-lg border p-3 text-sm" key={store.id}><input checked={storeIds.includes(store.id)} disabled={Boolean(selectedTemplate && !selectedTemplate.storeIds.includes(store.id))} onChange={() => setStoreIds(storeIds.includes(store.id) ? storeIds.filter((id) => id !== store.id) : [...storeIds, store.id])} type="checkbox" /> {store.name}</label>)}</div><p className="mt-2 text-xs text-slate-500">目标人员为所选门店内当前有效的员工和店长；发布后将向每位目标人员发送任务通知。</p>
      <button className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void publish()} type="button"><Rocket className="h-4 w-4" />{creationMode === 'single' ? '发布单次任务' : '创建周期任务'}</button>
    </section> : null}
  {!publisherOnly ? <><section className="space-y-3"><h2 className="font-bold">周期任务</h2>{schedules.length === 0 ? <p className="rounded-lg bg-white p-4 text-sm text-slate-500 shadow-sm">暂无周期任务计划。</p> : schedules.map((schedule) => <article className="rounded-lg bg-white p-4 shadow-sm" key={schedule.id}><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{templates.find((template) => template.id === schedule.template_id)?.name ?? '已归档模板的周期任务'}</p><p className="mt-1 text-sm text-slate-500">{auth.availableStores.find((store) => store.id === schedule.store_id)?.name} · {schedule.schedule_type === 'interval_days' ? `每 ${schedule.interval_days} 天` : schedule.schedule_type === 'monthly' ? `每月 ${schedule.month_day} 日` : `每周 ${schedule.weekdays.map((weekday) => weeklyDeadlineOptions.find((option) => option.value === weekday)?.label).join('、')}`} · 截止 {schedule.due_time.slice(0, 5)}</p><p className="mt-1 text-xs text-slate-500">状态：{schedule.is_active ? '运行中' : '已暂停'} · 下次截止：{new Date(schedule.next_due_at).toLocaleString('zh-CN')}</p></div>{schedule.is_active ? <button className="inline-flex min-h-10 items-center gap-1 rounded-lg border px-3 text-sm font-bold text-slate-700" disabled={busy} onClick={() => void pause(schedule)} type="button"><PauseCircle className="h-4 w-4" />暂停</button> : <button className="min-h-10 rounded-lg bg-brand-600 px-3 text-sm font-bold text-white" disabled={busy} onClick={() => void resume(schedule)} type="button">继续</button>}</div></article>)}</section><section className="space-y-3"><h2 className="font-bold">任务清单</h2>{tasks.filter((task) => task.status !== 'cancelled').map((task) => <Link className="block rounded-lg bg-white p-4 shadow-sm" key={task.id} to={`/app/admin/tasks/${task.id}`}><div className="flex justify-between gap-3"><b>{task.name}</b><span className={`rounded-full px-3 py-1 text-xs font-bold ${v2TaskStatusClass[task.status]}`}>{task.status === 'resubmitted' ? '已重新提交 · 待审核' : v2TaskStatusLabel[task.status]}</span></div><p className="mt-2 text-sm text-slate-500">{task.task_no} · {auth.availableStores.find((store) => store.id === task.store_id)?.name} · 截止 {new Date(task.due_at).toLocaleString('zh-CN')}{task.schedule_id ? ' · 周期任务' : ''}</p></Link>)}</section></> : null}
    <ActionFeedbackDialog message={message ?? ''} onClose={() => setMessage(null)} open={Boolean(message)} title={message?.includes('已发布') || message?.includes('已创建') || message?.includes('已暂停') || message?.includes('已继续') ? '操作成功' : message?.includes('失败') ? '操作失败' : '请完善任务设置'} tone={message?.includes('已发布') || message?.includes('已创建') || message?.includes('已暂停') || message?.includes('已继续') ? 'success' : message?.includes('失败') ? 'danger' : 'warning'} />
  </PageShell>;
}

export function AdminV2TaskPublishPage() { return <AdminV2TasksPage publisherOnly />; }
