import { PauseCircle, Pencil, Rocket, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { PageShell } from '../components/layout/PageShell';
import { SegmentedControl } from '../components/ui/FormField';
import { ArrivalPeriodFilter } from '../features/arrivals/ArrivalPeriodFilter';
import { createDefaultArrivalPeriod, resolveArrivalPeriod, type ArrivalPeriodValue } from '../features/arrivals/arrivalPeriod';
import { weeklyDeadlineOptions } from '../features/task-templates/recurrence';
import { useAuth } from '../features/auth/AuthContext';
import { TaskContentEditor } from '../features/v2-tasks/TaskContentEditor';
import { taskContentFromSnapshot, taskContentReferencePaths, taskContentToSnapshot, validateTaskContent, type TaskContentDraft } from '../features/v2-tasks/taskContent';
import { v2TaskStatusClass, v2TaskStatusLabel } from '../features/v2-tasks/taskPresentation';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import { loadTaskCategories, loadTaskTemplates, type TaskCategoryRow, type TaskTemplateListItem } from '../services/task-templates.service';
import {
  createV2TaskSchedule,
  deleteV2TaskReferenceImages,
  loadV2TaskContentReferenceImageUrls,
  loadV2TaskScheduleContent,
  loadV2TaskRecipients,
  loadV2TaskSchedules,
  loadV2Tasks,
  pauseV2TaskSchedule,
  publishV2Tasks,
  resumeV2TaskSchedule,
  uploadV2TaskReferenceImage,
  updateV2TaskContent,
  updateV2TaskScheduleAll,
  withdrawV2TaskSchedule,
  type TaskAudience,
  type V2TaskRecipient,
  type V2TaskRow,
  type V2TaskScheduleFields,
  type V2TaskScheduleRow,
} from '../services/v2-tasks.service';

const pad = (value: number) => String(value).padStart(2, '0');
const localDateValue = (value: Date | string = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const completedAt = (task: V2TaskRow) => task.reviewed_at ?? task.submitted_at ?? task.updated_at;
const toDatetimeLocalValue = (iso: string) => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const defaultSingleDue = () => {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T20:00`;
};
const defaultSinglePublishAt = () => {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const defaultRecurringPublishAt = () => {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
};
const defaultFields = (): V2TaskScheduleFields => ({
  acceptanceIntervalDays: 0,
  acceptanceMonthDay: null,
  acceptanceTime: '20:00',
  acceptanceType: 'daily',
  acceptanceWeekday: null,
  intervalDays: 7,
  managerReviewEnabled: false,
  monthDay: null,
  nextPublishAt: defaultRecurringPublishAt(),
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
  managerReviewEnabled: row.manager_review_enabled,
  monthDay: row.month_day,
  nextPublishAt: row.next_due_at,
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
  if (fields.acceptanceType === 'daily' && (!Number.isInteger(fields.acceptanceIntervalDays) || (fields.acceptanceIntervalDays ?? -1) < 0 || (fields.acceptanceIntervalDays ?? 0) > 31)) return '按天验收请输入 0 到 31 天，0 表示当日验收。';
  if (fields.acceptanceType === 'weekly' && !fields.acceptanceWeekday) return '请选择每周验收日。';
  if (fields.acceptanceType === 'monthly' && (!Number.isInteger(fields.acceptanceMonthDay) || (fields.acceptanceMonthDay ?? 0) < 1 || (fields.acceptanceMonthDay ?? 0) > 31)) return '每月验收日请输入 1 到 31。';
  const release = new Date(fields.nextPublishAt);
  if (!fields.nextPublishAt || Number.isNaN(release.getTime())) return '请设置首次或下次发布时间。';
  if (release <= new Date()) return '首次或下次发布时间必须晚于当前时间。';
  const due = acceptanceDueAt(release, fields);
  const nextRelease = nextReleaseAt(release, fields);
  if (due <= release) return '验收时间必须晚于本次发布时间。';
  if (due >= nextRelease) return '验收时间必须早于下一次发布时间，请调整发布周期或验收周期。';
  return null;
};
const scheduleText = (row: V2TaskScheduleRow) => {
  const release = row.schedule_type === 'interval_days' ? `每 ${row.interval_days} 天` : row.schedule_type === 'weekly' ? `每周 ${row.weekdays.map((value) => weeklyDeadlineOptions.find((item) => item.value === value)?.label).join('、')}` : `每月 ${row.month_day} 日`;
  const acceptance = row.acceptance_type === 'daily' ? row.acceptance_interval_days === 0 ? '发布当日' : `发布后 ${row.acceptance_interval_days} 天` : row.acceptance_type === 'weekly' ? `每周 ${weeklyDeadlineOptions.find((item) => item.value === row.acceptance_weekday)?.label}` : `每月 ${row.acceptance_month_day} 日`;
  return `${release} ${row.publish_time.slice(0, 5)} 发布 · ${acceptance} ${row.due_time.slice(0, 5)} 验收${row.manager_review_enabled ? ' · 员工提交可由店长审核' : ''}`;
};

export function AdminV2TasksPage({ publisherOnly = false }: { publisherOnly?: boolean }) {
  const auth = useAuth();
  const [templates, setTemplates] = useState<TaskTemplateListItem[]>([]);
  const [categories, setCategories] = useState<TaskCategoryRow[]>([]);
  const [tasks, setTasks] = useState<V2TaskRow[]>([]);
  const [schedules, setSchedules] = useState<V2TaskScheduleRow[]>([]);
  const [recipients, setRecipients] = useState<V2TaskRecipient[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [due, setDue] = useState(defaultSingleDue);
  const [singlePublishMode, setSinglePublishMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [singlePublishAt, setSinglePublishAt] = useState(defaultSinglePublishAt);
  const [publishImmediately, setPublishImmediately] = useState(false);
  const [creationMode, setCreationMode] = useState<'single' | 'recurring'>('single');
  const [recipientMode, setRecipientMode] = useState<'stores' | 'employee'>('stores');
  const [targetAudiences, setTargetAudiences] = useState<TaskAudience[]>(['staff', 'manager']);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [fields, setFields] = useState<V2TaskScheduleFields>(defaultFields);
  const [editingSchedule, setEditingSchedule] = useState<V2TaskScheduleRow | null>(null);
  const [editingTask, setEditingTask] = useState<V2TaskRow | null>(null);
  const [contentDraft, setContentDraft] = useState<TaskContentDraft | null>(null);
  const [originalReferencePaths, setOriginalReferencePaths] = useState<string[]>([]);
  const [pendingReferencePaths, setPendingReferencePaths] = useState<string[]>([]);
  const [editingDue, setEditingDue] = useState('');
  const [scheduleContentEditorOpen, setScheduleContentEditorOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taskView, setTaskView] = useRememberedPageState<'active' | 'completed'>('task-view', 'active');
  const [completedPeriod, setCompletedPeriod] = useRememberedPageState<ArrivalPeriodValue>('completed-period', {
    ...createDefaultArrivalPeriod(localDateValue()),
    mode: 'month',
  });
  const [completedStoreId, setCompletedStoreId] = useRememberedPageState('completed-store', '');
  const [completedCategory, setCompletedCategory] = useRememberedPageState('completed-category', '');
  const [completedSearch, setCompletedSearch] = useRememberedPageState('completed-search', '');

  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const [nextTemplates, nextCategories, nextTasks, nextSchedules, nextRecipients] = await Promise.all([loadTaskTemplates(supabase), loadTaskCategories(supabase), loadV2Tasks(supabase), loadV2TaskSchedules(supabase), loadV2TaskRecipients(supabase)]);
      setTemplates(nextTemplates.filter((item) => item.status === 'published'));
      setCategories(nextCategories);
      setTasks(nextTasks);
      setSchedules(nextSchedules);
      setRecipients(nextRecipients);
    } catch (error) { setMessage(error instanceof Error ? error.message : '加载任务失败'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const selectedTemplate = useMemo(() => templates.find((item) => item.id === templateId) ?? null, [templateId, templates]);
  const selectedRecipient = recipients.find((item) => item.id === selectedProfileId);
  const selectedRecipientAudience: TaskAudience | null = selectedRecipient ? selectedRecipient.employment_type === 'part_time' ? 'part_time' : selectedRecipient.role === 'manager' ? 'manager' : 'staff' : null;
  const activeTasks = useMemo(
    () => tasks.filter((task) => !['approved', 'cancelled'].includes(task.status)),
    [tasks],
  );
  const completedTasks = useMemo(
    () => tasks.filter((task) => task.status === 'approved')
      .sort((left, right) => new Date(completedAt(right)).getTime() - new Date(completedAt(left)).getTime()),
    [tasks],
  );
  const completedCategoryOptions = useMemo(() => {
    const labels = new Map(categories.map((category) => [category.code, category.label]));
    return [...new Set(completedTasks.map((task) => task.category))].sort().map((value) => ({
      label: labels.get(value) ?? value,
      value,
    }));
  }, [categories, completedTasks]);
  const filteredCompletedTasks = useMemo(() => {
    let dateFrom = '';
    let dateTo = '';
    try {
      ({ dateFrom, dateTo } = resolveArrivalPeriod(completedPeriod));
    } catch {
      return [];
    }
    const keyword = completedSearch.trim().toLocaleLowerCase('zh-CN');
    return completedTasks.filter((task) => {
      const finishedDate = localDateValue(completedAt(task));
      const storeName = auth.availableStores.find((store) => store.id === task.store_id)?.name ?? '';
      const recipientName = task.assigned_profile_id
        ? recipients.find((recipient) => recipient.id === task.assigned_profile_id)?.display_name ?? ''
        : '门店全体';
      return finishedDate >= dateFrom
        && finishedDate <= dateTo
        && (!completedStoreId || task.store_id === completedStoreId)
        && (!completedCategory || task.category === completedCategory)
        && (!keyword || `${task.name} ${task.task_no} ${storeName} ${recipientName}`.toLocaleLowerCase('zh-CN').includes(keyword));
    });
  }, [auth.availableStores, completedCategory, completedPeriod, completedSearch, completedStoreId, completedTasks, recipients]);

  const publish = async () => {
    if (!supabase) return;
    if (!selectedTemplate) return setMessage('请先选择已发布的任务模板。');
    if (!storeIds.length) return setMessage('请至少选择一个门店。');
    if (recipientMode === 'stores' && !targetAudiences.length) return setMessage('请至少勾选一个接收范围。');
    if (recipientMode === 'employee' && !selectedProfileId) return setMessage('请选择单独接收任务的员工、店长或兼职。');
    const effectivePublishAt = singlePublishMode === 'scheduled' ? new Date(singlePublishAt) : new Date();
    if (creationMode === 'single' && (Number.isNaN(effectivePublishAt.getTime()) || !due || new Date(due) <= effectivePublishAt)) return setMessage('单次任务的验收时间必须晚于发布时间。');
    if (creationMode === 'recurring') {
      const issue = validateSchedule(fields); if (issue) return setMessage(issue);
      if (publishImmediately) {
        const immediateDue = acceptanceDueAt(new Date(), fields);
        if (immediateDue <= new Date()) return setMessage('立即发布任务的验收时间必须晚于当前时间。');
        if (immediateDue >= new Date(fields.nextPublishAt)) return setMessage('立即发布任务的验收截止时间必须早于首次定时发布时间。');
      }
    }
    setBusy(true);
    try {
      const audiences = recipientMode === 'employee' && selectedRecipientAudience ? [selectedRecipientAudience] : targetAudiences;
      if (creationMode === 'single') await publishV2Tasks(supabase, templateId, storeIds, new Date(due).toISOString(), effectivePublishAt.toISOString(), recipientMode === 'employee' ? [selectedProfileId] : [], audiences, fields.managerReviewEnabled);
      else await createV2TaskSchedule(supabase, { ...fields, profileIds: recipientMode === 'employee' ? [selectedProfileId] : [], publishImmediately, storeIds, targetAudiences: audiences, templateId });
      setMessage(creationMode === 'single'
        ? singlePublishMode === 'scheduled' ? `单次任务已设为 ${effectivePublishAt.toLocaleString('zh-CN')} 发布。` : '单次任务已发布。'
        : publishImmediately ? '周期任务已创建，并已立即发布首条任务。' : '周期任务已创建，将在首次设定的发布时间自动发布。');
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
    if (!supabase || !window.confirm('撤回后会取消当前未完成任务并停止以后自动发布，且不能继续恢复。确认撤回这个周期任务吗？')) return;
    setBusy(true); try { await withdrawV2TaskSchedule(supabase, row.id); window.dispatchEvent(new Event('storehub:todos-changed')); setMessage('周期任务已撤回，后续不会再自动发布。'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : '撤回失败'); } finally { setBusy(false); }
  };
  const startScheduleEdit = async (row: V2TaskScheduleRow) => {
    if (!supabase) return;
    setBusy(true);
    try {
      const currentTask = tasks.find((task) => task.schedule_id === row.id && ['pending', 'in_progress', 'rejected', 'overdue'].includes(task.status));
      const content = currentTask ? { name: currentTask.name, snapshot: currentTask.snapshot } : await loadV2TaskScheduleContent(supabase, row.id);
      const referenceUrls = await loadV2TaskContentReferenceImageUrls(supabase, content.snapshot);
      const nextDraft = taskContentFromSnapshot(content.name, content.snapshot, referenceUrls);
      setFields(scheduleFieldsFromRow(row));
      setContentDraft(nextDraft);
      setOriginalReferencePaths(taskContentReferencePaths(nextDraft));
      setPendingReferencePaths([]);
      setEditingSchedule(row);
    } catch (error) { setMessage(error instanceof Error ? error.message : '周期任务内容加载失败'); }
    finally { setBusy(false); }
  };
  const startTaskEdit = async (task: V2TaskRow) => {
    if (!supabase) return;
    setBusy(true);
    try {
      const referenceUrls = await loadV2TaskContentReferenceImageUrls(supabase, task.snapshot);
      const nextDraft = taskContentFromSnapshot(task.name, task.snapshot, referenceUrls);
      setEditingTask(task);
      setEditingDue(toDatetimeLocalValue(task.due_at));
      setContentDraft(nextDraft);
      setOriginalReferencePaths(taskContentReferencePaths(nextDraft));
      setPendingReferencePaths([]);
    } catch (error) { setMessage(error instanceof Error ? error.message : '任务内容加载失败'); }
    finally { setBusy(false); }
  };
  const uploadReferenceImage = async (itemId: string, file: File, onProgress: (progress: number) => void) => {
    if (!supabase || !contentDraft) throw new Error('任务内容尚未加载完成。');
    const assetOwnerId = editingTask?.id ?? editingSchedule?.id;
    if (!assetOwnerId) throw new Error('任务编号无效，无法上传参考图片。');
    const uploaded = await uploadV2TaskReferenceImage(supabase, assetOwnerId, itemId, file, onProgress);
    setPendingReferencePaths((current) => [...current, uploaded.path]);
    setContentDraft((current) => current ? {
      ...current,
      groups: current.groups.map((group) => ({
        ...group,
        items: group.items.map((item) => item.id === itemId ? {
          ...item,
          referenceImagePaths: [...item.referenceImagePaths, uploaded.path],
          referenceImageUrls: [...item.referenceImageUrls, uploaded.previewUrl],
        } : item),
      })),
    } : current);
  };
  const removeReferenceImage = (itemId: string, path: string) => setContentDraft((current) => current ? {
    ...current,
    groups: current.groups.map((group) => ({
      ...group,
      items: group.items.map((item) => {
        if (item.id !== itemId) return item;
        const index = item.referenceImagePaths.indexOf(path);
        return {
          ...item,
          referenceImagePaths: item.referenceImagePaths.filter((entry) => entry !== path),
          referenceImageUrls: item.referenceImageUrls.filter((_, currentIndex) => currentIndex !== index),
        };
      }),
    })),
  } : current);
  const cleanupCancelledAssets = () => {
    if (supabase && pendingReferencePaths.length) void deleteV2TaskReferenceImages(supabase, pendingReferencePaths).catch(() => undefined);
    setPendingReferencePaths([]);
  };
  const cleanupSavedAssets = async (nextDraft: TaskContentDraft) => {
    if (!supabase) return;
    const retained = new Set(taskContentReferencePaths(nextDraft));
    const assetOwnerId = editingTask?.id ?? editingSchedule?.id;
    // Template-origin images are shared by immutable template versions and
    // other tasks. Removing one from this task must only detach its path from
    // the snapshot; physical cleanup is limited to this task/schedule folder.
    const obsolete = assetOwnerId ? [...new Set([...originalReferencePaths, ...pendingReferencePaths]
      .filter((path) => path.startsWith(`${assetOwnerId}/`) && !retained.has(path)))] : [];
    if (obsolete.length) await deleteV2TaskReferenceImages(supabase, obsolete);
    setPendingReferencePaths([]);
    setOriginalReferencePaths([...retained]);
  };
  const saveSchedule = async () => {
    if (!supabase || !editingSchedule || !contentDraft) return;
    const issue = validateSchedule(fields); if (issue) return setMessage(issue);
    const contentIssue = validateTaskContent(contentDraft); if (contentIssue) return setMessage(contentIssue);
    setBusy(true); try { await updateV2TaskScheduleAll(supabase, editingSchedule.id, fields, contentDraft.name, taskContentToSnapshot(contentDraft)); await cleanupSavedAssets(contentDraft); setEditingSchedule(null); setContentDraft(null); setMessage('周期规则和完整任务内容已同步更新。'); window.dispatchEvent(new Event('storehub:todos-changed')); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : '周期任务保存失败'); } finally { setBusy(false); }
  };
  const saveTaskContent = async () => {
    if (!supabase || !editingTask || !contentDraft) return;
    const issue = validateTaskContent(contentDraft); if (issue) return setMessage(issue);
    if (!editingDue || new Date(editingDue) <= new Date()) return setMessage('验收截止时间必须晚于当前时间。');
    setBusy(true);
    try {
      await updateV2TaskContent(supabase, editingTask.id, contentDraft.name, taskContentToSnapshot(contentDraft), new Date(editingDue).toISOString());
      await cleanupSavedAssets(contentDraft);
      setEditingTask(null); setContentDraft(null); setMessage('任务内容已更新，员工页面会立即同步。'); window.dispatchEvent(new Event('storehub:todos-changed')); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '任务内容保存失败'); }
    finally { setBusy(false); }
  };

  return <PageShell eyebrow="门店运营系统 · 管理员" title={publisherOnly ? '任务发布' : '任务管理'} backTo="/app/workbench">
    {!publisherOnly ? <section className="grid grid-cols-2 gap-2"><Link className="flex min-h-12 items-center justify-center rounded-lg bg-brand-600 px-3 text-center font-bold text-white" to="/app/admin/task-templates">管理任务模板</Link><Link className="flex min-h-12 items-center justify-center rounded-lg bg-brand-600 px-3 text-center font-bold text-white" to="/app/admin/tasks/publish">任务发布</Link></section> : null}
    {publisherOnly ? <section className="ui-card p-4">
      <h2 className="font-bold">发布任务</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">任务模板<select className="ui-input mt-1" onChange={(event) => { const id = event.target.value; setTemplateId(id); setStoreIds(templates.find((item) => item.id === id)?.storeIds ?? []); }} value={templateId}><option value="">请选择模板</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm font-semibold">发布方式<select className="ui-input mt-1" onChange={(event) => setCreationMode(event.target.value as 'single' | 'recurring')} value={creationMode}><option value="single">单次任务</option><option value="recurring">周期任务</option></select></label>
        <label className="text-sm font-semibold">发布对象<select className="ui-input mt-1" onChange={(event) => setRecipientMode(event.target.value as 'stores' | 'employee')} value={recipientMode}><option value="stores">按门店角色发布</option><option value="employee">单独指定一人</option></select></label>
        {recipientMode === 'employee' ? <label className="text-sm font-semibold">接收人<select className="ui-input mt-1" onChange={(event) => { const id = event.target.value; setSelectedProfileId(id); const recipient = recipients.find((item) => item.id === id); if (recipient?.store_id) setStoreIds([recipient.store_id]); }} value={selectedProfileId}><option value="">请选择人员</option>{recipients.map((item) => <option key={item.id} value={item.id}>{item.display_name} · {item.employment_type === 'part_time' ? '兼职' : item.role === 'manager' ? '店长' : '员工'}</option>)}</select></label> : null}
      </div>
      {recipientMode === 'stores' ? <fieldset className="mt-3"><legend className="text-sm font-semibold">接收范围（可多选）</legend><div className="mt-2 grid grid-cols-3 gap-2">{([['staff','员工'],['manager','店长'],['part_time','兼职']] as const).map(([value,label]) => <label className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold" key={value}><input checked={targetAudiences.includes(value)} onChange={(event) => setTargetAudiences((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} type="checkbox" />{label}</label>)}</div><p className="mt-2 text-xs text-slate-500">兼职默认不勾选；只有主动勾选后，兼职账号才会收到门店任务。</p></fieldset> : null}
      <fieldset className="mt-3"><legend className="text-sm font-semibold">适用门店</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{auth.availableStores.map((store) => <label className="flex min-h-11 items-center rounded-lg border px-3 text-sm" key={store.id}><input checked={storeIds.includes(store.id)} className="mr-2" disabled={recipientMode === 'employee'} onChange={() => setStoreIds((current) => current.includes(store.id) ? current.filter((id) => id !== store.id) : [...current, store.id])} type="checkbox" />{store.name}</label>)}</div>{recipientMode === 'employee' && selectedRecipient ? <p className="mt-2 text-xs text-slate-500">已按 {selectedRecipient.display_name} 的所属门店锁定。</p> : null}</fieldset>
      <label className="mt-3 flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm"><input checked={fields.managerReviewEnabled} className="mt-1" onChange={(event) => setFields((current) => ({ ...current, managerReviewEnabled: event.target.checked }))} type="checkbox" /><span><b className="block text-brand-900">允许店长审核员工提交</b><span className="mt-1 block text-xs leading-5 text-brand-800">管理员始终可以审核；店长只能审核本门店员工提交的任务，店长本人提交的任务必须由管理员审核。</span></span></label>
      {creationMode === 'single' ? <section className="mt-3 rounded-lg bg-slate-50 p-3"><p className="font-semibold">发布时间</p><div className="mt-2 grid grid-cols-2 gap-2"><label className="rounded-lg border bg-white p-2 text-sm"><input checked={singlePublishMode === 'immediate'} onChange={() => setSinglePublishMode('immediate')} type="radio" /> 立即发布</label><label className="rounded-lg border bg-white p-2 text-sm"><input checked={singlePublishMode === 'scheduled'} onChange={() => setSinglePublishMode('scheduled')} type="radio" /> 定时发布</label></div>{singlePublishMode === 'scheduled' ? <label className="mt-2 block text-sm font-semibold">定时发布时间<input className="ui-input mt-1" min={toDatetimeLocalValue(new Date().toISOString())} onChange={(event) => setSinglePublishAt(event.target.value)} type="datetime-local" value={singlePublishAt} /></label> : null}<label className="mt-3 block text-sm font-semibold">验收截止时间<input className="ui-input mt-1" onChange={(event) => setDue(event.target.value)} type="datetime-local" value={due} /></label></section> : <><ScheduleRuleEditor fields={fields} onChange={setFields} /><label className="mt-3 flex items-center rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900"><input checked={publishImmediately} className="mr-2" onChange={(event) => setPublishImmediately(event.target.checked)} type="checkbox" />创建周期任务时立即发布一次</label><p className="mt-1 text-xs leading-5 text-slate-500">勾选后会立即生成一条任务，后续仍从“首次定时发布时间”开始按周期发布。</p></>}
      <button className="ui-button-primary mt-4 w-full" disabled={busy} onClick={() => void publish()} type="button"><Rocket className="h-4 w-4" />{busy ? '正在发布' : '确认发布'}</button>
    </section> : null}

    {!publisherOnly ? <>
      <SegmentedControl className="grid-cols-2" items={[
        { active: taskView === 'active', label: `进行中任务 ${activeTasks.length}`, onClick: () => setTaskView('active') },
        { active: taskView === 'completed', label: `已完成任务 ${completedTasks.length}`, onClick: () => setTaskView('completed') },
      ]} />

      {taskView === 'active' ? <section className="space-y-3"><h2 className="font-bold">周期任务</h2>{schedules.length ? schedules.map((row) => <article className="ui-card p-4" key={row.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b>{row.content_name ?? templates.find((item) => item.id === row.template_id)?.name ?? '已归档模板的周期任务'}</b><p className="mt-1 text-sm text-slate-600">{auth.availableStores.find((store) => store.id === row.store_id)?.name}{row.assigned_profile_id ? ` · ${recipients.find((item) => item.id === row.assigned_profile_id)?.display_name ?? '指定人员'}` : ' · 门店全体'}</p><p className="mt-1 text-xs leading-5 text-slate-500">{scheduleText(row)}<br />下次发布：{new Date(row.next_due_at).toLocaleString('zh-CN')}</p></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${row.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{row.is_active ? '运行中' : '已暂停'}</span></div><div className="mt-3 grid grid-cols-3 gap-2"><button className="ui-button-secondary px-2" disabled={busy} onClick={() => void startScheduleEdit(row)} type="button"><Pencil className="h-4 w-4" />编辑</button><button className="ui-button-secondary border-red-200 px-2 text-red-700" disabled={busy} onClick={() => void withdraw(row)} type="button"><Undo2 className="h-4 w-4" />撤回周期</button>{row.is_active ? <button className="ui-button-secondary px-2" disabled={busy} onClick={() => void pause(row)} type="button"><PauseCircle className="h-4 w-4" />暂停</button> : <button className="ui-button-primary px-2" disabled={busy} onClick={() => void resume(row)} type="button">继续</button>}</div></article>) : <p className="ui-card p-4 text-sm text-slate-500">暂无周期任务计划。</p>}</section> : null}

      {taskView === 'completed' ? <section className="ui-card p-3">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="font-bold">已完成任务筛选</h2><p className="mt-0.5 text-xs text-slate-500">共 {completedTasks.length} 条，当前显示 {filteredCompletedTasks.length} 条</p></div>
          <button className="shrink-0 text-sm font-bold text-brand-700" onClick={() => {
            setCompletedPeriod({ ...createDefaultArrivalPeriod(localDateValue()), mode: 'month' });
            setCompletedStoreId('');
            setCompletedCategory('');
            setCompletedSearch('');
          }} type="button">重置</button>
        </div>
        <div className="mt-3">
          <ArrivalPeriodFilter compact onChange={setCompletedPeriod} value={completedPeriod} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-slate-600">门店<select className="ui-input mt-0.5 min-h-9 py-1 text-sm" onChange={(event) => setCompletedStoreId(event.target.value)} value={completedStoreId}><option value="">全部门店</option>{auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">任务分类<select className="ui-input mt-0.5 min-h-9 py-1 text-sm" onChange={(event) => setCompletedCategory(event.target.value)} value={completedCategory}><option value="">全部分类</option>{completedCategoryOptions.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
        </div>
        <label className="mt-2 block text-xs font-semibold text-slate-600">搜索任务<input className="ui-input mt-0.5 min-h-9 py-1 text-sm" onChange={(event) => setCompletedSearch(event.target.value)} placeholder="任务名称、编号或人员" type="search" value={completedSearch} /></label>
      </section> : null}

      <section className="space-y-3">
        <h2 className="font-bold">{taskView === 'active' ? '任务清单' : '已完成任务'}</h2>
        {(taskView === 'active' ? activeTasks : filteredCompletedTasks).map((task) => <article className="ui-card p-4" key={task.id}><Link className="ui-interactive block" to={`/app/admin/tasks/${task.id}`}><div className="flex justify-between gap-3"><b>{task.name}</b><span className={`rounded-full px-3 py-1 text-xs font-bold ${v2TaskStatusClass[task.status]}`}>{task.status === 'resubmitted' ? '已重新提交 · 待审核' : v2TaskStatusLabel[task.status]}</span></div><p className="mt-2 text-sm text-slate-500">{task.task_no} · {auth.availableStores.find((store) => store.id === task.store_id)?.name}{task.assigned_profile_id ? ` · ${recipients.find((item) => item.id === task.assigned_profile_id)?.display_name ?? '指定人员'}` : ' · 门店全体'} · {task.status === 'approved' ? `完成 ${new Date(completedAt(task)).toLocaleString('zh-CN')}` : `截止 ${new Date(task.due_at).toLocaleString('zh-CN')}`}{task.schedule_id ? ' · 周期任务' : ''}</p></Link>{!task.schedule_id && ['pending', 'in_progress', 'rejected', 'overdue'].includes(task.status) ? <button className="ui-button-secondary mt-3 w-full" disabled={busy} onClick={() => void startTaskEdit(task)} type="button"><Pencil className="h-4 w-4" />编辑完整任务</button> : null}</article>)}
        {(taskView === 'active' ? activeTasks : filteredCompletedTasks).length === 0 ? <p className="ui-card p-4 text-sm text-slate-500">{taskView === 'active' ? '当前没有进行中的任务。' : '当前筛选条件下没有已完成任务。'}</p> : null}
      </section>
    </> : null}

    {editingSchedule ? <div className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3"><div className="mx-auto max-w-xl pb-[calc(7.5rem+env(safe-area-inset-bottom))]"><div className="ui-card p-4"><h2 className="text-lg font-bold">编辑周期任务</h2><ScheduleRuleEditor fields={fields} onChange={setFields} /><button className="ui-button-secondary mt-3 w-full" onClick={() => setScheduleContentEditorOpen(true)} type="button"><Pencil className="h-4 w-4" />编辑完整任务内容</button><p className="mt-2 text-xs leading-5 text-slate-500">保存后会同步当前未完成任务，并用于以后自动发布的任务。</p><div className="mt-4 grid grid-cols-2 gap-2"><button className="ui-button-secondary" onClick={() => { cleanupCancelledAssets(); setEditingSchedule(null); setContentDraft(null); }} type="button">取消</button><button className="ui-button-primary" disabled={busy} onClick={() => void saveSchedule()} type="button">保存全部修改</button></div></div></div></div> : null}
    {editingTask && contentDraft ? <TaskContentEditor busy={busy} categories={categories} draft={contentDraft} dueAt={editingDue} onCancel={() => { cleanupCancelledAssets(); setEditingTask(null); setContentDraft(null); }} onChange={setContentDraft} onDueAtChange={setEditingDue} onRemoveReferenceImage={removeReferenceImage} onSave={() => void saveTaskContent()} onUploadReferenceImage={uploadReferenceImage} /> : null}
    {editingSchedule && scheduleContentEditorOpen && contentDraft ? <TaskContentEditor busy={busy} categories={categories} draft={contentDraft} onCancel={() => setScheduleContentEditorOpen(false)} onChange={setContentDraft} onRemoveReferenceImage={removeReferenceImage} onSave={() => { const issue = validateTaskContent(contentDraft); if (issue) setMessage(issue); else setScheduleContentEditorOpen(false); }} onUploadReferenceImage={uploadReferenceImage} title="编辑周期任务完整内容" /> : null}
    <ActionFeedbackDialog message={message ?? ''} onClose={() => setMessage(null)} open={Boolean(message)} title="操作提示" tone={message?.includes('失败') || message?.includes('必须') || message?.includes('请选择') ? 'warning' : 'success'} />
  </PageShell>;
}

export function AdminV2TaskPublishPage() {
  return <AdminV2TasksPage publisherOnly />;
}

function ScheduleRuleEditor({ fields, onChange }: { fields: V2TaskScheduleFields; onChange: (value: V2TaskScheduleFields) => void }) {
  const numeric = (value: string) => value === '' ? null : Number(value);
  return <section className="mt-3 rounded-lg bg-slate-50 p-3"><p className="font-semibold">发布周期</p><div className="mt-2 grid gap-2 sm:grid-cols-3"><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.scheduleType === 'interval_days'} onChange={() => onChange({ ...fields, scheduleType: 'interval_days' })} type="radio" /> 每 <input className="mx-1 h-9 w-16 rounded border px-2" min="1" onChange={(event) => onChange({ ...fields, intervalDays: numeric(event.target.value) })} type="number" value={fields.intervalDays ?? ''} /> 天发布</label><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.scheduleType === 'weekly'} onChange={() => onChange({ ...fields, scheduleType: 'weekly' })} type="radio" /> 每周发布</label><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.scheduleType === 'monthly'} onChange={() => onChange({ ...fields, scheduleType: 'monthly' })} type="radio" /> 每月 <input className="mx-1 h-9 w-14 rounded border px-2" max="31" min="1" onChange={(event) => onChange({ ...fields, monthDay: numeric(event.target.value) })} type="number" value={fields.monthDay ?? ''} /> 日</label></div>{fields.scheduleType === 'weekly' ? <div className="mt-2 flex flex-wrap gap-2">{weeklyDeadlineOptions.map((item) => <button className={`rounded-lg border px-3 py-2 text-sm ${fields.weekdays.includes(item.value) ? 'border-brand-700 bg-brand-50 text-brand-800' : 'bg-white'}`} key={item.value} onClick={() => onChange({ ...fields, weekdays: fields.weekdays.includes(item.value) ? fields.weekdays.filter((value) => value !== item.value) : [...fields.weekdays, item.value].sort() })} type="button">{item.label}</button>)}</div> : null}<label className="mt-2 block text-sm font-semibold">周期发布时间<input className="ui-input mt-1" onChange={(event) => onChange({ ...fields, publishTime: event.target.value })} type="time" value={fields.publishTime} /></label><label className="mt-2 block text-sm font-semibold">首次 / 下次发布时间<input className="ui-input mt-1" min={toDatetimeLocalValue(new Date().toISOString())} onChange={(event) => onChange({ ...fields, nextPublishAt: new Date(event.target.value).toISOString() })} type="datetime-local" value={toDatetimeLocalValue(fields.nextPublishAt)} /></label>
    <p className="mt-4 font-semibold">验收周期</p><div className="mt-2 grid gap-2 sm:grid-cols-3"><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.acceptanceType === 'daily'} onChange={() => onChange({ ...fields, acceptanceType: 'daily' })} type="radio" /> 发布后 <input className="mx-1 h-9 w-14 rounded border px-2" max="31" min="0" onChange={(event) => onChange({ ...fields, acceptanceIntervalDays: numeric(event.target.value) })} type="number" value={fields.acceptanceIntervalDays ?? ''} /> 天</label><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.acceptanceType === 'weekly'} onChange={() => onChange({ ...fields, acceptanceType: 'weekly' })} type="radio" /> 每周验收</label><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.acceptanceType === 'monthly'} onChange={() => onChange({ ...fields, acceptanceType: 'monthly' })} type="radio" /> 每月 <input className="mx-1 h-9 w-14 rounded border px-2" max="31" min="1" onChange={(event) => onChange({ ...fields, acceptanceMonthDay: numeric(event.target.value) })} type="number" value={fields.acceptanceMonthDay ?? ''} /> 日</label></div>{fields.acceptanceType === 'daily' ? <p className="mt-2 text-xs text-slate-500">填写 0 表示发布当日验收；当日验收时间必须晚于发布时间。</p> : null}{fields.acceptanceType === 'weekly' ? <label className="mt-2 block text-sm font-semibold">每周验收日<select className="ui-input mt-1" onChange={(event) => onChange({ ...fields, acceptanceWeekday: Number(event.target.value) })} value={fields.acceptanceWeekday ?? ''}><option value="">请选择</option>{weeklyDeadlineOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : null}<label className="mt-2 block text-sm font-semibold">验收时间<input className="ui-input mt-1" onChange={(event) => onChange({ ...fields, acceptanceTime: event.target.value })} type="time" value={fields.acceptanceTime} /></label><p className="mt-2 text-xs leading-5 text-slate-500">周期任务会在首次设定的发布时间生成；验收时间必须晚于本次发布、早于下一次发布。</p>
  </section>;
}
