import type { V2TaskAnswerRow } from '../../services/v2-tasks.service';
import { asTaskItemSnapshot } from '../../services/v2-tasks.service';

export interface TaskSubmissionIssue {
  itemId: string;
  label: string;
  reason: string;
}

const answerIsMissing = (answer: V2TaskAnswerRow) => {
  const item = asTaskItemSnapshot(answer.item_snapshot);
  if (item.answer_schema === 'product_spec') {
    if (!answer.answer || Array.isArray(answer.answer) || typeof answer.answer !== 'object') return true;
    const value = answer.answer as Record<string, unknown>;
    return typeof value.spec !== 'string' || value.spec.trim() === ''
      || typeof value.count_unit !== 'string' || value.count_unit.trim() === '';
  }
  if (['instruction', 'image', 'multi_image'].includes(item.field_type)) return false;
  if (item.field_type === 'confirmation') return answer.answer !== true;
  if (item.field_type === 'multi_choice') return !Array.isArray(answer.answer) || answer.answer.length === 0;
  if (answer.answer === null || answer.answer === undefined) return true;
  if (typeof answer.answer === 'string') return answer.answer.trim().length === 0;
  return false;
};

export const getTaskSubmissionIssues = (answers: V2TaskAnswerRow[], imageItemIds: Iterable<string>): TaskSubmissionIssue[] => {
  const imageCounts = new Map<string, number>();
  for (const itemId of imageItemIds) imageCounts.set(itemId, (imageCounts.get(itemId) ?? 0) + 1);
  return answers.flatMap((answer) => {
    const item = asTaskItemSnapshot(answer.item_snapshot);
    if (!item.is_required) return [];
    const missingAnswer = answerIsMissing(answer);
    const needsImage = ['image', 'multi_image'].includes(item.field_type)
      || ['single', 'multiple'].includes(item.image_requirement ?? 'none');
    const requiredImageCount = item.image_requirement === 'multiple'
      ? typeof item.minimum_image_count === 'number' ? Math.max(2, Math.min(20, item.minimum_image_count)) : 1
      : 1;
    const currentImageCount = imageCounts.get(answer.item_id) ?? 0;
    const missingImage = needsImage && currentImageCount < requiredImageCount;
    if (!missingAnswer && !missingImage) return [];
    const reason = missingAnswer && missingImage
      ? `请完成填写或确认，并至少上传 ${requiredImageCount} 张图片（当前 ${currentImageCount} 张）`
      : missingImage ? `请至少上传 ${requiredImageCount} 张图片（当前 ${currentImageCount} 张）` : '请完成填写或确认';
    return [{ itemId: answer.item_id, label: item.label, reason }];
  });
};
