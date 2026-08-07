import { PauseCircle, Pencil, Rocket, Search, Undo2, X } from 'lucide-react';
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
import { isV2TaskOverdue, v2TaskStatusClass, v2TaskStatusLabel } from '../features/v2-tasks/taskPresentation';
import { useTaskDeadlineClock } from '../features/v2-tasks/useTaskDeadlineClock';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import { PRODUCT_CATEGORIES, type ProductCategoryCode } from '../features/products/productCategories';
import { loadTaskCategories, loadTaskTemplates, type TaskCategoryRow, type TaskTemplateListItem } from '../services/task-templates.service';
import {
  createV2TaskSchedule,
  deleteV2TaskReferenceImages,
  loadV2TaskContentReferenceImageUrls,
  loadV2TaskRelatedContentOptions,
  loadV2TaskScheduleContent,
  loadV2TaskRecipients,
  loadV2TaskSchedules,
  loadV2TaskTimeline,
  loadV2Tasks,
  pauseV2TaskSchedule,
  publishV2Tasks,
  resumeV2TaskSchedule,
  uploadV2TaskReferenceImage,
  updateV2TaskContent,
  updateV2TaskRecipients,
  updateV2TaskScheduleAll,
  withdrawV2TaskSchedule,
  type TaskAudience,
  type V2TaskRecipient,
  type V2TaskCompletionMode,
  type V2TaskRelatedContentOption,
  type V2TaskRelatedContentType,
  type V2TaskRow,
  type V2TaskTimelineEvent,
  type V2TaskScheduleFields,
  type V2TaskScheduleRow,
} from '../services/v2-tasks.service';

const recipientAudience = (recipient: V2TaskRecipient): TaskAudience => recipient.employment_type === 'part_time'
  ? 'part_time'
  : recipient.role === 'manager' ? 'manager' : 'staff';

const pad = (value: number) => String(value).padStart(2, '0');
const localDateValue = (value: Date | string = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const completedAt = (task: V2TaskRow) => task.reviewed_at ?? task.submitted_at ?? task.updated_at;
const isWaitingForScheduledPublication = (task: V2TaskRow) => task.publish_notified_at === null;
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

const relatedContentTypeFromIds = (sopId: string | null, noticeId: string | null): 'none' | V2TaskRelatedContentType => (
  sopId ? 'sop' : noticeId ? 'notice' : 'none'
);

const compatibleRelatedContent = (
  options: V2TaskRelatedContentOption[],
  type: 'none' | V2TaskRelatedContentType,
  selectedStoreIds: string[],
  audiences: TaskAudience[],
) => {
  const requiredRoles = [...new Set(audiences.map((audience) => audience === 'part_time' ? 'staff' : audience))];
  return options
    .filter((option) => option.type === type
      && selectedStoreIds.every((storeId) => option.storeIds.includes(storeId))
      && (option.type !== 'sop' || requiredRoles.every((role) => option.roles.includes(role))))
    .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime());
};

export function AdminV2TasksPage({ publisherOnly = false }: { publisherOnly?: boolean }) {
  const auth = useAuth();
  const deadlineNow = useTaskDeadlineClock();
  const [templates, setTemplates] = useState<TaskTemplateListItem[]>([]);
  const [categories, setCategories] = useState<TaskCategoryRow[]>([]);
  const [tasks, setTasks] = useState<V2TaskRow[]>([]);
  const [taskTimeline, setTaskTimeline] = useState<V2TaskTimelineEvent[]>([]);
  const [schedules, setSchedules] = useState<V2TaskScheduleRow[]>([]);
  const [recipients, setRecipients] = useState<V2TaskRecipient[]>([]);
  const [relatedContentOptions, setRelatedContentOptions] = useState<V2TaskRelatedContentOption[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [due, setDue] = useState(defaultSingleDue);
  const [singlePublishMode, setSinglePublishMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [singlePublishAt, setSinglePublishAt] = useState(defaultSinglePublishAt);
  const [publishImmediately, setPublishImmediately] = useState(false);
  const [creationMode, setCreationMode] = useState<'single' | 'recurring'>('single');
  const [recipientMode, setRecipientMode] = useState<V2TaskCompletionMode>('shared');
  const [targetAudiences, setTargetAudiences] = useState<TaskAudience[]>(['staff', 'manager']);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [relatedContentType, setRelatedContentType] = useState<'none' | V2TaskRelatedContentType>('none');
  const [relatedContentId, setRelatedContentId] = useState('');
  const [inventoryLinkEnabled, setInventoryLinkEnabled] = useState(false);
  const [inventoryCategoryCodes, setInventoryCategoryCodes] = useState<ProductCategoryCode[]>(PRODUCT_CATEGORIES.map((category) => category.code));
  const [editingRelatedContentType, setEditingRelatedContentType] = useState<'none' | V2TaskRelatedContentType>('none');
  const [editingRelatedContentId, setEditingRelatedContentId] = useState('');
  const [editingInventoryLinkEnabled, setEditingInventoryLinkEnabled] = useState(false);
  const [editingInventoryCategoryCodes, setEditingInventoryCategoryCodes] = useState<ProductCategoryCode[]>(PRODUCT_CATEGORIES.map((category) => category.code));
  const [fields, setFields] = useState<V2TaskScheduleFields>(defaultFields);
  const [editingSchedule, setEditingSchedule] = useState<V2TaskScheduleRow | null>(null);
  const [editingTask, setEditingTask] = useState<V2TaskRow | null>(null);
  const [contentDraft, setContentDraft] = useState<TaskContentDraft | null>(null);
  const [originalReferencePaths, setOriginalReferencePaths] = useState<string[]>([]);
  const [pendingReferencePaths, setPendingReferencePaths] = useState<string[]>([]);
  const [editingDue, setEditingDue] = useState('');
  const [editingCompletionMode, setEditingCompletionMode] = useState<V2TaskCompletionMode>('shared');
  const [editingTargetAudiences, setEditingTargetAudiences] = useState<TaskAudience[]>(['staff', 'manager']);
  const [editingProfileId, setEditingProfileId] = useState('');
  const [editingProfileIds, setEditingProfileIds] = useState<string[]>([]);
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
  const canEditTaskRecipients = Boolean(editingTask && editingTask.status === 'pending' && !editingTask.started_by && !editingTask.submitted_by);

  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const [nextTemplates, nextCategories, nextTasks, nextSchedules, nextRecipients, nextRelatedContent, nextTimeline] = await Promise.all([loadTaskTemplates(supabase), loadTaskCategories(supabase), loadV2Tasks(supabase), loadV2TaskSchedules(supabase), loadV2TaskRecipients(supabase), loadV2TaskRelatedContentOptions(supabase), loadV2TaskTimeline(supabase)]);
      setTemplates(nextTemplates.filter((item) => item.status === 'published'));
      setCategories(nextCategories);
      setTasks(nextTasks);
      setSchedules(nextSchedules);
      setRecipients(nextRecipients);
      setRelatedContentOptions(nextRelatedContent);
      setTaskTimeline(nextTimeline);
    } catch (error) { setMessage(error instanceof Error ? error.message : '加载任务失败'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const selectedTemplate = useMemo(() => templates.find((item) => item.id === templateId) ?? null, [templateId, templates]);
  const selectedRecipient = recipients.find((item) => item.id === selectedProfileId);
  const selectedRecipientAudience: TaskAudience | null = selectedRecipient ? recipientAudience(selectedRecipient) : null;
  const selectedRecipients = useMemo(
    () => recipients.filter((recipient) => selectedProfileIds.includes(recipient.id)),
    [recipients, selectedProfileIds],
  );
  const selectedRecipientAudiences = useMemo(
    () => [...new Set(selectedRecipients.map(recipientAudience))],
    [selectedRecipients],
  );
  const effectiveAudiences = useMemo(
    () => recipientMode === 'single' && selectedRecipientAudience
      ? [selectedRecipientAudience]
      : recipientMode === 'selected'
        ? selectedRecipientAudiences
        : targetAudiences,
    [recipientMode, selectedRecipientAudience, selectedRecipientAudiences, targetAudiences],
  );
  const matchingRecipientIds = useMemo(() => recipients
    .filter((recipient) => storeIds.includes(recipient.store_id ?? '') && effectiveAudiences.includes(recipientAudience(recipient)))
    .map((recipient) => recipient.id), [effectiveAudiences, recipients, storeIds]);
  const compatibleRelatedContentOptions = useMemo(() => {
    return compatibleRelatedContent(relatedContentOptions, relatedContentType, storeIds, effectiveAudiences);
  }, [effectiveAudiences, relatedContentOptions, relatedContentType, storeIds]);
  const editingRelatedContentOptions = useMemo(() => {
    const source = editingTask ?? editingSchedule;
    if (!source) return [];
    return compatibleRelatedContent(
      relatedContentOptions,
      editingRelatedContentType,
      [source.store_id],
      (source.target_audiences ?? ['staff', 'manager']) as TaskAudience[],
    );
  }, [editingRelatedContentType, editingSchedule, editingTask, relatedContentOptions]);
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
    const incompatibleStores = auth.availableStores.filter((store) => storeIds.includes(store.id) && !selectedTemplate.storeIds.includes(store.id));
    if (incompatibleStores.length) return setMessage(`所选任务模板不适用于${incompatibleStores.map((store) => `“${store.name}”`).join('、')}，请先在任务模板中增加适用门店。`);
    if (!['single', 'selected'].includes(recipientMode) && !targetAudiences.length) return setMessage('请至少勾选一个接收范围。');
    if (recipientMode === 'single' && !selectedProfileId) return setMessage('请选择单独接收任务的员工、店长或兼职。');
    if (recipientMode === 'selected' && selectedProfileIds.length < 2) return setMessage('请至少选择两位需要分别完成任务的人员。');
    if (recipientMode === 'individual' && !matchingRecipientIds.length) return setMessage('当前门店和接收范围内没有可接收任务的人员。');
    const relatedContent = relatedContentType === 'none' ? null : compatibleRelatedContentOptions.find((item) => item.id === relatedContentId) ?? null;
    if (relatedContentType !== 'none' && !relatedContent) return setMessage('请选择与当前任务门店和接收角色匹配的已发布关联资料。');
    if (inventoryLinkEnabled && !inventoryCategoryCodes.length) return setMessage('关联点货时请至少选择一个货品分类。');
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
      const audiences = effectiveAudiences;
      const profileIds = recipientMode === 'single' ? [selectedProfileId] : recipientMode === 'selected' ? selectedProfileIds : recipientMode === 'individual' ? matchingRecipientIds : [];
      const inventoryLink = { categoryCodes: inventoryCategoryCodes, enabled: inventoryLinkEnabled };
      if (creationMode === 'single') await publishV2Tasks(supabase, templateId, storeIds, new Date(due).toISOString(), effectivePublishAt.toISOString(), profileIds, audiences, fields.managerReviewEnabled, relatedContent, inventoryLink);
      else await createV2TaskSchedule(supabase, { ...fields, completionMode: recipientMode, inventoryLink, profileIds, publishImmediately, relatedContent, storeIds, targetAudiences: audiences, templateId });
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
      setEditingRelatedContentType(relatedContentTypeFromIds(row.related_sop_id, row.related_notice_id));
      setEditingRelatedContentId(row.related_sop_id ?? row.related_notice_id ?? '');
      setEditingInventoryLinkEnabled(row.requires_inventory);
      setEditingInventoryCategoryCodes(row.inventory_category_codes as ProductCategoryCode[]);
      const groupedSchedules = schedules.filter((schedule) => schedule.recipient_group_id === row.recipient_group_id && schedule.store_id === row.store_id);
      const groupedProfileIds = groupedSchedules.map((schedule) => schedule.assigned_profile_id).filter((id): id is string => Boolean(id));
      const completionMode = row.completion_mode ?? (groupedProfileIds.length > 1 ? 'selected' : row.assigned_profile_id ? 'single' : 'shared');
      setEditingCompletionMode(completionMode);
      setEditingTargetAudiences((row.target_audiences ?? ['staff', 'manager']) as TaskAudience[]);
      setEditingProfileId(groupedProfileIds[0] ?? '');
      setEditingProfileIds(groupedProfileIds);
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
      setFields((current) => ({ ...current, managerReviewEnabled: task.manager_review_enabled }));
      setContentDraft(nextDraft);
      setOriginalReferencePaths(taskContentReferencePaths(nextDraft));
      setPendingReferencePaths([]);
      setEditingRelatedContentType(relatedContentTypeFromIds(task.related_sop_id, task.related_notice_id));
      setEditingRelatedContentId(task.related_sop_id ?? task.related_notice_id ?? '');
      setEditingInventoryLinkEnabled(task.requires_inventory);
      setEditingInventoryCategoryCodes(task.inventory_category_codes as ProductCategoryCode[]);
      setEditingCompletionMode(task.assigned_profile_id ? 'single' : 'shared');
      setEditingTargetAudiences((task.target_audiences ?? ['staff', 'manager']) as TaskAudience[]);
      setEditingProfileId(task.assigned_profile_id ?? '');
      setEditingProfileIds(task.assigned_profile_id ? [task.assigned_profile_id] : []);
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
    const relatedContent = editingRelatedContentType === 'none' ? null : editingRelatedContentOptions.find((item) => item.id === editingRelatedContentId) ?? null;
    if (editingRelatedContentType !== 'none' && !relatedContent) return setMessage('请选择与当前周期任务门店和接收角色匹配的已发布关联资料。');
    if (editingInventoryLinkEnabled && !editingInventoryCategoryCodes.length) return setMessage('关联点货时请至少选择一个货品分类。');
    const editProfileIds = editingCompletionMode === 'single'
      ? [editingProfileId]
      : editingCompletionMode === 'selected'
        ? editingProfileIds
        : editingCompletionMode === 'individual'
          ? recipients.filter((recipient) => recipient.store_id === editingSchedule.store_id && editingTargetAudiences.includes(recipientAudience(recipient))).map((recipient) => recipient.id)
          : [];
    if (editingCompletionMode === 'single' && !editingProfileId) return setMessage('请选择一位任务接收人。');
    if (editingCompletionMode === 'selected' && editingProfileIds.length < 2) return setMessage('请至少选择两位需要分别完成任务的人员。');
    if (!['single', 'selected'].includes(editingCompletionMode) && !editingTargetAudiences.length) return setMessage('请至少勾选一个接收范围。');
    if (editingCompletionMode === 'individual' && !editProfileIds.length) return setMessage('当前门店和接收范围内没有可接收任务的人员。');
    const singleRecipient = recipients.find((recipient) => recipient.id === editingProfileId);
    const editSelectedAudiences = [...new Set(recipients.filter((recipient) => editingProfileIds.includes(recipient.id)).map(recipientAudience))];
    const editAudiences = editingCompletionMode === 'single' && singleRecipient
      ? [recipientAudience(singleRecipient)]
      : editingCompletionMode === 'selected'
        ? editSelectedAudiences
        : editingTargetAudiences;
    setBusy(true); try { await updateV2TaskScheduleAll(supabase, editingSchedule.id, fields, contentDraft.name, taskContentToSnapshot(contentDraft), relatedContent, { categoryCodes: editingInventoryCategoryCodes, enabled: editingInventoryLinkEnabled }, editingCompletionMode, editProfileIds, editAudiences); await cleanupSavedAssets(contentDraft); setEditingSchedule(null); setContentDraft(null); setEditingRelatedContentType('none'); setEditingRelatedContentId(''); setMessage('周期规则、完成方式、任务内容和高级选项已同步更新。'); window.dispatchEvent(new Event('storehub:todos-changed')); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : '周期任务保存失败'); } finally { setBusy(false); }
  };
  const saveTaskContent = async () => {
    if (!supabase || !editingTask || !contentDraft) return;
    const issue = validateTaskContent(contentDraft); if (issue) return setMessage(issue);
    if (!editingDue || new Date(editingDue) <= new Date()) return setMessage('验收截止时间必须晚于当前时间。');
    const relatedContent = editingRelatedContentType === 'none' ? null : editingRelatedContentOptions.find((item) => item.id === editingRelatedContentId) ?? null;
    if (editingRelatedContentType !== 'none' && !relatedContent) return setMessage('请选择与当前任务门店和接收角色匹配的已发布关联资料。');
    if (editingInventoryLinkEnabled && !editingInventoryCategoryCodes.length) return setMessage('关联点货时请至少选择一个货品分类。');
    const editProfileIds = editingCompletionMode === 'single'
      ? [editingProfileId]
      : editingCompletionMode === 'selected'
        ? editingProfileIds
      : editingCompletionMode === 'individual'
        ? recipients.filter((recipient) => recipient.store_id === editingTask.store_id && editingTargetAudiences.includes(recipientAudience(recipient))).map((recipient) => recipient.id)
        : [];
    if (editingCompletionMode === 'single' && !editingProfileId) return setMessage('请选择一位任务接收人。');
    if (editingCompletionMode === 'selected' && editingProfileIds.length < 2) return setMessage('请至少选择两位需要分别完成任务的人员。');
    if (!['single', 'selected'].includes(editingCompletionMode) && !editingTargetAudiences.length) return setMessage('请至少勾选一个接收范围。');
    if (editingCompletionMode === 'individual' && !editProfileIds.length) return setMessage('当前门店和接收范围内没有可接收任务的人员。');
    const singleRecipient = recipients.find((recipient) => recipient.id === editingProfileId);
    const editSelectedAudiences = [...new Set(recipients.filter((recipient) => editingProfileIds.includes(recipient.id)).map(recipientAudience))];
    setBusy(true);
    try {
      await updateV2TaskContent(supabase, editingTask.id, contentDraft.name, taskContentToSnapshot(contentDraft), new Date(editingDue).toISOString(), fields.managerReviewEnabled, relatedContent, { categoryCodes: editingInventoryCategoryCodes, enabled: editingInventoryLinkEnabled });
      if (canEditTaskRecipients) await updateV2TaskRecipients(supabase, editingTask.id, editingCompletionMode, editProfileIds, editingCompletionMode === 'single' && singleRecipient
          ? [recipientAudience(singleRecipient)]
          : editingCompletionMode === 'selected'
            ? editSelectedAudiences
            : editingTargetAudiences);
      await cleanupSavedAssets(contentDraft);
      setEditingTask(null); setContentDraft(null); setEditingRelatedContentType('none'); setEditingRelatedContentId(''); setMessage('任务内容和关联资料已更新，员工页面会立即同步。'); window.dispatchEvent(new Event('storehub:todos-changed')); await load();
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
        <label className="text-sm font-semibold">完成方式<select className="ui-input mt-1" onChange={(event) => setRecipientMode(event.target.value as V2TaskCompletionMode)} value={recipientMode}><option value="shared">所选范围共同完成一次</option><option value="individual">所选范围每人分别完成一次</option><option value="single">单独指定一人完成</option><option value="selected">指定多人分别完成一次</option></select></label>
        {recipientMode === 'single' ? <label className="text-sm font-semibold">接收人<select className="ui-input mt-1" onChange={(event) => { const id = event.target.value; setSelectedProfileId(id); const recipient = recipients.find((item) => item.id === id); if (recipient?.store_id) setStoreIds([recipient.store_id]); }} value={selectedProfileId}><option value="">请选择人员</option>{recipients.map((item) => <option key={item.id} value={item.id}>{item.display_name} · {item.employment_type === 'part_time' ? '兼职' : item.role === 'manager' ? '店长' : '员工'}</option>)}</select></label> : null}
      </div>
      {recipientMode === 'selected' ? <PersonChecklist onChange={(ids) => { setSelectedProfileIds(ids); setStoreIds([...new Set(recipients.filter((recipient) => ids.includes(recipient.id)).map((recipient) => recipient.store_id).filter((id): id is string => Boolean(id)))]); }} recipients={recipients} selectedIds={selectedProfileIds} title="指定人员（可多选）" /> : null}
      {!['single', 'selected'].includes(recipientMode) ? <fieldset className="mt-3"><legend className="text-sm font-semibold">接收范围（可多选）</legend><div className="mt-2 grid grid-cols-3 gap-2">{([['staff','员工'],['manager','店长'],['part_time','兼职']] as const).map(([value,label]) => <label className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold" key={value}><input checked={targetAudiences.includes(value)} onChange={(event) => setTargetAudiences((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} type="checkbox" />{label}</label>)}</div><p className="mt-2 text-xs text-slate-500">{recipientMode === 'individual' ? `当前将为 ${matchingRecipientIds.length} 人分别创建独立任务。` : '范围内任意一人完成后，该门店任务即完成。'}兼职默认不勾选。</p></fieldset> : null}
      <fieldset className="mt-3"><legend className="text-sm font-semibold">适用门店</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{auth.availableStores.map((store) => { const outsideTemplateScope = Boolean(selectedTemplate && !selectedTemplate.storeIds.includes(store.id)); return <label className={`flex min-h-11 items-center rounded-lg border px-3 text-sm ${outsideTemplateScope ? 'border-slate-100 bg-slate-50 text-slate-400' : ''}`} key={store.id}><input checked={storeIds.includes(store.id)} className="mr-2" disabled={recipientMode === 'single' || recipientMode === 'selected' || outsideTemplateScope} onChange={() => setStoreIds((current) => current.includes(store.id) ? current.filter((id) => id !== store.id) : [...current, store.id])} type="checkbox" />{store.name}</label>; })}</div>{recipientMode === 'single' && selectedRecipient ? <p className="mt-2 text-xs text-slate-500">已按 {selectedRecipient.display_name} 的所属门店锁定。</p> : recipientMode === 'selected' ? <p className="mt-2 text-xs text-slate-500">已按所选人员的所属门店自动确定。</p> : selectedTemplate ? <p className="mt-2 text-xs leading-5 text-slate-500">只能勾选该模板已配置的适用门店；灰色门店请先到“任务模板”中增加后再发布。</p> : null}</fieldset>
      <label className="mt-3 flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm"><input checked={fields.managerReviewEnabled} className="mt-1" onChange={(event) => setFields((current) => ({ ...current, managerReviewEnabled: event.target.checked }))} type="checkbox" /><span><b className="block text-brand-900">允许店长审核员工提交</b><span className="mt-1 block text-xs leading-5 text-brand-800">管理员始终可以审核；店长只能审核本门店员工提交的任务，店长本人提交的任务必须由管理员审核。</span></span></label>
      <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer list-none px-3 py-3 text-sm font-bold text-slate-800">高级选项 · 关联资料或点货</summary>
        <div className="border-t border-slate-200 p-3">
          <RelatedContentSettings
            contentId={relatedContentId}
            contentType={relatedContentType}
            onContentIdChange={setRelatedContentId}
            onContentTypeChange={(type) => { setRelatedContentType(type); setRelatedContentId(''); }}
            options={compatibleRelatedContentOptions}
          />
          {relatedContentType !== 'none' && compatibleRelatedContentOptions.length === 0 ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">暂无同时匹配所选门店和接收角色的已发布资料，请先检查 SOP/公告的发布范围。</p> : <p className="mt-2 text-xs leading-5 text-slate-500">员工执行任务时会看到资料入口，可直接打开对应 SOP 或公告。</p>}
          <InventoryLinkSettings categoryCodes={inventoryCategoryCodes} enabled={inventoryLinkEnabled} onCategoryCodesChange={setInventoryCategoryCodes} onEnabledChange={setInventoryLinkEnabled} />
        </div>
      </details>
      {creationMode === 'single' ? <section className="mt-3 rounded-lg bg-slate-50 p-3"><p className="font-semibold">发布时间</p><div className="mt-2 grid grid-cols-2 gap-2"><label className="rounded-lg border bg-white p-2 text-sm"><input checked={singlePublishMode === 'immediate'} onChange={() => setSinglePublishMode('immediate')} type="radio" /> 立即发布</label><label className="rounded-lg border bg-white p-2 text-sm"><input checked={singlePublishMode === 'scheduled'} onChange={() => setSinglePublishMode('scheduled')} type="radio" /> 定时发布</label></div>{singlePublishMode === 'scheduled' ? <label className="mt-2 block text-sm font-semibold">定时发布时间<input className="ui-input mt-1" min={toDatetimeLocalValue(new Date().toISOString())} onChange={(event) => setSinglePublishAt(event.target.value)} type="datetime-local" value={singlePublishAt} /></label> : null}<label className="mt-3 block text-sm font-semibold">验收截止时间<input className="ui-input mt-1" onChange={(event) => setDue(event.target.value)} type="datetime-local" value={due} /></label></section> : <><ScheduleRuleEditor fields={fields} onChange={setFields} /><label className="mt-3 flex items-center rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900"><input checked={publishImmediately} className="mr-2" onChange={(event) => setPublishImmediately(event.target.checked)} type="checkbox" />创建周期任务时立即发布一次</label><p className="mt-1 text-xs leading-5 text-slate-500">勾选后会立即生成一条任务，后续仍从“首次定时发布时间”开始按周期发布。</p></>}
      <button className="ui-button-primary mt-4 w-full" disabled={busy} onClick={() => void publish()} type="button"><Rocket className="h-4 w-4" />{busy ? '正在发布' : '确认发布'}</button>
    </section> : null}

    {!publisherOnly ? <>
      <SegmentedControl className="grid-cols-2" items={[
        { active: taskView === 'active', label: `进行中任务 ${activeTasks.length}`, onClick: () => setTaskView('active') },
        { active: taskView === 'completed', label: `已完成任务 ${completedTasks.length}`, onClick: () => setTaskView('completed') },
      ]} />

      {taskView === 'active' ? <section className="space-y-3"><h2 className="font-bold">周期任务</h2>{schedules.length ? schedules.map((row) => <article className="ui-card p-4" key={row.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b>{row.content_name ?? templates.find((item) => item.id === row.template_id)?.name ?? '已归档模板的周期任务'}</b><p className="mt-1 text-sm text-slate-600">{auth.availableStores.find((store) => store.id === row.store_id)?.name}{row.assigned_profile_id ? ` · ${recipients.find((item) => item.id === row.assigned_profile_id)?.display_name ?? '指定人员'}` : ' · 门店全体'}</p><p className="mt-1 text-xs leading-5 text-slate-500">{scheduleText(row)}<br />下次发布：{new Date(row.next_due_at).toLocaleString('zh-CN')}</p></div><div className="flex shrink-0 flex-wrap justify-end gap-1.5"><span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-bold text-violet-800">定时发布</span><span className={`rounded-full px-2 py-1 text-xs font-bold ${row.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{row.is_active ? '运行中' : '已暂停'}</span></div></div><div className="mt-3 grid grid-cols-3 gap-2"><button className="ui-button-secondary px-2" disabled={busy} onClick={() => void startScheduleEdit(row)} type="button"><Pencil className="h-4 w-4" />编辑</button><button className="ui-button-secondary border-red-200 px-2 text-red-700" disabled={busy} onClick={() => void withdraw(row)} type="button"><Undo2 className="h-4 w-4" />撤回周期</button>{row.is_active ? <button className="ui-button-secondary px-2" disabled={busy} onClick={() => void pause(row)} type="button"><PauseCircle className="h-4 w-4" />暂停</button> : <button className="ui-button-primary px-2" disabled={busy} onClick={() => void resume(row)} type="button">继续</button>}</div></article>) : <p className="ui-card p-4 text-sm text-slate-500">暂无周期任务计划。</p>}</section> : null}

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
        {(taskView === 'active' ? activeTasks : filteredCompletedTasks).map((task) => {
          const waitingForPublication = isWaitingForScheduledPublication(task);
          const overdue = !waitingForPublication && isV2TaskOverdue(task, deadlineNow);
          const submitterName = task.submitted_by ? recipients.find((recipient) => recipient.id === task.submitted_by)?.display_name ?? '已提交账号' : '';
          const timeline = taskTimeline.filter((event) => event.task_id === task.id);
          return <article className="ui-card p-4" key={task.id}><Link className="ui-interactive block" to={`/app/admin/tasks/${task.id}`}><div className="flex items-start justify-between gap-3"><b>{task.name}</b><div className="flex max-w-[62%] flex-wrap justify-end gap-1.5">{waitingForPublication ? <><span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900">待发布</span><span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-800">定时发布</span></> : <><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">已发布</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${v2TaskStatusClass[task.status]}`}>{task.status === 'resubmitted' ? '已重新提交 · 待审核' : v2TaskStatusLabel[task.status]}</span>{overdue && task.status !== 'overdue' ? <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${v2TaskStatusClass.overdue}`}>{v2TaskStatusLabel.overdue}</span> : null}</>}</div></div><p className="mt-2 text-sm text-slate-500">{task.task_no} · {auth.availableStores.find((store) => store.id === task.store_id)?.name}{task.assigned_profile_id ? ` · ${recipients.find((item) => item.id === task.assigned_profile_id)?.display_name ?? '指定人员'}` : ' · 门店全体'} · {task.status === 'approved' ? `完成 ${new Date(completedAt(task)).toLocaleString('zh-CN')}` : waitingForPublication ? `定时发布 ${new Date(task.publish_at).toLocaleString('zh-CN')} · 截止 ${new Date(task.due_at).toLocaleString('zh-CN')}` : `截止 ${new Date(task.due_at).toLocaleString('zh-CN')}`}{task.schedule_id ? ' · 周期任务' : ''}</p>{submitterName && ['submitted', 'resubmitted'].includes(task.status) ? <p className="mt-1 text-xs text-slate-500">提交人：{submitterName}</p> : null}<TaskSubmissionTimeline events={timeline} fallbackSubmittedAt={task.submitted_at} /></Link>{!task.schedule_id && ['pending', 'in_progress', 'rejected', 'overdue'].includes(task.status) ? <button className="ui-button-secondary mt-3 w-full" disabled={busy} onClick={() => void startTaskEdit(task)} type="button"><Pencil className="h-4 w-4" />编辑完整任务</button> : null}</article>;
        })}
        {(taskView === 'active' ? activeTasks : filteredCompletedTasks).length === 0 ? <p className="ui-card p-4 text-sm text-slate-500">{taskView === 'active' ? '当前没有进行中的任务。' : '当前筛选条件下没有已完成任务。'}</p> : null}
      </section>
    </> : null}

    {editingSchedule ? <div className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3"><div className="mx-auto max-w-xl pb-[calc(7.5rem+env(safe-area-inset-bottom))]"><div className="ui-card p-4"><h2 className="text-lg font-bold">编辑周期任务</h2><ScheduleRuleEditor fields={fields} onChange={setFields} /><fieldset className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><legend className="px-1 text-sm font-bold">完成方式</legend><select aria-label="周期任务完成方式" className="ui-input" onChange={(event) => setEditingCompletionMode(event.target.value as V2TaskCompletionMode)} value={editingCompletionMode}><option value="shared">所选范围共同完成一次</option><option value="individual">所选范围每人分别完成一次</option><option value="single">单独指定一人完成</option><option value="selected">指定多人分别完成一次</option></select>{editingCompletionMode === 'single' ? <select aria-label="周期任务接收人" className="ui-input mt-2" onChange={(event) => setEditingProfileId(event.target.value)} value={editingProfileId}><option value="">请选择人员</option>{recipients.filter((recipient) => recipient.store_id === editingSchedule.store_id).map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.display_name} · {recipientAudience(recipient) === 'part_time' ? '兼职' : recipient.role === 'manager' ? '店长' : '员工'}</option>)}</select> : editingCompletionMode === 'selected' ? <PersonChecklist onChange={setEditingProfileIds} recipients={recipients.filter((recipient) => recipient.store_id === editingSchedule.store_id)} selectedIds={editingProfileIds} title="指定人员（可多选）" /> : <div className="mt-2 grid grid-cols-3 gap-2">{([['staff','员工'],['manager','店长'],['part_time','兼职']] as const).map(([value,label]) => <label className="flex items-center justify-center gap-1 rounded-lg border bg-white px-2 py-2 text-xs font-semibold" key={value}><input checked={editingTargetAudiences.includes(value)} onChange={(event) => setEditingTargetAudiences((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} type="checkbox" />{label}</label>)}</div>}<p className="mt-2 text-xs leading-5 text-slate-500">保存后用于以后每次自动发布；尚未开始的当前任务会同步调整，已开始或已提交的任务保持原接收人。</p></fieldset><label className="mt-3 flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm"><input checked={fields.managerReviewEnabled} className="mt-1" onChange={(event) => setFields((current) => ({ ...current, managerReviewEnabled: event.target.checked }))} type="checkbox" /><span><b className="block text-brand-900">允许店长审核员工提交</b><span className="mt-1 block text-xs leading-5 text-brand-800">保存后会同步到当前未完成任务和以后自动发布的任务；店长本人提交仍由管理员审核。</span></span></label><div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="mb-2 text-sm font-bold">高级选项</p><RelatedContentSettings contentId={editingRelatedContentId} contentType={editingRelatedContentType} onContentIdChange={setEditingRelatedContentId} onContentTypeChange={(type) => { setEditingRelatedContentType(type); setEditingRelatedContentId(''); }} options={editingRelatedContentOptions} /><InventoryLinkSettings categoryCodes={editingInventoryCategoryCodes} enabled={editingInventoryLinkEnabled} onCategoryCodesChange={setEditingInventoryCategoryCodes} onEnabledChange={setEditingInventoryLinkEnabled} /></div><button className="ui-button-secondary mt-3 w-full" onClick={() => setScheduleContentEditorOpen(true)} type="button"><Pencil className="h-4 w-4" />编辑完整任务内容</button><p className="mt-2 text-xs leading-5 text-slate-500">保存后会同步当前未完成任务，并用于以后自动发布的任务。</p><div className="mt-4 grid grid-cols-2 gap-2"><button className="ui-button-secondary" onClick={() => { cleanupCancelledAssets(); setEditingSchedule(null); setContentDraft(null); setEditingRelatedContentType('none'); setEditingRelatedContentId(''); }} type="button">取消</button><button className="ui-button-primary" disabled={busy} onClick={() => void saveSchedule()} type="button">保存全部修改</button></div></div></div></div> : null}
    {editingTask && contentDraft ? <TaskContentEditor advancedOptions={<div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div>
        <p className="mb-2 text-sm font-bold">完成方式</p>
        <select className="ui-input" disabled={!canEditTaskRecipients} onChange={(event) => setEditingCompletionMode(event.target.value as V2TaskCompletionMode)} value={editingCompletionMode}>
          <option value="shared">本门店所选范围共同完成一次</option>
          <option value="individual">本门店所选范围每人分别完成一次</option>
          <option value="single">单独指定一人完成</option>
          <option value="selected">指定多人分别完成一次</option>
        </select>
        {editingCompletionMode === 'single' ? <select className="ui-input mt-2" disabled={!canEditTaskRecipients} onChange={(event) => setEditingProfileId(event.target.value)} value={editingProfileId}><option value="">请选择人员</option>{recipients.filter((recipient) => recipient.store_id === editingTask.store_id).map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.display_name} · {recipientAudience(recipient) === 'part_time' ? '兼职' : recipient.role === 'manager' ? '店长' : '员工'}</option>)}</select> : editingCompletionMode === 'selected' ? <PersonChecklist disabled={!canEditTaskRecipients} onChange={setEditingProfileIds} recipients={recipients.filter((recipient) => recipient.store_id === editingTask.store_id)} selectedIds={editingProfileIds} title="指定人员（可多选）" /> : <div className="mt-2 grid grid-cols-3 gap-2">{([['staff','员工'],['manager','店长'],['part_time','兼职']] as const).map(([value,label]) => <label className="flex items-center justify-center gap-1 rounded-lg border bg-white px-2 py-2 text-xs font-semibold" key={value}><input checked={editingTargetAudiences.includes(value)} disabled={!canEditTaskRecipients} onChange={(event) => setEditingTargetAudiences((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} type="checkbox" />{label}</label>)}</div>}
        {!canEditTaskRecipients ? <p className="mt-2 text-xs text-amber-700">任务已有执行进度，完成方式已锁定；未开始的已发布任务可以直接修改。</p> : null}
      </div>
      <div><p className="mb-2 text-sm font-bold">高级选项</p><RelatedContentSettings contentId={editingRelatedContentId} contentType={editingRelatedContentType} onContentIdChange={setEditingRelatedContentId} onContentTypeChange={(type) => { setEditingRelatedContentType(type); setEditingRelatedContentId(''); }} options={editingRelatedContentOptions} /><InventoryLinkSettings categoryCodes={editingInventoryCategoryCodes} enabled={editingInventoryLinkEnabled} onCategoryCodesChange={setEditingInventoryCategoryCodes} onEnabledChange={setEditingInventoryLinkEnabled} /></div>
    </div>} busy={busy} categories={categories} draft={contentDraft} dueAt={editingDue} managerReviewEnabled={fields.managerReviewEnabled} onCancel={() => { cleanupCancelledAssets(); setEditingTask(null); setContentDraft(null); setEditingRelatedContentType('none'); setEditingRelatedContentId(''); }} onChange={setContentDraft} onDueAtChange={setEditingDue} onManagerReviewEnabledChange={(enabled) => setFields((current) => ({ ...current, managerReviewEnabled: enabled }))} onRemoveReferenceImage={removeReferenceImage} onSave={() => void saveTaskContent()} onUploadReferenceImage={uploadReferenceImage} /> : null}
    {editingSchedule && scheduleContentEditorOpen && contentDraft ? <TaskContentEditor busy={busy} categories={categories} draft={contentDraft} onCancel={() => setScheduleContentEditorOpen(false)} onChange={setContentDraft} onRemoveReferenceImage={removeReferenceImage} onSave={() => { const issue = validateTaskContent(contentDraft); if (issue) setMessage(issue); else setScheduleContentEditorOpen(false); }} onUploadReferenceImage={uploadReferenceImage} title="编辑周期任务完整内容" /> : null}
    <ActionFeedbackDialog message={message ?? ''} onClose={() => setMessage(null)} open={Boolean(message)} title="操作提示" tone={message?.includes('失败') || message?.includes('必须') || message?.includes('请选择') || message?.includes('不适用') || message?.includes('无权') || message?.includes('denied') ? 'warning' : 'success'} />
  </PageShell>;
}

export function AdminV2TaskPublishPage() {
  return <AdminV2TasksPage publisherOnly />;
}

function TaskSubmissionTimeline({ events, fallbackSubmittedAt }: { events: V2TaskTimelineEvent[]; fallbackSubmittedAt: string | null }) {
  if (!events.length && !fallbackSubmittedAt) return null;
  let submissionCount = 0;
  let rejectionCount = 0;
  let resubmissionCount = 0;
  const rows = events.length ? events.map((event) => {
    if (event.action === 'submitted') {
      submissionCount += 1;
      return { ...event, label: submissionCount === 1 ? '首次提交' : `第 ${submissionCount} 次提交` };
    }
    if (event.action === 'rejected') {
      rejectionCount += 1;
      return { ...event, label: rejectionCount === 1 ? '驳回' : `第 ${rejectionCount} 次驳回` };
    }
    resubmissionCount += 1;
    return { ...event, label: `第 ${resubmissionCount} 次重新提交` };
  }) : [{ action: 'submitted' as const, created_at: fallbackSubmittedAt!, id: 'fallback-submission', label: '提交', task_id: '' }];
  return <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600"><p className="mb-0.5 font-bold text-slate-700">提交与整改时间</p>{rows.map((event) => <p className="flex justify-between gap-3" key={event.id}><span>{event.label}</span><time className="shrink-0 tabular-nums" dateTime={event.created_at}>{new Date(event.created_at).toLocaleString('zh-CN')}</time></p>)}</div>;
}

function PersonChecklist({ disabled = false, onChange, recipients, selectedIds, title }: {
  disabled?: boolean;
  onChange: (ids: string[]) => void;
  recipients: V2TaskRecipient[];
  selectedIds: string[];
  title: string;
}) {
  return <fieldset className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
    <legend className="px-1 text-sm font-semibold">{title}</legend>
    <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
      {recipients.map((recipient) => {
        const checked = selectedIds.includes(recipient.id);
        const role = recipientAudience(recipient) === 'part_time' ? '兼职' : recipient.role === 'manager' ? '店长' : '员工';
        return <label className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${checked ? 'border-brand-400 bg-brand-50 text-brand-900' : 'border-slate-200 bg-white text-slate-700'}`} key={recipient.id}>
          <input aria-label={`选择${recipient.display_name}`} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [...selectedIds, recipient.id] : selectedIds.filter((id) => id !== recipient.id))} type="checkbox" />
          <span className="min-w-0"><b className="block truncate">{recipient.display_name}</b><span className="text-xs text-slate-500">{role}</span></span>
        </label>;
      })}
    </div>
    <p className="mt-2 text-xs text-slate-500">已选择 {selectedIds.length} 人；系统会为每个人分别创建独立任务。</p>
  </fieldset>;
}

function RelatedContentSettings({
  contentId,
  contentType,
  onContentIdChange,
  onContentTypeChange,
  options,
}: {
  contentId: string;
  contentType: 'none' | V2TaskRelatedContentType;
  onContentIdChange: (value: string) => void;
  onContentTypeChange: (value: 'none' | V2TaskRelatedContentType) => void;
  options: V2TaskRelatedContentOption[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((item) => item.id === contentId) ?? null;
  const keyword = search.trim().toLocaleLowerCase('zh-CN');
  const filteredOptions = options.filter((item) => !keyword
    || `${item.title} ${item.subtitle}`.toLocaleLowerCase('zh-CN').includes(keyword));
  const typeLabel = contentType === 'sop' ? 'SOP' : '公告';
  const close = () => { setOpen(false); setSearch(''); };

  return <>
    <label className="block text-sm font-semibold">关联资料类型
      <select className="ui-input mt-1" onChange={(event) => onContentTypeChange(event.target.value as 'none' | V2TaskRelatedContentType)} value={contentType}>
        <option value="none">不关联资料</option>
        <option value="sop">关联一个 SOP</option>
        <option value="notice">关联一条公告</option>
      </select>
    </label>
    {contentType !== 'none' ? <div className="mt-3">
      <p className="text-sm font-semibold">选择已发布{typeLabel}</p>
      <button className="ui-input mt-1 flex w-full items-center justify-between gap-3 text-left" disabled={options.length === 0} onClick={() => setOpen(true)} type="button">
        <span className={selected ? 'min-w-0 truncate text-slate-900' : 'text-slate-500'}>{selected?.title ?? `请选择关联${typeLabel}`}</span>
        <Search className="h-4 w-4 shrink-0 text-brand-700" />
      </button>
      {selected ? <div className="mt-2 flex items-start justify-between gap-2 rounded-lg border border-brand-100 bg-white px-3 py-2">
        <div className="min-w-0"><b className="block truncate text-sm">{selected.title}</b><span className="text-xs text-slate-500">{selected.subtitle} · 发布于 {new Date(selected.publishedAt).toLocaleString('zh-CN')}</span></div>
        <button className="shrink-0 text-xs font-bold text-red-600" onClick={() => onContentIdChange('')} type="button">取消关联</button>
      </div> : null}
    </div> : null}

    {open ? <div aria-label={`选择关联${typeLabel}`} aria-modal="true" className="fixed inset-0 z-[100] h-[100dvh] overflow-y-auto bg-black/45 p-3" role="dialog">
      <div className="mx-auto mt-[max(1rem,env(safe-area-inset-top))] max-w-xl rounded-2xl bg-white p-4 shadow-xl">
        <header className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-brand-700">按发布时间从新到旧排列</p><h2 className="text-lg font-bold">选择关联{typeLabel}</h2></div><button aria-label="关闭关联资料选择" className="ui-icon-button" onClick={close} type="button"><X className="h-5 w-5" /></button></header>
        <label className="relative mt-3 block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input autoFocus className="ui-input pl-10" onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${typeLabel}名称或分类`} type="search" value={search} /></label>
        <div className="mt-3 max-h-[65dvh] space-y-2 overflow-y-auto overscroll-contain">
          {filteredOptions.map((item) => <button className={`w-full rounded-xl border p-3 text-left ${item.id === contentId ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white'}`} key={`${item.type}-${item.id}`} onClick={() => { onContentIdChange(item.id); close(); }} type="button">
            <b className="block text-sm">{item.title}</b>
            <span className="mt-1 block text-xs text-slate-500">{item.subtitle} · 发布于 {new Date(item.publishedAt).toLocaleString('zh-CN')}</span>
          </button>)}
          {filteredOptions.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">没有找到匹配的已发布{typeLabel}。</p> : null}
        </div>
      </div>
    </div> : null}
  </>;
}

function InventoryLinkSettings({
  categoryCodes,
  enabled,
  onCategoryCodesChange,
  onEnabledChange,
}: {
  categoryCodes: ProductCategoryCode[];
  enabled: boolean;
  onCategoryCodesChange: (value: ProductCategoryCode[]) => void;
  onEnabledChange: (value: boolean) => void;
}) {
  const toggleCategory = (code: ProductCategoryCode) => {
    onCategoryCodesChange(categoryCodes.includes(code)
      ? categoryCodes.filter((item) => item !== code)
      : [...categoryCodes, code]);
  };

  return <section className="mt-4 border-t border-slate-200 pt-4">
    <label className="flex items-start gap-2 rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm">
      <input
        checked={enabled}
        className="mt-1"
        onChange={(event) => onEnabledChange(event.target.checked)}
        type="checkbox"
      />
      <span>
        <b className="block text-brand-900">关联点货</b>
        <span className="mt-1 block text-xs leading-5 text-brand-800">员工必须提交所选货品分类的点货单，本任务才能提交检查。</span>
      </span>
    </label>
    {enabled ? <fieldset className="mt-3">
      <legend className="text-sm font-semibold">本次点货范围（按货品分类）</legend>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PRODUCT_CATEGORIES.map((category) => <label
          className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm ${categoryCodes.includes(category.code) ? 'border-brand-500 bg-white text-brand-900' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
          key={category.code}
        >
          <input checked={categoryCodes.includes(category.code)} onChange={() => toggleCategory(category.code)} type="checkbox" />
          {category.label}
        </label>)}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">例如周盘可不选“非消耗性物品”，月盘可勾选全部分类。</p>
    </fieldset> : null}
  </section>;
}

function ScheduleRuleEditor({ fields, onChange }: { fields: V2TaskScheduleFields; onChange: (value: V2TaskScheduleFields) => void }) {
  const numeric = (value: string) => value === '' ? null : Number(value);
  return <section className="mt-3 rounded-lg bg-slate-50 p-3"><p className="font-semibold">发布周期</p><div className="mt-2 grid gap-2 sm:grid-cols-3"><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.scheduleType === 'interval_days'} onChange={() => onChange({ ...fields, scheduleType: 'interval_days' })} type="radio" /> 每 <input className="mx-1 h-9 w-16 rounded border px-2" min="1" onChange={(event) => onChange({ ...fields, intervalDays: numeric(event.target.value) })} type="number" value={fields.intervalDays ?? ''} /> 天发布</label><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.scheduleType === 'weekly'} onChange={() => onChange({ ...fields, scheduleType: 'weekly' })} type="radio" /> 每周发布</label><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.scheduleType === 'monthly'} onChange={() => onChange({ ...fields, scheduleType: 'monthly' })} type="radio" /> 每月 <input className="mx-1 h-9 w-14 rounded border px-2" max="31" min="1" onChange={(event) => onChange({ ...fields, monthDay: numeric(event.target.value) })} type="number" value={fields.monthDay ?? ''} /> 日</label></div>{fields.scheduleType === 'weekly' ? <div className="mt-2 flex flex-wrap gap-2">{weeklyDeadlineOptions.map((item) => <button className={`rounded-lg border px-3 py-2 text-sm ${fields.weekdays.includes(item.value) ? 'border-brand-700 bg-brand-50 text-brand-800' : 'bg-white'}`} key={item.value} onClick={() => onChange({ ...fields, weekdays: fields.weekdays.includes(item.value) ? fields.weekdays.filter((value) => value !== item.value) : [...fields.weekdays, item.value].sort() })} type="button">{item.label}</button>)}</div> : null}<label className="mt-2 block text-sm font-semibold">周期发布时间<input className="ui-input mt-1" onChange={(event) => onChange({ ...fields, publishTime: event.target.value })} type="time" value={fields.publishTime} /></label><label className="mt-2 block text-sm font-semibold">首次 / 下次发布时间<input className="ui-input mt-1" min={toDatetimeLocalValue(new Date().toISOString())} onChange={(event) => onChange({ ...fields, nextPublishAt: new Date(event.target.value).toISOString() })} type="datetime-local" value={toDatetimeLocalValue(fields.nextPublishAt)} /></label>
    <p className="mt-4 font-semibold">验收周期</p><div className="mt-2 grid gap-2 sm:grid-cols-3"><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.acceptanceType === 'daily'} onChange={() => onChange({ ...fields, acceptanceType: 'daily' })} type="radio" /> 发布后 <input className="mx-1 h-9 w-14 rounded border px-2" max="31" min="0" onChange={(event) => onChange({ ...fields, acceptanceIntervalDays: numeric(event.target.value) })} type="number" value={fields.acceptanceIntervalDays ?? ''} /> 天</label><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.acceptanceType === 'weekly'} onChange={() => onChange({ ...fields, acceptanceType: 'weekly' })} type="radio" /> 每周验收</label><label className="rounded-lg border bg-white p-2 text-sm"><input checked={fields.acceptanceType === 'monthly'} onChange={() => onChange({ ...fields, acceptanceType: 'monthly' })} type="radio" /> 每月 <input className="mx-1 h-9 w-14 rounded border px-2" max="31" min="1" onChange={(event) => onChange({ ...fields, acceptanceMonthDay: numeric(event.target.value) })} type="number" value={fields.acceptanceMonthDay ?? ''} /> 日</label></div>{fields.acceptanceType === 'daily' ? <p className="mt-2 text-xs text-slate-500">填写 0 表示发布当日验收；当日验收时间必须晚于发布时间。</p> : null}{fields.acceptanceType === 'weekly' ? <label className="mt-2 block text-sm font-semibold">每周验收日<select className="ui-input mt-1" onChange={(event) => onChange({ ...fields, acceptanceWeekday: Number(event.target.value) })} value={fields.acceptanceWeekday ?? ''}><option value="">请选择</option>{weeklyDeadlineOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : null}<label className="mt-2 block text-sm font-semibold">验收时间<input className="ui-input mt-1" onChange={(event) => onChange({ ...fields, acceptanceTime: event.target.value })} type="time" value={fields.acceptanceTime} /></label><p className="mt-2 text-xs leading-5 text-slate-500">周期任务会在首次设定的发布时间生成；验收时间必须晚于本次发布、早于下一次发布。</p>
  </section>;
}
