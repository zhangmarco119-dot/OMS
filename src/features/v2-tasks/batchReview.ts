import type { SupabaseClient } from '@supabase/supabase-js';

import {
  canReviewV2Task,
  loadSubmittedLinkedInventoryTask,
  loadV2TaskDetail,
  reviewV2TaskItems,
  reviewV2TaskItemsWithInventory,
} from '../../services/v2-tasks.service';
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
  onProgress?: (completed: number) => void,
): Promise<BatchReviewResult> {
  const result: BatchReviewResult = { failed: [], succeeded: [] };
  const reviewNote = note.trim();
  if (decision === 'rejected' && !reviewNote) throw new Error('批量拒绝时请填写整改原因。');

  for (const target of targets) {
    try {
      const detail = await loadV2TaskDetail(client, target.id);
      if (!['submitted', 'resubmitted'].includes(detail.task.status) || !await canReviewV2Task(client, target.id)) {
        throw new Error('任务已处理或当前账号没有审核权限。');
      }
      const expectedStatus = detail.task.status === 'resubmitted' ? 'resubmitted' : 'pending';
      const decisions = detail.answers
        .filter((answer) => answer.review_status === expectedStatus)
        .map((answer) => ({ decision, itemId: answer.item_id, note: decision === 'rejected' ? reviewNote : '' }));

      if (detail.task.requires_inventory) {
        const inventory = await loadSubmittedLinkedInventoryTask(client, target.id, detail.task.inventory_correction_task_id);
        if (!inventory) throw new Error('关联点货单尚未提交，暂时不能完成审核。');
        await reviewV2TaskItemsWithInventory(
          client, target.id, decisions, reviewNote, inventory.id,
          decision === 'rejected' ? inventory.items.map((item) => item.id) : [],
        );
      } else {
        if (decisions.length === 0) throw new Error('任务没有待审核的项目。');
        await reviewV2TaskItems(client, target.id, decisions, reviewNote);
      }
      result.succeeded.push(target);
    } catch (error) {
      result.failed.push({ ...target, reason: error instanceof Error ? error.message : '审核失败，请稍后重试。' });
    }
    onProgress?.(result.succeeded.length + result.failed.length);
  }
  return result;
}
