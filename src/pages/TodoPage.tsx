import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { IconButton } from '../components/ui/Actions';
import { EmptyState, FeedbackBanner, StatusBadge } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { v2TaskStatusClass, v2TaskStatusLabel } from '../features/v2-tasks/taskPresentation';
import { supabase } from '../lib/supabase';
import { loadV2Tasks, type V2TaskRow } from '../services/v2-tasks.service';
import { loadNotices, type NoticeListItem } from '../services/v2-content.service';
import { completeAttendanceCorrectionTodo, loadMyAttendanceCorrectionTodos, loadTodoSummary } from '../services/todo.service';
import { loadAllOvertimeRequests, loadManagerOvertimeRequests, loadOvertimeProfiles } from '../services/payroll.service';
import type { Database } from '../types/database';
import { loadProductFeedbackRecords, type ProductFeedbackRecord } from '../features/admin/adminProductsService';

export function TodoPage() {
  const auth = useAuth(); const isAdmin = auth.profile?.role === 'admin'; const isManager = auth.profile?.role === 'manager';
  const [tasks, setTasks] = useState<V2TaskRow[]>([]); const [feedbackCount, setFeedbackCount] = useState(0); const [feedback, setFeedback] = useState<ProductFeedbackRecord[]>([]); const [notices, setNotices] = useState<NoticeListItem[]>([]); const [overtime, setOvertime] = useState<Database['public']['Tables']['payroll_overtime_requests']['Row'][]>([]); const [overtimeNames, setOvertimeNames] = useState<Record<string, string>>({}); const [message, setMessage] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Database['public']['Tables']['attendance_missing_punch_todos']['Row'][]>([]);
  const [completionMessage, setCompletionMessage] = useState('');
  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const [nextTasks, summary, nextNotices, nextFeedback, nextOvertime, nextCorrections] = await Promise.all([
        loadV2Tasks(supabase, isAdmin ? undefined : auth.store?.id),
        loadTodoSummary(supabase, { isAdmin, isManager, profileId: auth.profile?.id ?? '', storeId: auth.store?.id, storeIds: auth.availableStores.map((store) => store.id) }),
        isAdmin ? Promise.resolve([] as NoticeListItem[]) : loadNotices(supabase),
        isAdmin ? loadProductFeedbackRecords() : Promise.resolve([] as ProductFeedbackRecord[]),
        isAdmin ? loadAllOvertimeRequests(supabase) : isManager ? loadManagerOvertimeRequests(supabase, auth.availableStores.map((store) => store.id)) : Promise.resolve([]),
        !isAdmin && auth.profile?.id ? loadMyAttendanceCorrectionTodos(supabase, auth.profile.id) : Promise.resolve([]),
      ]);
      const overtimeProfiles = await loadOvertimeProfiles(supabase, nextOvertime.map((item) => item.profile_id));
      const profileMap = Object.fromEntries(overtimeProfiles.map((profile) => [profile.id, profile]));
      const approvableOvertime = nextOvertime.filter((item) => item.status === 'pending' && item.profile_id !== auth.profile?.id && (isAdmin ? profileMap[item.profile_id]?.role === 'manager' : isManager ? profileMap[item.profile_id]?.role === 'staff' : false));
      setTasks(nextTasks.filter((task) => isAdmin ? ['submitted', 'resubmitted'].includes(task.status) : ['pending', 'in_progress', 'rejected', 'overdue'].includes(task.status)));
      setFeedbackCount(summary.productFeedback); setFeedback(nextFeedback.filter((item) => item.feedback.status === 'open')); setNotices(nextNotices.filter((notice) => notice.requires_acknowledgment && notice.recipients.some((recipient) => recipient.profileId === auth.profile?.id && !recipient.acknowledgedAt))); setOvertime(approvableOvertime); setOvertimeNames(Object.fromEntries(overtimeProfiles.map((profile) => [profile.id, profile.display_name]))); setCorrections(nextCorrections); setMessage(null);
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
  return <PageShell eyebrow="门店运营系统" title="待办" contentGapClassName="gap-3">
    <SectionCard><SectionHeader action={<IconButton aria-label="刷新待办" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></IconButton>} description="这里只显示需要实际处理的事项，普通历史通知不会计入。" title="需要处理" /></SectionCard>
    {message ? <FeedbackBanner tone="danger">{message}</FeedbackBanner> : null}
    {notices.length > 0 ? <section className="space-y-2"><h2 className="text-sm font-bold text-slate-700">待确认公告</h2>{notices.map((notice) => <Link className="ui-card ui-interactive block border-brand-200 bg-brand-50/30 p-4" key={notice.id} to={`/app/notices/${notice.id}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b className="line-clamp-2 text-slate-900">{notice.title}</b><p className="mt-1 text-sm leading-5 text-slate-600">阅读公告后点击“确认已阅读”。</p></div><StatusBadge tone="success">待确认</StatusBadge></div></Link>)}</section> : null}
    {feedback.length > 0 ? <section className="space-y-2"><h2 className="text-sm font-bold text-slate-700">货品申请</h2>{feedback.map((item) => <Link className="ui-card ui-interactive block p-4" key={item.feedback.id} to={`/app/history?view=feedback&feedback=${item.feedback.id}`}><div className="flex items-start justify-between gap-3"><b>货品{item.feedback.feedback_type === 'new' ? '新增' : item.feedback.feedback_type === 'incorrect' ? '修订' : '删除'}申请</b><StatusBadge tone="warning">待处理</StatusBadge></div><p className="mt-2 text-sm text-slate-700">{item.storeName} · {item.creatorName}</p><p className="mt-1 text-xs text-slate-500">{new Date(item.feedback.created_at).toLocaleString('zh-CN')} · 点击处理</p></Link>)}</section> : null}
    {overtime.length > 0 ? <section className="space-y-2"><h2 className="text-sm font-bold text-slate-700">加班审批</h2>{overtime.map((item) => <Link className="ui-card ui-interactive block p-4" key={item.id} to={isAdmin ? '/app/admin/payroll?tab=overtime' : '/app/overtime?tab=submit'}><div className="flex items-start justify-between gap-3"><b>{overtimeNames[item.profile_id] ?? '员工'} · {item.overtime_date} · {item.hours} 小时</b><StatusBadge tone="warning">待审批</StatusBadge></div>{item.reason ? <p className="mt-2 text-sm text-slate-500">{item.reason}</p> : null}</Link>)}</section> : null}
    {corrections.length > 0 ? <section className="space-y-2"><h2 className="text-sm font-bold text-slate-700">补卡提醒</h2>{corrections.map((item) => <article className="ui-card p-4" key={item.id}><div className="flex items-start justify-between gap-3"><div><b>{item.attendance_date} · {item.missing_punch === 'on' ? '缺上班卡' : item.missing_punch === 'off' ? '缺下班卡' : '上下班均缺卡'}</b><p className="mt-1 text-xs text-slate-500">截止：{new Date(item.due_at).toLocaleString('zh-CN')} · 请在钉钉提交补卡</p>{item.missing_punch === 'on' || item.missing_punch === 'both' ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">请按实际到岗时间补上班卡，切勿虚假填报！</p> : null}</div><StatusBadge tone="danger">待补卡</StatusBadge></div><label className="mt-3 flex min-h-11 cursor-pointer items-center rounded-lg bg-emerald-50 px-3 text-sm font-bold text-emerald-900"><input className="mr-2 h-4 w-4" onChange={() => void completeCorrection(item.id)} type="checkbox" />我已提交补卡，完成提醒</label></article>)}</section> : null}
    {tasks.length > 0 ? <section className="space-y-2"><h2 className="text-sm font-bold text-slate-700">任务待办</h2>{tasks.map((task) => <Link className="ui-card ui-interactive block p-4" key={task.id} to={isAdmin ? `/app/admin/tasks/${task.id}` : `/app/tasks/${task.id}`}><div className="flex items-start justify-between gap-3"><b className="min-w-0 line-clamp-2">{task.name}</b><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${v2TaskStatusClass[task.status]}`}>{task.status === 'resubmitted' ? '已重新提交 · 待审核' : v2TaskStatusLabel[task.status]}</span></div><p className="mt-2 text-sm text-slate-500">截止：{new Date(task.due_at).toLocaleString('zh-CN')}</p>{task.status === 'rejected' ? <FeedbackBanner className="mt-2" title="需要整改" tone="danger">{task.review_note || '请打开任务查看整改项目。'}</FeedbackBanner> : null}</Link>)}</section> : null}
    {tasks.length === 0 && feedbackCount === 0 && notices.length === 0 && overtime.length === 0 && corrections.length === 0 ? <EmptyState description="新的任务审核、货品申请、补卡提醒、加班审批或需确认公告会显示在这里。" icon={CheckCircle2} title="当前没有待办" /> : null}
    <ActionFeedbackDialog message={completionMessage} onClose={() => setCompletionMessage('')} open={Boolean(completionMessage)} title="待办已完成" tone="success" />
  </PageShell>;
}
