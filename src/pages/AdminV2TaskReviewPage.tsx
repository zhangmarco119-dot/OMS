import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { ConfirmDialog, MobileActionBar } from '../components/ui/Actions';
import { FeedbackBanner, LoadingState } from '../components/ui/Feedback';
import { TaskImagePreview } from '../features/v2-tasks/TaskImagePreview';
import { TaskReferenceImagePreview } from '../features/v2-tasks/TaskReferenceImagePreview';
import { v2TaskStatusClass, v2TaskStatusLabel } from '../features/v2-tasks/taskPresentation';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import {
  asTaskItemSnapshot,
  canReviewV2Task,
  getV2TaskAnswerPositions,
  loadV2TaskDetail,
  loadV2TaskImageUrls,
  loadV2TaskReferenceImageUrls,
  reviewV2TaskItems,
  withdrawV2Task,
  type V2TaskDetail,
  type V2TaskItemDecision,
} from '../services/v2-tasks.service';

type ReviewDecision = V2TaskItemDecision['decision'];

export function AdminV2TaskReviewPage() {
  const auth = useAuth();
  const { taskId = '' } = useParams();
  const [detail, setDetail] = useState<V2TaskDetail | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [referenceImageUrls, setReferenceImageUrls] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [reviewAllowed, setReviewAllowed] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const [next, allowed] = await Promise.all([loadV2TaskDetail(supabase, taskId), canReviewV2Task(supabase, taskId)]);
      setDetail(next);
      setReviewAllowed(allowed);
      const [nextImageUrls, nextReferenceImageUrls] = await Promise.all([
        loadV2TaskImageUrls(supabase, next.images),
        loadV2TaskReferenceImageUrls(supabase, next.answers),
      ]);
      setImageUrls(nextImageUrls);
      setReferenceImageUrls(nextReferenceImageUrls);
      setSelectedIds([]);
      setDecisions({});
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载任务失败');
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);

  const answerPositions = useMemo(() => getV2TaskAnswerPositions(detail?.task.snapshot ?? null), [detail?.task.snapshot]);
  const isReviewable = detail ? reviewAllowed && ['submitted', 'resubmitted'].includes(detail.task.status) : false;
  const reviewableStatus = detail?.task.status === 'resubmitted' ? 'resubmitted' : 'pending';
  const reviewableAnswers = useMemo(
    () => detail?.answers.filter((answer) => isReviewable && answer.review_status === reviewableStatus) ?? [],
    [detail?.answers, isReviewable, reviewableStatus],
  );
  const rejectedCount = reviewableAnswers.filter((answer) => decisions[answer.item_id] === 'rejected').length;
  const approvedCount = reviewableAnswers.length - rejectedCount;

  const toggleSelected = (itemId: string) => setSelectedIds((current) => current.includes(itemId)
    ? current.filter((id) => id !== itemId)
    : [...current, itemId]);
  const rejectSelectedItems = (itemIds: string[]) => {
    if (itemIds.length === 0) { setMessage('请先勾选需要审核的项目。'); return; }
    setDecisions((current) => ({ ...current, ...Object.fromEntries(itemIds.map((itemId) => [itemId, 'rejected' as const])) }));
    setSelectedIds([]);
    setMessage(null);
  };

  const approveAllItems = () => {
    setDecisions({});
    setSelectedIds([]);
    setMessage(null);
  };

  const submitReview = async () => {
    if (!supabase || !detail || busy) return;
    const hasRejection = reviewableAnswers.some((answer) => decisions[answer.item_id] === 'rejected');
    if (hasRejection && !note.trim()) {
      setMessage('包含驳回项目时，请填写具体的整改原因。');
      return;
    }
    setBusy(true);
    try {
      await reviewV2TaskItems(supabase, taskId, reviewableAnswers.map((answer) => ({
        decision: decisions[answer.item_id] === 'rejected' ? 'rejected' : 'approved',
        itemId: answer.item_id,
      })), note.trim());
      window.dispatchEvent(new Event('storehub:todos-changed'));
      await load();
      setMessage(hasRejection ? '审核已提交，驳回项目已退回员工整改。' : '审核已提交，任务全部通过。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '审核失败');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!supabase || !detail) return;
    setShowWithdrawConfirm(false);
    try {
      await withdrawV2Task(supabase, detail.task.id);
      await load();
      setMessage('任务已撤回。');
      window.dispatchEvent(new Event('storehub:todos-changed'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤回任务失败');
    }
  };

  const isAdmin = auth.profile?.role === 'admin';
  return <PageShell eyebrow={`门店运营系统 · ${isAdmin ? '管理员' : '店长'}审核`} title={detail?.task.name ?? '任务'} backTo={isAdmin ? '/app/admin/tasks' : '/app/todos'} contentGapClassName="gap-3">
    {detail ? <>
      <section className="ui-card p-4">
        <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-700">{detail.task.task_no}</p><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${v2TaskStatusClass[detail.task.status]}`}>{v2TaskStatusLabel[detail.task.status]}</span></div>
        <p className="mt-2 text-sm text-slate-500">截止 {new Date(detail.task.due_at).toLocaleString('zh-CN')}{detail.submitterName ? ` · 提交人：${detail.submitterName}` : ''}</p>
        {detail.task.status === 'resubmitted' ? <FeedbackBanner className="mt-3" title="整改内容已重新提交" tone="info">本轮只需复审标有“重新提交”的项目，其他项目保留原审核结果。</FeedbackBanner> : null}
        {detail.task.manager_review_enabled ? <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-xs leading-5 text-brand-800">员工提交可由本门店店长或管理员审核；店长提交仍只允许管理员审核。</p> : null}
        {!isReviewable && ['submitted', 'resubmitted'].includes(detail.task.status) ? <FeedbackBanner className="mt-3" title="等待管理员审核" tone="info">该任务由店长提交，或发布时未开放店长审核，当前账号只能查看。</FeedbackBanner> : null}
        {isAdmin && !['approved', 'cancelled'].includes(detail.task.status) ? <button className="ui-button-secondary mt-3 border-red-200 text-red-700 hover:bg-red-50" onClick={() => setShowWithdrawConfirm(true)} type="button">撤回任务</button> : null}
      </section>

      <div className="space-y-3">{detail.answers.map((answer, index) => {
        const item = asTaskItemSnapshot(answer.item_snapshot);
        const images = detail.images.filter((image) => image.item_id === answer.item_id);
        const position = answerPositions[answer.item_id] ?? { groupNumber: 1, groupTitle: '任务项目', itemNumber: index + 1, number: `${index + 1}` };
        const previous = index > 0 ? answerPositions[detail.answers[index - 1].item_id] : null;
        const showGroup = index === 0 || previous?.groupNumber !== position.groupNumber;
        const canReview = isReviewable && answer.review_status === reviewableStatus;
        const decision = decisions[answer.item_id];
        return <div key={answer.id}>
          {showGroup ? <div className="mb-2 flex items-center gap-2 px-1"><span className="rounded-md bg-brand-600 px-2 py-1 text-xs font-bold text-white">分组 {position.groupNumber}</span><h2 className="font-bold text-slate-800">{position.groupTitle}</h2></div> : null}
          <article className={`ui-card block p-4 ${canReview ? 'cursor-pointer select-none' : ''} ${selectedIds.includes(answer.item_id) ? 'ring-2 ring-brand-500 ring-offset-1' : ''} ${decision === 'rejected' || answer.review_status === 'rejected' ? 'border-red-300 bg-red-50/20' : decision === 'approved' || answer.review_status === 'approved' ? 'border-emerald-200 bg-emerald-50/20' : answer.review_status === 'resubmitted' ? 'border-amber-300 bg-amber-50/30' : ''}`} onClick={(event) => {
            if (!canReview || (event.target as HTMLElement).closest('button, input, textarea, select, a, [role="button"]')) return;
            toggleSelected(answer.item_id);
          }}>
            <div className="flex gap-3">
              {canReview ? <input aria-label={`选择审核项目：${position.number} ${item.label}`} checked={selectedIds.includes(answer.item_id)} className="mt-1 h-5 w-5" onChange={() => toggleSelected(answer.item_id)} type="checkbox" /> : <span className="mt-0.5 inline-flex h-6 min-w-10 items-center justify-center rounded-md bg-slate-100 px-1.5 text-xs font-bold text-slate-600">{position.number}</span>}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><b>{canReview ? `${position.number} ${item.label}` : item.label}</b><ReviewStatusBadge decision={decision} status={answer.review_status} /></div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{formatAnswer(answer.answer)}</p>
                <TaskReferenceImagePreview urls={referenceImageUrls[answer.item_id] ?? []} />
                <div className="mt-3"><TaskImagePreview imageUrls={imageUrls} images={images} /></div>
              </div>
            </div>
          </article>
        </div>;
      })}</div>

      {isReviewable ? <section className="ui-card space-y-3 p-4">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">逐项审核</h2><p className="mt-1 text-xs leading-5 text-slate-500">勾选需要整改的项目；未标记项目提交时自动通过</p></div><button className="shrink-0 text-sm font-bold text-brand-700" onClick={() => setSelectedIds(selectedIds.length === reviewableAnswers.length ? [] : reviewableAnswers.map((answer) => answer.item_id))} type="button">{selectedIds.length === reviewableAnswers.length ? '取消全选' : '全选待审项'}</button></div>
        <div className="grid grid-cols-2 gap-2"><button className="ui-button-secondary border-red-200 text-red-700" onClick={() => rejectSelectedItems(selectedIds)} type="button">所选项驳回</button><button className="ui-button-primary" onClick={approveAllItems} type="button">一键全部通过</button></div>
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">审核结果：通过 {approvedCount} 项，驳回 {rejectedCount} 项</div>
        <textarea className="ui-input min-h-24 py-3" onChange={(event) => setNote(event.target.value)} placeholder="审核意见；有驳回项目时请填写整改原因" value={note} />
        <p className="text-xs leading-5 text-slate-500">重新提交时，已通过项目仅供查看，不会重复审核；本轮未勾选驳回的项目会自动通过。</p>
        <MobileActionBar><button className="ui-button-primary w-full" disabled={busy} onClick={() => void submitReview()} type="button">{busy ? '正在提交审核…' : `提交审核结果（通过 ${approvedCount} 项，驳回 ${rejectedCount} 项）`}</button></MobileActionBar>
      </section> : null}
    </> : message ? <FeedbackBanner title="任务加载失败" tone="danger">{message}</FeedbackBanner> : <LoadingState label="正在加载任务" />}
    <ActionFeedbackDialog message={message ?? ''} onClose={() => setMessage(null)} open={Boolean(detail && message)} title={message?.includes('审核已提交') || message?.includes('任务已撤回') ? '操作成功' : message?.includes('失败') ? '操作失败' : '请完善审核信息'} tone={message?.includes('审核已提交') || message?.includes('任务已撤回') ? 'success' : message?.includes('失败') ? 'danger' : 'warning'} />
    <ConfirmDialog confirmLabel="确认撤回" danger onCancel={() => setShowWithdrawConfirm(false)} onConfirm={() => void withdraw()} open={showWithdrawConfirm} title="撤回任务"><p>撤回后，员工和店长将无法继续执行该任务。此操作会同步更新待办列表。</p></ConfirmDialog>
  </PageShell>;
}

function ReviewStatusBadge({ decision, status }: { decision?: ReviewDecision; status: V2TaskDetail['answers'][number]['review_status'] }) {
  if (decision === 'approved') return <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">本轮通过</span>;
  if (decision === 'rejected') return <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-700">本轮驳回</span>;
  if (status === 'resubmitted') return <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">重新提交 · 待复审</span>;
  if (status === 'approved') return <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">已通过 · 无需复审</span>;
  if (status === 'rejected') return <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-700">已驳回 · 待整改</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">待审核</span>;
}

const formatAnswer = (answer: unknown) => {
  if (answer === null || answer === undefined) return '尚未填写';
  if (typeof answer === 'string') return answer || '尚未填写';
  if (typeof answer === 'boolean') return answer ? '已确认' : '未确认';
  if (Array.isArray(answer)) return answer.join('、') || '尚未选择';
  return String(answer);
};
