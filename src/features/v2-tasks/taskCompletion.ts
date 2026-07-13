import type { V2TaskAnswerRow } from '../../services/v2-tasks.service';
import { asTaskItemSnapshot } from '../../services/v2-tasks.service';

export interface TaskSubmissionIssue {
  itemId: string;
  label: string;
  reason: string;
}

const answerIsMissing = (answer: V2TaskAnswerRow) => {
  const item = asTaskItemSnapshot(answer.item_snapshot);
  if (['instruction', 'image', 'multi_image'].includes(item.field_type)) return false;
  if (item.field_type === 'confirmation') return answer.answer !== true;
  if (item.field_type === 'multi_choice') return !Array.isArray(answer.answer) || answer.answer.length === 0;
  if (answer.answer === null || answer.answer === undefined) return true;
  if (typeof answer.answer === 'string') return answer.answer.trim().length === 0;
  return false;
};

export const getTaskSubmissionIssues = (answers: V2TaskAnswerRow[], imageItemIds: Iterable<string>): TaskSubmissionIssue[] => {
  const itemsWithImages = new Set(imageItemIds);
  return answers.flatMap((answer) => {
    const item = asTaskItemSnapshot(answer.item_snapshot);
    if (!item.is_required) return [];
    const missingAnswer = answerIsMissing(answer);
    const needsImage = ['image', 'multi_image'].includes(item.field_type)
      || ['single', 'multiple'].includes(item.image_requirement ?? 'none');
    const missingImage = needsImage && !itemsWithImages.has(answer.item_id);
    if (!missingAnswer && !missingImage) return [];
    const reason = missingAnswer && missingImage
      ? '请完成填写或确认，并上传至少一张图片'
      : missingImage ? '请上传至少一张图片' : '请完成填写或确认';
    return [{ itemId: answer.item_id, label: item.label, reason }];
  });
};
