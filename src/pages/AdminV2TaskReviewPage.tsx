import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ConfirmDialog, MobileActionBar } from '../components/ui/Actions';
import { FeedbackBanner, LoadingState } from '../components/ui/Feedback';
import { TaskImagePreview } from '../features/v2-tasks/TaskImagePreview';
import { TaskReferenceImagePreview } from '../features/v2-tasks/TaskReferenceImagePreview';
import { v2TaskStatusClass, v2TaskStatusLabel } from '../features/v2-tasks/taskPresentation';
import { supabase } from '../lib/supabase';
import { asTaskItemSnapshot, loadV2TaskDetail, loadV2TaskImageUrls, loadV2TaskReferenceImageUrls, reviewV2Task, withdrawV2Task, type V2TaskDetail } from '../services/v2-tasks.service';

export function AdminV2TaskReviewPage() {
  const { taskId = '' } = useParams();
  const [detail, setDetail] = useState<V2TaskDetail | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [referenceImageUrls, setReferenceImageUrls] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState('');
  const [corrections, setCorrections] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const next = await loadV2TaskDetail(supabase, taskId);
      setDetail(next);
      const [nextImageUrls, nextReferenceImageUrls] = await Promise.all([loadV2TaskImageUrls(supabase, next.images), loadV2TaskReferenceImageUrls(supabase, next.answers)]);
      setImageUrls(nextImageUrls);
      setReferenceImageUrls(nextReferenceImageUrls);
      setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : '加载任务失败'); }
  }, [taskId]);
  useEffect(() => { void load(); }, [load]);
  const review = async (action: 'approved' | 'rejected') => {
    if (!supabase) return;
    if (action === 'rejected' && corrections.length === 0) { setMessage('退回整改时，请至少勾选一项需要整改的项目。'); return; }
    if (action === 'rejected' && !note.trim()) { setMessage('退回整改时，请填写具体的整改原因。'); return; }
    try { await reviewV2Task(supabase, taskId, action, note, corrections); setMessage(action === 'approved' ? '任务已通过。' : '任务已退回整改。'); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '审核失败'); }
  };
  const withdraw = async () => {
    if (!supabase || !detail) return;
    setShowWithdrawConfirm(false);
    try { await withdrawV2Task(supabase, detail.task.id); setMessage('任务已撤回。'); await load(); window.dispatchEvent(new Event('storehub:todos-changed')); }
    catch (error) { setMessage(error instanceof Error ? error.message : '撤回任务失败'); }
  };
  return <PageShell eyebrow="门店运营系统 · 管理员审核" title={detail?.task.name ?? '任务'} backTo="/app/admin/tasks" contentGapClassName="gap-3">
    {message ? <FeedbackBanner tone={message.includes('失败') || message.includes('请') ? 'warning' : 'success'}>{message}</FeedbackBanner> : null}
    {detail ? <><section className="ui-card p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-700">{detail.task.task_no}</p><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${v2TaskStatusClass[detail.task.status]}`}>{v2TaskStatusLabel[detail.task.status]}</span></div><p className="mt-2 text-sm text-slate-500">截止 {new Date(detail.task.due_at).toLocaleString('zh-CN')}</p>{!['approved', 'cancelled'].includes(detail.task.status) ? <button className="ui-button-secondary mt-3 border-red-200 text-red-700 hover:bg-red-50" onClick={() => setShowWithdrawConfirm(true)} type="button">撤回任务</button> : null}</section>
      {detail.answers.map((answer) => { const item = asTaskItemSnapshot(answer.item_snapshot); const images = detail.images.filter((image) => image.item_id === answer.item_id); return <article className={`ui-card block p-4 ${detail.task.correction_item_ids.includes(answer.item_id) ? 'border-red-300 bg-red-50/20' : ''}`} key={answer.id}><div className="flex gap-3"><input aria-label={`退回整改：${item.label}`} checked={corrections.includes(answer.item_id)} disabled={!['submitted', 'resubmitted'].includes(detail.task.status)} onChange={() => setCorrections(corrections.includes(answer.item_id) ? corrections.filter((id) => id !== answer.item_id) : [...corrections, answer.item_id])} type="checkbox" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b>{item.label}</b>{detail.task.correction_item_ids.includes(answer.item_id) ? <span className="rounded-full border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700">需整改</span> : null}</div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{formatAnswer(answer.answer)}</p><TaskReferenceImagePreview urls={referenceImageUrls[answer.item_id] ?? []} /><div className="mt-3"><TaskImagePreview imageUrls={imageUrls} images={images} /></div></div></div></article>; })}
      {['submitted', 'resubmitted'].includes(detail.task.status) ? <section className="ui-card p-4"><textarea className="ui-input min-h-24 py-3" onChange={(event) => setNote(event.target.value)} placeholder="审核意见 / 退回原因" value={note} /><p className="mt-2 text-xs leading-5 text-slate-500">退回时请至少勾选一项需要整改的内容，并填写原因。</p><MobileActionBar className="mt-3 grid grid-cols-2 gap-2.5"><button className="ui-button-primary" onClick={() => void review('approved')} type="button">通过</button><button className="ui-button-danger" onClick={() => void review('rejected')} type="button">退回整改</button></MobileActionBar></section> : null}</> : <LoadingState label="正在加载任务" />}
    <ConfirmDialog confirmLabel="确认撤回" danger onCancel={() => setShowWithdrawConfirm(false)} onConfirm={() => void withdraw()} open={showWithdrawConfirm} title="撤回任务"><p>撤回后，员工和店长将无法继续执行该任务。此操作会同步更新待办列表。</p></ConfirmDialog>
  </PageShell>;
}

const formatAnswer = (answer: unknown) => {
  if (answer === null || answer === undefined) return '尚未填写';
  if (typeof answer === 'string') return answer || '尚未填写';
  if (typeof answer === 'boolean') return answer ? '已确认' : '未确认';
  if (Array.isArray(answer)) return answer.join('、') || '尚未选择';
  return String(answer);
};
