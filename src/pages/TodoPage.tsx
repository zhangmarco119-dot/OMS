import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
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
  return <PageShell eyebrow="门店运营系统" title="待办" backTo="/app"><section className="flex items-center justify-between rounded-lg bg-white p-4 shadow-sm"><div><p className="font-bold text-slate-900">需要实际处理的事项</p><p className="mt-1 text-sm text-slate-500">普通通知不会计入待办。</p></div><button aria-label="刷新待办" className="flex h-10 w-10 items-center justify-center rounded-lg border" onClick={() => void load()} type="button"><RefreshCw className="h-4 w-4" /></button></section>{message ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p> : null}<section className="space-y-3">{notices.map((notice) => <Link className="block rounded-lg border border-brand-100 bg-brand-50 p-4" key={notice.id} to={`/app/notices/${notice.id}`}><b>请确认公告：{notice.title}</b><p className="mt-1 text-sm text-slate-600">阅读后点击“确认已阅读”即可完成。</p></Link>)}{feedback.map((item) => <Link className="block rounded-lg border border-amber-100 bg-amber-50 p-4" key={item.feedback.id} to={`/app/history?view=feedback&feedback=${item.feedback.id}`}><div className="flex items-start justify-between gap-3"><b>商品{item.feedback.feedback_type === 'new' ? '新增' : item.feedback.feedback_type === 'incorrect' ? '修订' : '删除'}申请</b><span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-amber-800">待处理</span></div><p className="mt-2 text-sm text-slate-700">{item.storeName} · {item.creatorName}</p><p className="mt-1 text-xs text-slate-500">{new Date(item.feedback.created_at).toLocaleString('zh-CN')} · 点击处理</p></Link>)}{tasks.map((task) => <Link className="block rounded-lg bg-white p-4 shadow-sm" key={task.id} to={isAdmin ? `/app/admin/tasks/${task.id}` : `/app/tasks/${task.id}`}><div className="flex justify-between gap-3"><b>{task.name}</b><span className={`rounded-full px-2 py-1 text-xs font-bold ${v2TaskStatusClass[task.status]}`}>{task.status === 'resubmitted' ? '已重新提交 · 待审核' : v2TaskStatusLabel[task.status]}</span></div><p className="mt-2 text-sm text-slate-500">截止：{new Date(task.due_at).toLocaleString('zh-CN')}</p>{task.status === 'rejected' ? <p className="mt-2 text-sm text-red-700">需整改：{task.review_note || '请打开任务查看整改项。'}</p> : null}</Link>)}{tasks.length === 0 && feedbackCount === 0 && notices.length === 0 ? <div className="rounded-lg bg-white p-8 text-center shadow-sm"><CheckCircle2 className="mx-auto h-10 w-10 text-brand-600" /><p className="mt-3 font-bold">当前没有待办</p></div> : null}</section></PageShell>;
}
