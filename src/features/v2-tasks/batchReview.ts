import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../types/database';

type Client = SupabaseClient<Database>;
export type BatchTaskDecision = 'approved' | 'rejected';
export interface BatchReviewTarget { id: string; name: string }
export interface BatchReviewFailure extends BatchReviewTarget { reason: string }
export interface BatchReviewResult { failed: BatchReviewFailure[]; succeeded: BatchReviewTarget[] }

export async function reviewV2TasksBatch(
  client: Client,
  targets: BatchReviewTarget[],
  decision: BatchTaskDecision,
  note: string,
): Promise<BatchReviewResult> {
  const reviewNote = note.trim();
  if (decision === 'rejected' && !reviewNote) throw new Error('批量拒绝时请填写整改原因。');

  const uniqueTargets = [...new Map(targets.map((target) => [target.id, target])).values()];
  if (!uniqueTargets.length) return { failed: [], succeeded: [] };
  const { data, error } = await client.rpc('review_v2_tasks_batch', {
    p_task_ids: uniqueTargets.map(({ id }) => id), p_action: decision, p_note: reviewNote,
  });
  if (error) throw new Error(error.message || '批量审核失败，请刷新待办确认结果。');
  // An interrupted response must never be presented as a successful approval.
  const rows = Array.isArray(data) ? data as { id?: string; success?: boolean; reason?: string }[] : [];
  const result: BatchReviewResult = { failed: [], succeeded: [] };
  for (const target of uniqueTargets) {
    const row = rows.find((item) => item.id === target.id);
    if (row?.success === true) result.succeeded.push(target);
    else result.failed.push({ ...target, reason: row?.reason || '未收到审批结果，请刷新待办确认。' });
  }
  return result;
}
