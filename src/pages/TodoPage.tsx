import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { IconButton } from '../components/ui/Actions';
import { EmptyState, FeedbackBanner, StatusBadge } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { v2TaskStatusClass, v2TaskStatusLabel } from '../features/v2-tasks/taskPresentation';
import { supabase } from '../lib/supabase';
import { loadV2Tasks, type V2TaskRow } from '../services/v2-tasks.service';
import { loadNotices, type NoticeListItem } from '../services/v2-content.service';
import { loadTodoSummary } from '../services/todo.service';
import { loadProductFeedbackRecords, type ProductFeedbackRecord } from '../features/admin/adminProductsService';

export function TodoPage() {
  const auth = useAuth(); const isAdmin = auth.profile?.role === 'admin';
  const [tasks, setTasks] = useState<V2TaskRow[]>([]); const [feedbackCount, setFeedbackCount] = useState(0); const [feedback, setFeedback] = useState<ProductFeedbackRecord[]>([]); const [notices, setNotices] = useState<NoticeListItem[]>([]); const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const [nextTasks, summary, nextNotices, nextFeedback] = await Promise.all([
        loadV2Tasks(supabase, isAdmin ? undefined : auth.store?.id),
        loadTodoSummary(supabase, { isAdmin, profileId: auth.profile?.id ?? '', storeId: auth.store?.id }),
        isAdmin ? Promise.resolve([] as NoticeListItem[]) : loadNotices(supabase),
        isAdmin ? loadProductFeedbackRecords() : Promise.resolve([] as ProductFeedbackRecord[]),
      ]);
      setTasks(nextTasks.filter((task) => isAdmin ? ['submitted', 'resubmitted'].includes(task.status) : ['pending', 'in_progress', 'rejected', 'overdue'].includes(task.status)));
      setFeedbackCount(summary.productFeedback); setFeedback(nextFeedback.filter((item) => item.feedback.status === 'open')); setNotices(nextNotices.filter((notice) => notice.requires_acknowledgment && notice.recipients.some((recipient) => recipient.profileId === auth.profile?.id && !recipient.acknowledgedAt))); setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : '加载待办失败。'); }
  }, [auth.profile?.id, auth.store?.id, isAdmin]);
  useEffect(() => { void load(); }, [load]);
  return <PageShell eyebrow="门店运营系统" title="待办" contentGapClassName="gap-3">
    <SectionCard><SectionHeader action={<IconButton aria-label="刷新待办" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></IconButton>} description="这里只显示需要实际处理的事项，普通历史通知不会计入。" title="需要处理" /></SectionCard>
    {message ? <FeedbackBanner tone="danger">{message}</FeedbackBanner> : null}
    {notices.length > 0 ? <section className="space-y-2"><h2 className="text-sm font-bold text-slate-700">待确认公告</h2>{notices.map((notice) => <Link className="ui-card ui-interactive block border-brand-200 bg-brand-50/30 p-4" key={notice.id} to={`/app/notices/${notice.id}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b className="line-clamp-2 text-slate-900">{notice.title}</b><p className="mt-1 text-sm leading-5 text-slate-600">阅读公告后点击“确认已阅读”。</p></div><StatusBadge tone="success">待确认</StatusBadge></div></Link>)}</section> : null}
    {feedback.length > 0 ? <section className="space-y-2"><h2 className="text-sm font-bold text-slate-700">商品申请</h2>{feedback.map((item) => <Link className="ui-card ui-interactive block p-4" key={item.feedback.id} to={`/app/history?view=feedback&feedback=${item.feedback.id}`}><div className="flex items-start justify-between gap-3"><b>商品{item.feedback.feedback_type === 'new' ? '新增' : item.feedback.feedback_type === 'incorrect' ? '修订' : '删除'}申请</b><StatusBadge tone="warning">待处理</StatusBadge></div><p className="mt-2 text-sm text-slate-700">{item.storeName} · {item.creatorName}</p><p className="mt-1 text-xs text-slate-500">{new Date(item.feedback.created_at).toLocaleString('zh-CN')} · 点击处理</p></Link>)}</section> : null}
    {tasks.length > 0 ? <section className="space-y-2"><h2 className="text-sm font-bold text-slate-700">任务待办</h2>{tasks.map((task) => <Link className="ui-card ui-interactive block p-4" key={task.id} to={isAdmin ? `/app/admin/tasks/${task.id}` : `/app/tasks/${task.id}`}><div className="flex items-start justify-between gap-3"><b className="min-w-0 line-clamp-2">{task.name}</b><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${v2TaskStatusClass[task.status]}`}>{task.status === 'resubmitted' ? '已重新提交 · 待审核' : v2TaskStatusLabel[task.status]}</span></div><p className="mt-2 text-sm text-slate-500">截止：{new Date(task.due_at).toLocaleString('zh-CN')}</p>{task.status === 'rejected' ? <FeedbackBanner className="mt-2" title="需要整改" tone="danger">{task.review_note || '请打开任务查看整改项目。'}</FeedbackBanner> : null}</Link>)}</section> : null}
    {tasks.length === 0 && feedbackCount === 0 && notices.length === 0 ? <EmptyState description="新的任务审核、商品申请或需确认公告会显示在这里。" icon={CheckCircle2} title="当前没有待办" /> : null}
  </PageShell>;
}
