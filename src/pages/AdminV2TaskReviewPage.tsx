import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
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
    if (!supabase || !detail || !window.confirm('撤回后员工和店长将无法继续执行该任务，确认撤回吗？')) return;
    try { await withdrawV2Task(supabase, detail.task.id); setMessage('任务已撤回。'); await load(); window.dispatchEvent(new Event('storehub:todos-changed')); }
    catch (error) { setMessage(error instanceof Error ? error.message : '撤回任务失败'); }
  };
  return <PageShell eyebrow="门店运营系统 · 管理员审核" title={detail?.task.name ?? '任务'} backTo="/app/admin/tasks">
    {message ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{message}</p> : null}
    {detail ? <><section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><p>{detail.task.task_no}</p><span className={`rounded-full px-3 py-1 text-xs font-bold ${v2TaskStatusClass[detail.task.status]}`}>{v2TaskStatusLabel[detail.task.status]}</span></div><p className="mt-2 text-sm text-slate-500">截止 {new Date(detail.task.due_at).toLocaleString('zh-CN')}</p>{!['approved', 'cancelled'].includes(detail.task.status) ? <button className="mt-3 min-h-10 rounded-lg border border-red-200 px-3 text-sm font-bold text-red-700" onClick={() => void withdraw()} type="button">撤回任务</button> : null}</section>
      {detail.answers.map((answer) => { const item = asTaskItemSnapshot(answer.item_snapshot); const images = detail.images.filter((image) => image.item_id === answer.item_id); return <article className={`block rounded-lg bg-white p-4 shadow-sm ${detail.task.correction_item_ids.includes(answer.item_id) ? 'ring-2 ring-red-300' : ''}`} key={answer.id}><div className="flex gap-3"><input aria-label={`退回整改：${item.label}`} checked={corrections.includes(answer.item_id)} disabled={!['submitted', 'resubmitted'].includes(detail.task.status)} onChange={() => setCorrections(corrections.includes(answer.item_id) ? corrections.filter((id) => id !== answer.item_id) : [...corrections, answer.item_id])} type="checkbox" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b>{item.label}</b>{detail.task.correction_item_ids.includes(answer.item_id) ? <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-bold text-red-700">需整改</span> : null}</div><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{formatAnswer(answer.answer)}</p><TaskReferenceImagePreview urls={referenceImageUrls[answer.item_id] ?? []} /><div className="mt-3"><TaskImagePreview imageUrls={imageUrls} images={images} /></div></div></div></article>; })}
      {['submitted', 'resubmitted'].includes(detail.task.status) ? <section className="rounded-lg bg-white p-4 shadow-sm"><textarea className="min-h-24 w-full rounded-lg border p-3" onChange={(event) => setNote(event.target.value)} placeholder="审核意见 / 退回原因" value={note} /><p className="mt-2 text-xs text-slate-500">退回时请至少勾选一项需要整改的内容，并填写原因。</p><div className="mt-3 grid grid-cols-2 gap-3"><button className="min-h-12 rounded-lg bg-brand-600 font-bold text-white" onClick={() => void review('approved')} type="button">通过</button><button className="min-h-12 rounded-lg bg-red-600 font-bold text-white" onClick={() => void review('rejected')} type="button">退回整改</button></div></section> : null}</> : <p className="rounded-lg bg-white p-5">正在加载</p>}
  </PageShell>;
}

const formatAnswer = (answer: unknown) => {
  if (answer === null || answer === undefined) return '尚未填写';
  if (typeof answer === 'string') return answer || '尚未填写';
  if (typeof answer === 'boolean') return answer ? '已确认' : '未确认';
  if (Array.isArray(answer)) return answer.join('、') || '尚未选择';
  return String(answer);
};
