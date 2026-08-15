import { useCallback, useEffect, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadManagerStoreStaff, managerCreatePayrollPenalty, uploadPayrollEvidence } from '../services/payroll.service';

type PenaltyLevel = 'reminder' | 'warning' | 'formal_warning' | 'serious';
type TaskCategory = 'weekly_clean' | 'monthly_clean' | 'inspection' | 'temporary';

const penaltyLevels: Array<{ label: string; value: PenaltyLevel; defaultDeduction: number }> = [
  { label: '提醒', value: 'reminder', defaultDeduction: 0 },
  { label: '警告', value: 'warning', defaultDeduction: 3 },
  { label: '正式警告', value: 'formal_warning', defaultDeduction: 5 },
  { label: '严重违规', value: 'serious', defaultDeduction: 10 },
];

const taskCategories: Array<{ label: string; value: TaskCategory }> = [
  { label: '周清', value: 'weekly_clean' },
  { label: '月清', value: 'monthly_clean' },
  { label: '巡检', value: 'inspection' },
  { label: '临时', value: 'temporary' },
];

export function ManagerEmployeeManagementPage() {
  const auth = useAuth();
  const [employees, setEmployees] = useState<Array<{ id: string; display_name: string; store_id: string; is_active: boolean }>>([]);
  const [profileId, setProfileId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [level, setLevel] = useState<PenaltyLevel>('warning');
  const [deduction, setDeduction] = useState('3');
  const [amount, setAmount] = useState('0');
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const [templateName, setTemplateName] = useState('');
  const [templateCategory, setTemplateCategory] = useState<TaskCategory>('temporary');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateRequiresReview, setTemplateRequiresReview] = useState(true);
  const [templateAllowOverdue, setTemplateAllowOverdue] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [publishTemplateId, setPublishTemplateId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [ownTasks, setOwnTasks] = useState<Array<{ id: string; task_no: string; name: string; status: string; due_at: string }>>([]);
  const [taskMessage, setTaskMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'penalty' | 'task'>('penalty');

  const rpc = supabase?.rpc as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;

  const loadStaff = useCallback(async () => {
    if (!supabase || !auth.profile) return;
    try {
      setEmployees(await loadManagerStoreStaff(supabase, auth.availableStores.map((store) => store.id)));
    } catch {
      setMessage('无法加载本店员工。');
    }
  }, [auth.profile, auth.availableStores]);

  const loadTasks = useCallback(async () => {
    if (!supabase || !auth.profile) return;
    try {
      const [templatesResult, tasksResult] = await Promise.all([
        supabase.from('v2_task_templates').select('id,name,status').eq('created_by', auth.profile.id).eq('publisher_role' as never, 'manager').order('updated_at', { ascending: false }),
        supabase.from('v2_tasks').select('id,task_no,name,status,due_at').eq('created_by', auth.profile.id).eq('publisher_role' as never, 'manager').order('created_at', { ascending: false }).limit(30),
      ]);
      setTemplates(templatesResult.data ?? []);
      setOwnTasks(tasksResult.data ?? []);
    } catch {
      setTaskMessage('无法加载任务。');
    }
  }, [auth.profile]);

  useEffect(() => { void loadStaff(); void loadTasks(); }, [loadStaff, loadTasks]);

  const changeLevel = (next: PenaltyLevel) => {
    setLevel(next);
    setDeduction(String(penaltyLevels.find((item) => item.value === next)?.defaultDeduction ?? 0));
  };

  const submitPenalty = async () => {
    if (!supabase || !auth.profile || !profileId || !reason.trim()) {
      setMessage('请选择员工并填写处罚原因。');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const penalty = await managerCreatePayrollPenalty(supabase, {
        profileId,
        eventDate: date,
        reason: reason.trim(),
        amount: Number(amount) || 0,
        eventLevel: level,
        performanceDeduction: Number(deduction) || 0,
      });
      const failed: string[] = [];
      for (const file of files) {
        try {
          await uploadPayrollEvidence(supabase, { file, ownerId: auth.profile.id, entityId: penalty.id });
        } catch {
          failed.push(file.name);
        }
      }
      setReason('');
      setFiles([]);
      setMessage(failed.length ? '罚单已发布，但 ' + failed.length + ' 张说明图片上传失败。' : '罚单已发布，已通知员工和管理员。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发布失败。');
    } finally {
      setBusy(false);
    }
  };

  const createTemplate = async () => {
    if (!rpc || !templateName.trim()) {
      setTaskMessage('请填写任务名称。');
      return;
    }
    setTaskMessage('');
    try {
      const { error } = await rpc('manager_save_v2_task_template', {
        p_allow_overdue: templateAllowOverdue,
        p_category: templateCategory,
        p_description: templateDescription,
        p_name: templateName,
        p_requires_review: templateRequiresReview,
      });
      if (error) throw new Error(error.message);
      setTemplateName('');
      setTemplateDescription('');
      setTaskMessage('模板已创建。');
      await loadTasks();
    } catch (error) {
      setTaskMessage(error instanceof Error ? error.message : '模板创建失败。');
    }
  };

  const publishTemplate = async () => {
    if (!rpc || !publishTemplateId || !dueAt) {
      setTaskMessage('请选择模板并设置截止时间。');
      return;
    }
    setTaskMessage('');
    try {
      const published = await rpc('publish_v2_task_template', { p_template_id: publishTemplateId });
      if (published.error) throw new Error(published.error.message);
      const task = await rpc('manager_publish_v2_tasks', { p_due_at: new Date(dueAt).toISOString(), p_template_id: publishTemplateId });
      if (task.error) throw new Error(task.error.message);
      setTaskMessage('任务已发布，并已同步到管理员任务清单。');
      await loadTasks();
    } catch (error) {
      setTaskMessage(error instanceof Error ? error.message : '任务发布失败。');
    }
  };

  if (auth.profile?.role !== 'manager') {
    return <PageShell eyebrow="账号权限" title="员工管理" backTo="/app/workbench"><div className="rounded-lg bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">员工管理仅向店长开放。</p></div></PageShell>;
  }

  return <PageShell eyebrow="门店运营系统 · 店长" title="员工管理" backTo="/app/workbench" contentGapClassName="gap-3">
    <div className="grid grid-cols-2 gap-2">
      <button className={activeTab === 'penalty' ? 'min-h-10 rounded-lg bg-brand-600 px-3 text-sm font-bold text-white' : 'min-h-10 rounded-lg bg-slate-100 px-3 text-sm font-bold text-slate-600'} onClick={() => setActiveTab('penalty')} type="button">罚单开具</button>
      <button className={activeTab === 'task' ? 'min-h-10 rounded-lg bg-brand-600 px-3 text-sm font-bold text-white' : 'min-h-10 rounded-lg bg-slate-100 px-3 text-sm font-bold text-slate-600'} onClick={() => setActiveTab('task')} type="button">任务发布</button>
    </div>
    {activeTab === 'penalty' ? <SectionCard>
      <SectionHeader title="罚单开具" description="罚单会同步到员工薪资与管理员后台。" />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">员工
          <select className="ui-input mt-1" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
            <option value="">请选择员工</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.display_name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">事件日期<input className="ui-input mt-1" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="text-sm font-semibold text-slate-700">事件等级
          <select className="ui-input mt-1" value={level} onChange={(event) => changeLevel(event.target.value as PenaltyLevel)}>
            {penaltyLevels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">绩效扣分<input className="ui-input mt-1" inputMode="decimal" type="number" value={deduction} onChange={(event) => setDeduction(event.target.value)} /></label>
        <label className="text-sm font-semibold text-slate-700">罚款金额<input className="ui-input mt-1" inputMode="decimal" min="0" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      </div>
      <label className="mt-2 block text-sm font-semibold text-slate-700">处罚原因<textarea className="ui-input mt-1 min-h-20 py-2" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="请填写具体原因" /></label>
      <label className="mt-3 block">
        <span className="text-sm font-semibold text-slate-700">说明图片</span>
        <span className="mt-2 flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 text-sm font-bold text-slate-600 hover:border-brand-400 hover:bg-brand-50">
          <span>{files.length ? '已选择 ' + files.length + ' 张图片' : '点击上传说明图片'}</span>
          <input className="hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
        </span>
      </label>
      <button className="mt-3 min-h-11 rounded-lg bg-brand-600 px-4 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void submitPenalty()} type="button">{busy ? '正在发布' : '发布罚单'}</button>
      {message ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{message}</p> : null}
    </SectionCard> : null}

    {activeTab === 'task' ? <SectionCard>
      <SectionHeader title="任务发布" description="创建模板并发布给本店员工，任务会同步到管理员任务清单。" />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">任务名称<input className="ui-input mt-1" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="例如 周末收尾检查" /></label>
        <label className="text-sm font-semibold text-slate-700">分类
          <select className="ui-input mt-1" value={templateCategory} onChange={(event) => setTemplateCategory(event.target.value as TaskCategory)}>
            {taskCategories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <label className="mt-2 block text-sm font-semibold text-slate-700">任务说明<textarea className="ui-input mt-1 min-h-16 py-2" value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} placeholder="请填写任务说明" /></label>
      <div className="mt-2 flex gap-4 text-sm font-semibold text-slate-700">
        <label><input className="mr-1" type="checkbox" checked={templateRequiresReview} onChange={(event) => setTemplateRequiresReview(event.target.checked)} />需要审核</label>
        <label><input className="mr-1" type="checkbox" checked={templateAllowOverdue} onChange={(event) => setTemplateAllowOverdue(event.target.checked)} />允许逾期</label>
      </div>
      <button className="mt-3 min-h-10 rounded-lg border border-brand-600 bg-white px-4 font-bold text-brand-700" onClick={() => void createTemplate()} type="button">创建模板</button>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">选择已发布模板
          <select className="ui-input mt-1" value={publishTemplateId} onChange={(event) => setPublishTemplateId(event.target.value)}>
            <option value="">请选择模板</option>
            {templates.filter((item) => item.status === 'published').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">截止时间<input className="ui-input mt-1" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
      </div>
      <button className="mt-3 min-h-11 rounded-lg bg-brand-600 px-4 font-bold text-white" onClick={() => void publishTemplate()} type="button">发布任务</button>
      {taskMessage ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{taskMessage}</p> : null}

      <div className="mt-4 space-y-2">
        <p className="text-sm font-bold text-slate-900">我发布的任务</p>
        {ownTasks.length === 0 ? <p className="text-sm text-slate-500">暂无任务。</p> : ownTasks.map((task) => <div className="rounded-lg border border-slate-100 bg-slate-50 p-3" key={task.id}><b className="text-sm text-slate-900">{task.name}</b><p className="mt-1 text-xs text-slate-500">{task.task_no} · {task.status} · 截止 {task.due_at ? new Date(task.due_at).toLocaleString('zh-CN') : ''}</p></div>)}
      </div>
    </SectionCard> : null}
  </PageShell>;
}
