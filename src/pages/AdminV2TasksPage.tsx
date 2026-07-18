import { PauseCircle, Pencil, Rocket, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { PageShell } from '../components/layout/PageShell';
import { weeklyDeadlineOptions } from '../features/task-templates/recurrence';
import { useAuth } from '../features/auth/AuthContext';
import { v2TaskStatusClass, v2TaskStatusLabel } from '../features/v2-tasks/taskPresentation';
import { supabase } from '../lib/supabase';
import { loadTaskTemplates, type TaskTemplateListItem } from '../services/task-templates.service';
import {
  createV2TaskSchedule,
  loadV2TaskRecipients,
  loadV2TaskSchedules,
  loadV2Tasks,
  pauseV2TaskSchedule,
  publishV2Tasks,
  resumeV2TaskSchedule,
  updateV2TaskSchedule,
  withdrawV2TaskScheduleCurrent,
  type V2TaskRecipient,
  type V2TaskRow,
  type V2TaskScheduleFields,
  type V2TaskScheduleRow,
} from '../services/v2-tasks.service';

const pad = (value: number) => String(value).padStart(2, '0');
const defaultSingleDue = () => {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T20:00`;
};
const defaultFields = (): V2TaskScheduleFields => ({
  acceptanceIntervalDays: 1,
  acceptanceMonthDay: null,
  acceptanceTime: '20:00',
  acceptanceType: 'daily',
  acceptanceWeekday: null,
  intervalDays: 7,
  monthDay: null,
  publishTime: '09:00',
  scheduleType: 'interval_days',
  weekdays: [],
});
const scheduleFieldsFromRow = (row: V2TaskScheduleRow): V2TaskScheduleFields => ({
  acceptanceIntervalDays: row.acceptance_interval_days,
  acceptanceMonthDay: row.acceptance_month_day,
  acceptanceTime: row.due_time.slice(0, 5),
  acceptanceType: row.acceptance_type,
  acceptanceWeekday: row.acceptance_weekday,
  intervalDays: row.interval_days,
  monthDay: row.month_day,
  publishTime: row.publish_time.slice(0, 5),
  scheduleType: row.schedule_type,
  weekdays: row.weekdays,
});
const setClock = (date: Date, clock: string) => {
  const [hour, minute] = clock.split(':').map(Number);
  date.setHours(hour || 0, minute || 0, 0, 0);
  return date;
};
const nextReleaseAt = (from: Date, fields: V2TaskScheduleFields) => {
  if (fields.scheduleType === 'interval_days') return setClock(new Date(from.getFullYear(), from.getMonth(), from.getDate() + (fields.intervalDays ?? 0)), fields.publishTime);
  if (fields.scheduleType === 'weekly') {
    const candidates = fields.weekdays.map((weekday) => {
      const result = setClock(new Date(from), fields.publishTime);
      const current = result.getDay() || 7;
      let offset = (weekday - current + 7) % 7;
      if (offset === 0 && result <= from) offset = 7;
      result.setDate(result.getDate() + offset);
      return result;
    }).filter((date) => date > from);
    return candidates.sort((left, right) => left.getTime() - right.getTime())[0] ?? new Date(0);
  }
  const target = fields.monthDay ?? 1;
  const candidate = setClock(new Date(from.getFullYear(), from.getMonth(), Math.min(target, new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate())), fields.publishTime);
  if (candidate > from) return candidate;
  return setClock(new Date(from.getFullYear(), from.getMonth() + 1, Math.min(target, new Date(from.getFullYear(), from.getMonth() + 2, 0).getDate())), fields.publishTime);
};
const acceptanceDueAt = (from: Date, fields: V2TaskScheduleFields) => {
  if (fields.acceptanceType === 'daily') return setClock(new Date(from.getFullYear(), from.getMonth(), from.getDate() + (fields.acceptanceIntervalDays ?? 0)), fields.acceptanceTime);
  if (fields.acceptanceType === 'weekly') {
    const result = setClock(new Date(from), fields.acceptanceTime);
    const weekday = fields.acceptanceWeekday ?? 1;
    const current = result.getDay() || 7;
    let offset = (weekday - current + 7) % 7;
    if (offset === 0 && result <= from) offset = 7;
    result.setDate(result.getDate() + offset);
    return result;
  }
  const target = fields.acceptanceMonthDay ?? 1;
  const candidate = setClock(new Date(from.getFullYear(), from.getMonth(), Math.min(target, new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate())), fields.acceptanceTime);
  if (candidate > from) return candidate;
  return setClock(new Date(from.getFullYear(), from.getMonth() + 1, Math.min(target, new Date(from.getFullYear(), from.getMonth() + 2, 0).getDate())), fields.acceptanceTime);
};
const validateSchedule = (fields: V2TaskScheduleFields) => {
  if (fields.scheduleType === 'interval_days' && (!Number.isInteger(fields.intervalDays) || (fields.intervalDays ?? 0) < 1 || (fields.intervalDays ?? 0) > 31)) return '发布间隔请输入 1 到 31 天。';
  if (fields.scheduleType === 'weekly' && fields.weekdays.length === 0) return '请至少选择一个每周发布日。';
  if (fields.scheduleType === 'monthly' && (!Number.isInteger(fields.monthDay) || (fields.monthDay ?? 0) < 1 || (fields.monthDay ?? 0) > 31)) return '每月发布日请输入 1 到 31。';
  if (fields.acceptanceType === 'daily' && (!Number.isInteger(fields.acceptanceIntervalDays) || (fields.acceptanceIntervalDays ?? 0) < 1 || (fields.acceptanceIntervalDays ?? 0) > 31)) return '按天验收请输入 1 到 31 天。';
  if (fields.acceptanceType === 'weekly' && !fields.acceptanceWeekday) return '请选择每周验收日。';
  if (fields.acceptanceType === 'monthly' && (!Number.isInteger(fields.acceptanceMonthDay) || (fields.acceptanceMonthDay ?? 0) < 1 || (fields.acceptanceMonthDay ?? 0) > 31)) return '每月验收日请输入 1 到 31。';
  const now = new Date();
  const due = acceptanceDueAt(now, fields);
  const nextRelease = nextReleaseAt(now, fields);
  if (due <= now) return '验收时间必须晚于本次发布时间。';
  if (due >= nextRelease) return '验收时间必须早于下一次发布时间，请调整发布周期或验收周期。';
  return null;
};
const scheduleText = (row: V2TaskScheduleRow) => {
  const release = row.schedule_type === 'interval_days' ? `每 ${row.interval_days} 天` : row.schedule_type === 'weekly' ? `每周 ${row.weekdays.map((value) => weeklyDeadlineOptions.find((item) => item.value === value)?.label).join('、')}` : `每月 ${row.month_day} 日`;
  const acceptance = row.acceptance_type === 'daily' ? `发布后 ${row.acceptance_interval_days} 天` : row.acceptance_type === 'weekly' ? `每周 ${weeklyDeadlineOptions.find((item) => item.value === row.acceptance_weekday)?.label}` : `每月 ${row.acceptance_month_day} 日`;
  return `${release} ${row.publish_time.slice(0, 5)} 发布 · ${acceptance} ${row.due_time.slice(0, 5)} 验收`;
};

export function AdminV2TasksPage({ publisherOnly = false }: { publisherOnly?: boolean }) {
  const auth = useAuth();
  const [templates, setTemplates] = useState<TaskTemplateListItem[]>([]);
  const [tasks, setTasks] = useState<V2TaskRow[]>([]);
  const [schedules, setSchedules] = useState<V2TaskScheduleRow[]>([]);
  const [recipients, setRecipients] = useState<V2TaskRecipient[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [due, setDue] = useState(defaultSingleDue);
  const [creationMode, setCreationMode] = useState<'single' | 'recurring'>('single');
  const [recipientMode, setRecipientMode] = useState<'stores' | 'employee'>('stores');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [fields, setFields] = useState<V2TaskScheduleFields>(defaultFields);
  const [editingSchedule, setEditingSchedule] = useState<V2TaskScheduleRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const [nextTemplates, nextTasks, nextSchedules, nextRecipients] = await Promise.all([loadTaskTemplates(supabase), loadV2Tasks(supabase), loadV2TaskSchedules(supabase), loadV2TaskRecipients(supabase)]);
      setTemplates(nextTemplates.filter((item) => item.status === 'published'));
      setTasks(nextTasks);
      setSchedules(nextSchedules);
      setRecipients(nextRecipients);
    } catch (error) { setMessage(error instanceof Error ? error.message : '加载任务失败'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const selectedTemplate = useMemo(() => templates.find((item) => item.id === templateId) ?? null, [templateId, templates]);
  const selectedRecipient = recipients.find((item) => item.id === selectedProfileId);

  const publish = async () => {
    if (!supabase) return;
    if (!selectedTemplate) return setMessage('请先选择已发布的任务模板。');
    if (!storeIds.length) return setMessage('请至少选择一个门店。');
    if (recipientMode === 'employee' && !selectedProfileId) return setMessage('请选择单独接收任务的员工或店长。');
    if (creationMode === 'single' && (!due || new Date(due) <= new Date())) return setMessage('单次任务的验收时间必须晚于当前时间。');
    if (creationMode === 'recurring') { const issue = validateSchedule(fields); if (issue) return setMessage(issue); }
    setBusy(true);
    try {
      if (creationMode === 'single') await publishV2Tasks(supabase, templateId, storeIds, new Date(due).toISOString(), recipientMode === 'employee' ? [selectedProfileId] : []);
      else await createV2TaskSchedule(supabase, { ...fields, profileIds: recipientMode === 'employee' ? [selectedProfileId] : [], storeIds, templateId });
      setMessage(creationMode === 'single' ? '单次任务已发布。' : '周期任务已创建，首个任务已立即发布。');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '任务发布失败'); }
    finally { setBusy(false); }
  };
  const pause = async (row: V2TaskScheduleRow) => {
    if (!supabase || !window.confirm('暂停后会撤回当前未完成任务，并停止后续自动发布，确认暂停吗？')) return;
    setBusy(true); try { await pauseV2TaskSchedule(supabase, row.id); window.dispatchEvent(new Event('storehub:todos-changed')); setMessage('周期任务已暂停。'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : '暂停失败'); } finally { setBusy(false); }
  };
  const resume = async (row: V2TaskScheduleRow) => {
    if (!supabase || !window.confirm('继续后会按当前规则立即恢复任务，确认继续吗？')) return;
    setBusy(true); try { await resumeV2TaskSchedule(supabase, row.id); window.dispatchEvent(new Event('storehub:todos-changed')); setMessage('周期任务已继续。'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : '继续失败'); } finally { setBusy(false); }
  };
  const withdraw = async (row: V2TaskScheduleRow) => {
    if (!supabase || !window.confirm('仅撤回这个周期当前未完成的任务，周期计划仍会继续，确认撤回吗？')) return;
    setBusy(true); try { await withdrawV2TaskScheduleCurrent(supabase, row.id); window.dispatchEvent(new Event('storehub:todos-changed')); setMessage('当前周期任务已撤回。'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : '撤回失败'); } finally { setBusy(false); }
  };
  const saveSchedule = async () => {
    if (!supabase || !editingSchedule) return;
    const issue = validateSchedule(fields); if (issue) return setMessage(issue);
    setBusy(true); try { await updateV2TaskSchedule(supabase, editingSchedule.id, fields); setEditingSchedule(null); setMessage('周期规则已更新。'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : '周期规则保存失败'); } finally { setBusy(false); }
  };

  return <PageShell eyebrow="门店运营系统 · 管理员" title={publisherOnly ? '任务发布' : '任务管理'} backTo="/app/workbench">
    <section className="ui-card p-4">
      <h2 className="font-bold">发布任务</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">任务模板<select className="ui-input mt-1" onChange={(event) => { const id = event.target.value; setTemplateId(id); setStoreIds(templates.find((item) => item.id === id)?.storeIds ?? []); }} value={templateId}><option value="">请选择模板</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm font-semibold">发布方式<select className="ui-input mt-1" onChange={(event) => setCreationMode(event.target.value as 'single' | 'recurring')} value={creationMode}><option value="single">单次任务</option><option value="recurring">周期任务</option></select></label>
        <label className="text-sm font-semibold">接收范围<select className="ui-input mt-1" onChange={(event) => setRecipientMode(event.target.value as 'stores' | 'employee')} value={recipientMode}><option value="stores">所选门店全体员工与店长</option><option value="employee">单独指定一位员工或店长</option></select></label>
        {recipientMode === 'employee' ? <label className="text-sm font-semibold">接收人<select className="ui-input mt-1" onChange={(event) => { const id = event.target.value; setSelectedProfileId(id); const recipient = recipients.find((item) => item.id === id); if (recipient?.store_id) setStoreIds([recipient.store_id]); }} value={selectedProfileId}><option value="">请选择人员</option>{recipients.map((item) => <option key={item.id} value={item.id}>{item.display_name} · {item.role === 'manager' ? '店长' : '员工'}</option>)}</select></label> : null}
      </div>
      <fieldset className="mt-3"><legend className="text-sm font-semibold">适用门店</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{auth.availableStores.map((store) => <label className="flex min-h-11 items-center rounded-lg border px-3 text-sm" key={store.id}><input checked={storeIds.includes(store.id)} className="mr-2" disabled={recipientMode === 'employee'} onChange={() => setStoreIds((current) => current.includes(store.id) ? current.filter((id) => id !== store.id) : [...current, store.id])} type="checkbox" />{store.name}</label>)}</div>{recipientMode === 'employee' && selectedRecipient ? <p className="mt-2 text-xs text-slate-500">已按 {selectedRecipient.display_name} 的所属门店锁定。</p> : null}</fieldset>
      {creationMode === 'single' ? <label className="mt-3 block text-sm font-semibold">验收截止时间<input className="ui-input mt-1" onChange={(event) => setDue(event.target.value)} type="datetime-local" value={due} /></label> : <ScheduleRuleEditor fields={fields} onChange={setFields} />}
      <button className="ui-button-primary mt-4 w-full" disabled={busy} onClick={() => void publish()} type="button"><Rocket className="h-4 w-4" />{busy ? '正在发布' : '确认发布'}</button>
    </section>

    {!publisherOnly ? <>
      <section className="space-y-3"><h2 className="font-bold">周期任务</h2>{schedules.length ? schedules.map((row) => <article className="ui-card p-4" key={row.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b>{templates.find((item) => item.id === row.template_id)?.name ?? '已归档模板的周期任务'}</b><p className="mt-1 text-sm text-slate-600">{auth.availableStores.find((store) => store.id === row.store_id)?.name}{row.assigned_profile_id ? ` · ${recipients.find((item) => item.id === row.assigned_profile_id)?.display_name ?? '指定人员'}` : ' · 门店全体'}</p><p className="mt-1 text-xs leading-5 text-slate-500">{scheduleText(row)}<br />下次发布：{new Date(row.next_due_at).toLocaleString('zh-CN')}</p></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${row.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{row.is_active ? '运行中' : '已暂停'}</span></div><div className="mt-3 grid grid-cols-3 gap-2"><button className="ui-button-secondary px-2" disabled={busy} onClick={() => { setEditingSchedule(row); setFields(scheduleFieldsFromRow(row)); }} type="button"><Pencil className="h-4 w-4" />编辑</button><button className="ui-button-secondary px-2" disabled={busy} onClick={() => void withdraw(row)} type="button"><Undo2 className="h-4 w-4" />撤回当前</button>{row.is_active ? <button className="ui-button-secondary px-2" disabled={busy} onClick={() => void pause(row)} type="button"><PauseCircle className="h-4 w-4" />暂停</button> : <button className="ui-button-primary px-2" disabled={busy} onClick={() => void resume(row)} type="button">继续</button>}</div></article>) : <p className="ui-card p-4 text-sm text-slate-500">暂无周期任务计划。</p>}</section>
      <section className="space-y-3"><h2 className="font-bold">任务清单</h2>{tasks.filter((task) => task.status !== 'cancelled').map((task) => <Link className="ui-card ui-interactive block p-4" key={task.id} to={`/app/admin/tasks/${task.id}`}><div className="flex justify-between gap-3"><b>{task.name}</b><span className={`rounded-full px-3 py-1 text-xs font-bold ${v2TaskStatusClass[task.status]}`}>{task.status === 'resubmitted' ? '已重新提交 · 待审核' : v2TaskStatusLabel[task.status]}</span></div><p className="mt-2 text-sm text-slate-500">{task.task_no} · {auth.availableStores.find((store) => store.id === task.store_id)?.name}{task.assigned_profile_id ? ` · ${recipients.find((item) => item.id === task.assigned_profile_id)?.display_name ?? '指定人员'}` : ' · 门店全体'} · 截止 {new Date(task.due_at).toLocaleString('zh-CN')}{task.schedule_id ? ' · 周期任务' : ''}</p></Link>)}</section>
    </> : null}

    {editingSchedule ? <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 p-4"><div className="mx-auto mt-8 max-w-xl rounded-xl bg-white p-4"><h2 className="text-lg font-bold">编辑周期规则</h2><ScheduleRuleEditor fields={fields} onChange={setFields} /><div className="mt-4 grid grid-cols-2 gap-2"><button className="ui-button-secondary" onClick={() => setEditingSchedule(null)} type="button">取消</button><button className="ui-button-primary" disabled={busy} onClick={() => void saveSchedule()} type="button">保存周期</button></div></div></div> : null}
    <ActionFeedbackDialog message={message ?? ''} onClose={() => setMessage(null)} open={Boolean(message)} title="操作提示" tone={message?.includes('失败') || message?.includes('必须') || message?.includes('请选择') ? 'warning' : 'success'} />
  </PageShell>;
}

export function AdminV2TaskPublishPage() {
  return <AdminV2TasksPage publisherOnly />;
}

function ScheduleRuleEditor({ fields, onChange }: { fields: V2TaskScheduleFields; onChange: (value: V2TaskScheduleFields) => void }) {
  const numeric = (value: string) => value === '' ? null : Number(value);
  return <section className="mt-3 rounded-lg bg-slate-50 p-3"><p className="font-semibold">发布周期</p><div className="mt-2 grid gap-2 sm:grid-cols-3"><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.scheduleType === 'interval_days'} onChange={() => onChange({ ...fields, scheduleType: 'interval_days' })} type="radio" /> 每 <input className="mx-1 h-9 w-16 rounded border px-2" min="1" onChange={(event) => onChange({ ...fields, intervalDays: numeric(event.target.value) })} type="number" value={fields.intervalDays ?? ''} /> 天发布</label><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.scheduleType === 'weekly'} onChange={() => onChange({ ...fields, scheduleType: 'weekly' })} type="radio" /> 每周发布</label><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.scheduleType === 'monthly'} onChange={() => onChange({ ...fields, scheduleType: 'monthly' })} type="radio" /> 每月 <input className="mx-1 h-9 w-14 rounded border px-2" max="31" min="1" onChange={(event) => onChange({ ...fields, monthDay: numeric(event.target.value) })} type="number" value={fields.monthDay ?? ''} /> 日</label></div>{fields.scheduleType === 'weekly' ? <div className="mt-2 flex flex-wrap gap-2">{weeklyDeadlineOptions.map((item) => <button className={`rounded-lg border px-3 py-2 text-sm ${fields.weekdays.includes(item.value) ? 'border-brand-700 bg-brand-50 text-brand-800' : 'bg-white'}`} key={item.value} onClick={() => onChange({ ...fields, weekdays: fields.weekdays.includes(item.value) ? fields.weekdays.filter((value) => value !== item.value) : [...fields.weekdays, item.value].sort() })} type="button">{item.label}</button>)}</div> : null}<label className="mt-2 block text-sm font-semibold">发布时间<input className="ui-input mt-1" onChange={(event) => onChange({ ...fields, publishTime: event.target.value })} type="time" value={fields.publishTime} /></label>
    <p className="mt-4 font-semibold">验收周期</p><div className="mt-2 grid gap-2 sm:grid-cols-3"><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.acceptanceType === 'daily'} onChange={() => onChange({ ...fields, acceptanceType: 'daily' })} type="radio" /> 发布后 <input className="mx-1 h-9 w-14 rounded border px-2" min="1" onChange={(event) => onChange({ ...fields, acceptanceIntervalDays: numeric(event.target.value) })} type="number" value={fields.acceptanceIntervalDays ?? ''} /> 天</label><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.acceptanceType === 'weekly'} onChange={() => onChange({ ...fields, acceptanceType: 'weekly' })} type="radio" /> 每周验收</label><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.acceptanceType === 'monthly'} onChange={() => onChange({ ...fields, acceptanceType: 'monthly' })} type="radio" /> 每月 <input className="mx-1 h-9 w-14 rounded border px-2" max="31" min="1" onChange={(event) => onChange({ ...fields, acceptanceMonthDay: numeric(event.target.value) })} type="number" value={fields.acceptanceMonthDay ?? ''} /> 日</label></div>{fields.acceptanceType === 'weekly' ? <label className="mt-2 block text-sm font-semibold">每周验收日<select className="ui-input mt-1" onChange={(event) => onChange({ ...fields, acceptanceWeekday: Number(event.target.value) })} value={fields.acceptanceWeekday ?? ''}><option value="">请选择</option>{weeklyDeadlineOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : null}<label className="mt-2 block text-sm font-semibold">验收时间<input className="ui-input mt-1" onChange={(event) => onChange({ ...fields, acceptanceTime: event.target.value })} type="time" value={fields.acceptanceTime} /></label><p className="mt-2 text-xs leading-5 text-slate-500">周期任务创建后立即发布首个任务；验收时间必须晚于本次发布、早于下一次发布。</p>
  </section>;
}
