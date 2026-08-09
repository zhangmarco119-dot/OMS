import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { ConfirmDialog, IconButton } from '../components/ui/Actions';
import { EmptyState, FeedbackBanner, StatusBadge } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { formatV2TaskDueAt, getV2TaskDisplayStatus, isV2TaskOverdue, v2TaskStatusClass, v2TaskStatusLabel } from '../features/v2-tasks/taskPresentation';
import { useTaskDeadlineClock } from '../features/v2-tasks/useTaskDeadlineClock';
import { TaskSubmissionTimeline } from '../features/v2-tasks/TaskSubmissionTimeline';
import { supabase } from '../lib/supabase';
import { isV2TaskExecutionTodoForProfile, loadV2TaskRecipients, loadV2TaskTimeline, loadV2Tasks, type V2TaskRow, type V2TaskTimelineEvent } from '../services/v2-tasks.service';
import { loadNotices, type NoticeListItem } from '../services/v2-content.service';
import { completeAttendanceCorrectionTodo, loadMyAttendanceCorrectionTodos, loadMyPayrollPayslipTodos, loadTodoSummary } from '../services/todo.service';
import { loadAllOvertimeRequests, loadManagerOvertimeRequests, loadOvertimeProfiles } from '../services/payroll.service';
import type { Database } from '../types/database';
import {
  feedbackProductText,
  handleProductFeedbackBatchActions,
  loadProductCreationRequests,
  loadProductFeedbackRecords,
  reviewProductCreationRequest,
  type ProductCreationReviewDraft,
  type ProductCreationRequestRecord,
  type ProductFeedbackRecord,
} from '../features/admin/adminProductsService';
import { PRODUCT_CATEGORIES, productCategoryLabel } from '../features/products/productCategories';
import { loadPendingArrivalCorrections, type ArrivalCorrectionListItem } from '../services/arrivals.service';

export function TodoPage() {
  const auth = useAuth(); const isAdmin = auth.profile?.role === 'admin'; const isManager = auth.profile?.role === 'manager';
  const deadlineNow = useTaskDeadlineClock();
  const [tasks, setTasks] = useState<V2TaskRow[]>([]); const [feedbackCount, setFeedbackCount] = useState(0); const [feedback, setFeedback] = useState<ProductFeedbackRecord[]>([]); const [notices, setNotices] = useState<NoticeListItem[]>([]); const [overtime, setOvertime] = useState<Database['public']['Tables']['payroll_overtime_requests']['Row'][]>([]); const [overtimeNames, setOvertimeNames] = useState<Record<string, string>>({}); const [overtimeTerms, setOvertimeTerms] = useState<Record<string, string>>({}); const [message, setMessage] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Database['public']['Tables']['attendance_missing_punch_todos']['Row'][]>([]);
  const [payslips, setPayslips] = useState<Database['public']['Tables']['payroll_payslips']['Row'][]>([]);
  const [completionMessage, setCompletionMessage] = useState('');
  const [feedbackBatchAction, setFeedbackBatchAction] = useState<'acknowledge' | 'confirm_delete' | null>(null);
  const [feedbackBatchBusy, setFeedbackBatchBusy] = useState(false);
  const [productCreationRequests, setProductCreationRequests] = useState<ProductCreationRequestRecord[]>([]);
  const [arrivalCorrections, setArrivalCorrections] = useState<ArrivalCorrectionListItem[]>([]);
  const [taskSubmitterNames, setTaskSubmitterNames] = useState<Record<string, string>>({});
  const [taskTimeline, setTaskTimeline] = useState<V2TaskTimelineEvent[]>([]);
  const [creationReview, setCreationReview] = useState<{ approve: boolean; draft: ProductCreationReviewDraft; id: string; note: string } | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const [nextTasks, summary, nextNotices, nextFeedback, nextOvertime, nextCorrections, nextPayslips, nextCreationRequests, nextTaskRecipients, nextTaskTimeline, nextArrivalCorrections] = await Promise.all([
        loadV2Tasks(supabase, isAdmin || isManager ? undefined : auth.store?.id),
        loadTodoSummary(supabase, { isAdmin, isManager, profileId: auth.profile?.id ?? '', storeId: auth.store?.id, storeIds: auth.availableStores.map((store) => store.id) }),
        isAdmin ? Promise.resolve([] as NoticeListItem[]) : loadNotices(supabase),
        isAdmin ? loadProductFeedbackRecords() : Promise.resolve([] as ProductFeedbackRecord[]),
        isAdmin ? loadAllOvertimeRequests(supabase) : isManager ? loadManagerOvertimeRequests(supabase, auth.availableStores.map((store) => store.id)) : Promise.resolve([]),
        !isAdmin && auth.profile?.id ? loadMyAttendanceCorrectionTodos(supabase, auth.profile.id) : Promise.resolve([]),
        !isAdmin && auth.profile?.id ? loadMyPayrollPayslipTodos(supabase, auth.profile.id) : Promise.resolve([]),
        isAdmin || isManager ? loadProductCreationRequests(isManager ? auth.availableStores.map((store) => store.id) : undefined) : Promise.resolve([]),
        isAdmin || isManager ? loadV2TaskRecipients(supabase) : Promise.resolve([]),
        isAdmin || isManager ? loadV2TaskTimeline(supabase) : Promise.resolve([]),
        isAdmin || isManager ? loadPendingArrivalCorrections(supabase) : Promise.resolve([] as ArrivalCorrectionListItem[]),
      ]);
      const overtimeProfiles = await loadOvertimeProfiles(supabase, nextOvertime.map((item) => item.profile_id));
      const profileMap = Object.fromEntries(overtimeProfiles.map((profile) => [profile.id, profile]));
      const approvableOvertime = nextOvertime.filter((item) => item.status === 'pending' && item.profile_id !== auth.profile?.id && (isAdmin ? profileMap[item.profile_id]?.role === 'manager' : isManager ? profileMap[item.profile_id]?.role === 'staff' : false));
      setTasks(nextTasks.filter((task) => {
        if (isAdmin) return ['submitted', 'resubmitted'].includes(task.status);
        if (isManager && ['submitted', 'resubmitted'].includes(task.status)) {
          return task.manager_review_enabled && task.submitted_by_role === 'staff';
        }
        return isV2TaskExecutionTodoForProfile(task, auth.profile?.id ?? '');
      }));
      setFeedbackCount(summary.productFeedback); setFeedback(nextFeedback.filter((item) => item.feedback.status === 'open')); setNotices(nextNotices.filter((notice) => notice.requires_acknowledgment && notice.recipients.some((recipient) => recipient.profileId === auth.profile?.id && !recipient.acknowledgedAt))); setOvertime(approvableOvertime); setOvertimeNames(Object.fromEntries(overtimeProfiles.map((profile) => [profile.id, profile.display_name]))); setOvertimeTerms(Object.fromEntries(overtimeProfiles.map((profile) => [profile.id, profile.employment_type === 'part_time' ? '兼职工时' : '加班']))); setCorrections(nextCorrections); setPayslips(nextPayslips); setMessage(null);
      setProductCreationRequests(nextCreationRequests);
      setTaskSubmitterNames(Object.fromEntries(nextTaskRecipients.map((profile) => [profile.id, profile.display_name])));
      setTaskTimeline(nextTaskTimeline);
      setArrivalCorrections(nextArrivalCorrections);
    } catch (error) { setMessage(error instanceof Error ? error.message : '加载待办失败。'); }
  }, [auth.availableStores, auth.profile?.id, auth.store?.id, isAdmin, isManager]);
  useEffect(() => { void load(); }, [load]);
  const completeCorrection = async (id: string) => {
    if (!supabase) return;
    try {
      await completeAttendanceCorrectionTodo(supabase, id);
      setCorrections((current) => current.filter((item) => item.id !== id));
      setCompletionMessage('补卡提醒已完成。此待办仅用于提醒，不需要管理员审批。');
      window.dispatchEvent(new Event('storehub:todos-changed'));
    } catch (error) { setMessage(error instanceof Error ? error.message : '补卡提醒暂时无法完成。'); }
  };
  const productCorrections = feedback.filter((item) => item.feedback.feedback_type === 'incorrect');
  const productDeletions = feedback.filter((item) => item.feedback.feedback_type === 'discontinued');
  const newProductRequests = feedback.filter((item) => item.feedback.feedback_type === 'new');
  const productReadRequests = [...newProductRequests, ...productCorrections];
  const runFeedbackBatch = async () => {
    if (!feedbackBatchAction) return;
    const targets = feedbackBatchAction === 'acknowledge'
      ? [
          ...newProductRequests.map((item) => ({ action: 'resolve' as const, id: item.feedback.id })),
          ...productCorrections.map((item) => ({ action: 'acknowledge' as const, id: item.feedback.id })),
        ]
      : productDeletions.map((item) => ({ action: 'confirm_delete' as const, id: item.feedback.id }));
    setFeedbackBatchBusy(true);
    try {
      const result = await handleProductFeedbackBatchActions(targets);
      const failureMessage = result.failed.length
        ? `已处理 ${result.succeeded}/${result.total} 条，另有 ${result.failed.length} 条处理失败，请打开货品申请逐项检查。`
        : null;
      const successMessage = feedbackBatchAction === 'acknowledge'
        ? `已将 ${result.succeeded} 条货品新增/修改申请全部标记为已读。`
        : `已同意 ${result.succeeded} 条货品删除申请。`;
      setFeedbackBatchAction(null);
      window.dispatchEvent(new Event('storehub:todos-changed'));
      await load();
      if (failureMessage) setMessage(failureMessage);
      else setCompletionMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量处理货品申请失败。');
    } finally {
      setFeedbackBatchBusy(false);
    }
  };
  const reviewCreationRequest = async () => {
    if (!creationReview) return;
    if (creationReview.approve && (!creationReview.draft.name.trim() || !creationReview.draft.spec.trim() || !creationReview.draft.count_unit.trim())) {
      setMessage('同意新增前，请填写完整的货品名称、规格和单位。');
      return;
    }
    try {
      await reviewProductCreationRequest(creationReview.id, creationReview.approve, creationReview.draft, creationReview.note);
      setCreationReview(null);
      setCompletionMessage(creationReview.approve ? '新增货品申请已通过，货品已加入货品库。' : '新增货品申请已拒绝。');
      window.dispatchEvent(new Event('storehub:todos-changed'));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '处理新增货品申请失败。');
    }
  };
  return <PageShell eyebrow="门店运营系统" title="待办" contentGapClassName="gap-3">
    <SectionCard><SectionHeader action={<IconButton aria-label="刷新待办" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></IconButton>} description="这里只显示需要实际处理的事项，普通历史通知不会计入。" title="需要处理" /></SectionCard>
    {message ? <FeedbackBanner tone="danger">{message}</FeedbackBanner> : null}
    {notices.length > 0 ? <section className="space-y-2"><h2 className="text-sm font-bold text-slate-700">待确认公告</h2>{notices.map((notice) => <Link className="ui-card ui-interactive block border-brand-200 bg-brand-50/30 p-4" key={notice.id} to={`/app/notices/${notice.id}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b className="line-clamp-2 text-slate-900">{notice.title}</b><p className="mt-1 text-sm leading-5 text-slate-600">阅读公告后点击“确认已阅读”。</p></div><StatusBadge tone="success">待确认</StatusBadge></div></Link>)}</section> : null}
    {productReadRequests.length + productDeletions.length > 0 ? <section className="space-y-2">
      <h2 className="text-sm font-bold text-slate-700">货品新增、修改与删除审核</h2>
      <article className="ui-card p-4">
        <div className="flex items-start justify-between gap-3"><div><b>待处理申请</b><p className="mt-1 text-xs text-slate-500">新增 {newProductRequests.length} 条 · 修改 {productCorrections.length} 条 · 删除 {productDeletions.length} 条</p></div><StatusBadge tone="warning">{productReadRequests.length + productDeletions.length} 条</StatusBadge></div>
        <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">
          {[...productReadRequests, ...productDeletions].map((item) => <Link className="block rounded-lg bg-slate-50 px-3 py-2 text-sm" key={item.feedback.id} to={`/app/history?view=feedback&feedback=${item.feedback.id}`}>
            <span className="flex items-center justify-between gap-2"><b className="min-w-0 truncate">{item.feedback.feedback_type === 'new' ? '新增' : item.feedback.feedback_type === 'incorrect' ? '修改' : '删除'} · {feedbackProductText(item.feedback)}</b><span className="shrink-0 text-xs text-brand-700">查看</span></span>
            <span className="mt-0.5 block text-xs text-slate-500">{item.storeName} · {item.creatorName}</span>
          </Link>)}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="ui-button-secondary px-2 text-sm" disabled={feedbackBatchBusy || productReadRequests.length === 0} onClick={() => setFeedbackBatchAction('acknowledge')} type="button">一键已读新增/修改</button>
          <button className="ui-button-primary px-2 text-sm" disabled={feedbackBatchBusy || productDeletions.length === 0} onClick={() => setFeedbackBatchAction('confirm_delete')} type="button">一键同意删除</button>
        </div>
      </article>
    </section> : null}
    {productCreationRequests.length > 0 ? <section className="space-y-2">
      <h2 className="text-sm font-bold text-slate-700">到货新增货品审核</h2>
      {productCreationRequests.map(({ creatorName, request, storeName }) => <article className="ui-card p-4" key={request.id}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><b className="block truncate">{request.name}</b><p className="mt-1 text-sm text-slate-600">{request.spec} · {request.count_unit} · {productCategoryLabel(request.category_code)}</p><p className="mt-1 text-xs text-slate-500">{storeName} · {creatorName}</p></div><StatusBadge tone="warning">待审核</StatusBadge></div>
        <div className="mt-3 grid grid-cols-2 gap-2"><button className="ui-button-secondary text-red-700" onClick={() => setCreationReview({ approve: false, draft: { category_code: request.category_code, count_unit: request.count_unit, name: request.name, spec: request.spec }, id: request.id, note: '' })} type="button">拒绝</button><button className="ui-button-primary" onClick={() => setCreationReview({ approve: true, draft: { category_code: request.category_code, count_unit: request.count_unit, name: request.name, spec: request.spec }, id: request.id, note: '' })} type="button">编辑并同意新增</button></div>
      </article>)}
    </section> : null}
    {arrivalCorrections.length > 0 ? <section className="space-y-2">
      <h2 className="text-sm font-bold text-slate-700">到货信息更正审核</h2>
      {arrivalCorrections.map(({ report, request, requesterName }) => <Link className="ui-card ui-interactive block p-4" key={request.id} to={`/app/arrivals/corrections/${request.id}/review`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b className="block truncate">{report.report_no}</b><p className="mt-1 line-clamp-2 text-sm text-slate-600">{report.generated_summary}</p><p className="mt-1 text-xs text-slate-500">{requesterName} · {request.requester_role === 'manager' ? '店长提交，需管理员审核' : '员工提交'}</p></div><StatusBadge tone="warning">更正待审核</StatusBadge></div><p className="mt-2 text-xs text-slate-400">申请时间：{formatV2TaskDueAt(request.created_at)}</p></Link>)}
    </section> : null}
    {overtime.length > 0 ? <section className="space-y-2"><h2 className="text-sm font-bold text-slate-700">工时审批</h2>{overtime.map((item) => <Link className="ui-card ui-interactive block p-4" key={item.id} to={isAdmin ? '/app/admin/payroll?tab=overtime' : '/app/overtime?tab=submit'}><div className="flex items-start justify-between gap-3"><b>{overtimeNames[item.profile_id] ?? '员工'} · {overtimeTerms[item.profile_id] ?? '加班'} · {item.overtime_date} · {item.hours} 小时</b><StatusBadge tone="warning">待审批</StatusBadge></div>{item.reason ? <p className="mt-2 text-sm text-slate-500">{item.reason}</p> : null}</Link>)}</section> : null}
    {corrections.length > 0 ? <section className="space-y-2"><h2 className="text-sm font-bold text-slate-700">补卡提醒</h2>{corrections.map((item) => { const overdue = new Date(item.due_at).getTime() <= deadlineNow; return <article className="ui-card p-4" key={item.id}><div className="flex items-start justify-between gap-3"><div><b>{item.attendance_date} · {item.missing_punch === 'on' ? '缺上班卡' : item.missing_punch === 'off' ? '缺下班卡' : '上下班均缺卡'}</b><p className={`mt-1 text-xs font-semibold ${overdue ? 'text-red-700' : 'text-slate-600'}`}>截止时间：{formatV2TaskDueAt(item.due_at)} · 请在钉钉提交补卡</p>{overdue ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-800">已逾期 · 补卡提醒尚未完成</p> : null}{item.missing_punch === 'on' || item.missing_punch === 'both' ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">请按实际到岗时间补上班卡，切勿虚假填报！</p> : null}</div><StatusBadge tone="danger">{overdue ? '已逾期' : '待补卡'}</StatusBadge></div><label className="mt-3 flex min-h-11 cursor-pointer items-center rounded-lg bg-emerald-50 px-3 text-sm font-bold text-emerald-900"><input className="mr-2 h-4 w-4" onChange={() => void completeCorrection(item.id)} type="checkbox" />我已提交补卡，完成提醒</label></article>; })}</section> : null}
    {payslips.length > 0 ? <section className="space-y-2"><h2 className="text-sm font-bold text-slate-700">工资单确认</h2>{payslips.map((item) => <Link className="ui-card ui-interactive block border-brand-200 p-4" key={item.id} to={`/app/payroll?tab=payslips&payslip=${item.id}`}><div className="flex items-start justify-between gap-3"><div><b>{item.payroll_month.slice(0, 4)}年{Number(item.payroll_month.slice(5, 7))}月工资单</b><p className="mt-1 text-sm text-slate-500">请核对工资明细并确认工资单内容。</p></div><StatusBadge tone="warning">待确认</StatusBadge></div></Link>)}</section> : null}
    {tasks.length > 0 ? <section className="space-y-2"><h2 className="text-sm font-bold text-slate-700">任务待办</h2>{tasks.map((task) => { const reviewTask = isAdmin || (isManager && ['submitted', 'resubmitted'].includes(task.status)); const submitterName = task.submitted_by ? taskSubmitterNames[task.submitted_by] ?? '已提交账号' : ''; const displayStatus = getV2TaskDisplayStatus(task, deadlineNow); const overdue = isV2TaskOverdue(task, deadlineNow); const timeline = taskTimeline.filter((event) => event.task_id === task.id); return <Link className="ui-card ui-interactive block p-4" key={task.id} to={reviewTask ? `/app/admin/tasks/${task.id}` : `/app/tasks/${task.id}`}><div className="flex items-start justify-between gap-3"><b className="min-w-0 line-clamp-2">{task.name}</b><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${v2TaskStatusClass[displayStatus]}`}>{task.status === 'resubmitted' ? '已重新提交 · 待审核' : v2TaskStatusLabel[displayStatus]}</span></div><p className={`mt-2 text-sm font-semibold ${overdue ? 'text-red-700' : 'text-slate-600'}`}>截止时间：{formatV2TaskDueAt(task.due_at)}</p>{overdue ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-800">已逾期 · 任务尚未提交</p> : null}{reviewTask && submitterName ? <p className="mt-1 text-xs text-slate-500">提交人：{submitterName}</p> : null}{reviewTask ? <TaskSubmissionTimeline events={timeline} fallbackSubmittedAt={task.submitted_at} /> : null}{reviewTask && isManager ? <p className="mt-1 text-xs font-semibold text-brand-700">员工提交 · 等待店长或管理员审核</p> : null}{task.status === 'rejected' ? <FeedbackBanner className="mt-2" title="需要整改" tone="danger">{task.review_note || '请打开任务查看整改项目。'}</FeedbackBanner> : null}</Link>; })}</section> : null}
    {tasks.length === 0 && feedbackCount === 0 && productCreationRequests.length === 0 && arrivalCorrections.length === 0 && notices.length === 0 && overtime.length === 0 && corrections.length === 0 && payslips.length === 0 ? <EmptyState description="新的任务审核、到货更正、货品申请、补卡提醒、工资单确认、工时审批或需确认公告会显示在这里。" icon={CheckCircle2} title="当前没有待办" /> : null}
    <ConfirmDialog confirmLabel={feedbackBatchAction === 'confirm_delete' ? '一键同意删除' : '一键标记已读'} danger={feedbackBatchAction === 'confirm_delete'} onCancel={() => setFeedbackBatchAction(null)} onConfirm={() => void runFeedbackBatch()} open={Boolean(feedbackBatchAction)} title={feedbackBatchAction === 'confirm_delete' ? '确认批量删除货品' : '确认批量已读'}>
      <p>{feedbackBatchAction === 'confirm_delete'
        ? `将同意当前 ${productDeletions.length} 条删除申请，并删除对应货品。此操作无法撤销。`
        : `将当前 ${newProductRequests.length} 条新增和 ${productCorrections.length} 条已生效修改申请全部标记为已读。`}</p>
    </ConfirmDialog>
    <ConfirmDialog confirmLabel={creationReview?.approve ? '按以上内容同意新增' : '确认拒绝'} danger={!creationReview?.approve} onCancel={() => setCreationReview(null)} onConfirm={() => void reviewCreationRequest()} open={Boolean(creationReview)} title={creationReview?.approve ? '编辑并审核新增货品' : '确认拒绝新增货品'}>
      {creationReview?.approve ? <div className="space-y-3"><p className="text-sm leading-6 text-slate-600">请先核对或修改详细内容；通过后将按下列内容加入货品库，并回填本次到货记录。</p><label className="block text-sm font-semibold">货品名称<input className="ui-input mt-1" onChange={(event) => setCreationReview((current) => current ? { ...current, draft: { ...current.draft, name: event.target.value } } : current)} value={creationReview.draft.name} /></label><label className="block text-sm font-semibold">规格<input className="ui-input mt-1" onChange={(event) => setCreationReview((current) => current ? { ...current, draft: { ...current.draft, spec: event.target.value } } : current)} value={creationReview.draft.spec} /></label><label className="block text-sm font-semibold">单位<input className="ui-input mt-1" onChange={(event) => setCreationReview((current) => current ? { ...current, draft: { ...current.draft, count_unit: event.target.value } } : current)} value={creationReview.draft.count_unit} /></label><label className="block text-sm font-semibold">分类<select className="ui-input mt-1" onChange={(event) => setCreationReview((current) => current ? { ...current, draft: { ...current.draft, category_code: event.target.value as ProductCreationReviewDraft['category_code'] } } : current)} value={creationReview.draft.category_code}>{PRODUCT_CATEGORIES.map((category) => <option key={category.code} value={category.code}>{category.label}</option>)}</select></label><label className="block text-sm font-semibold">审核备注（选填）<textarea className="ui-input mt-1 min-h-20 py-2" onChange={(event) => setCreationReview((current) => current ? { ...current, note: event.target.value } : current)} value={creationReview.note} /></label></div> : <div><p>拒绝后不会创建货品，本次到货记录仍会保留。</p><label className="mt-3 block text-sm font-semibold">拒绝原因（选填）<textarea className="ui-input mt-1 min-h-20 py-2" onChange={(event) => setCreationReview((current) => current ? { ...current, note: event.target.value } : current)} value={creationReview?.note ?? ''} /></label></div>}
    </ConfirmDialog>
    <ActionFeedbackDialog message={completionMessage} onClose={() => setCompletionMessage('')} open={Boolean(completionMessage)} title="待办已完成" tone="success" />
  </PageShell>;
}
