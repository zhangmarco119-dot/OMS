import { describe, expect, it } from 'vitest';

import type { V2TaskAnswerRow } from '../../services/v2-tasks.service';
import { getTaskSubmissionIssues } from './taskCompletion';

const answer = (input: { answer: V2TaskAnswerRow['answer']; fieldType: string; imageRequirement?: string; isRequired?: boolean; itemId: string; label: string }) => ({
  answer: input.answer,
  item_id: input.itemId,
  item_snapshot: {
    field_type: input.fieldType,
    id: input.itemId,
    image_requirement: input.imageRequirement ?? 'none',
    is_required: input.isRequired ?? true,
    label: input.label,
  },
} as unknown as V2TaskAnswerRow);

describe('getTaskSubmissionIssues', () => {
  it('reports missing text, confirmation and image requirements in Chinese', () => {
    const issues = getTaskSubmissionIssues([
      answer({ answer: '  ', fieldType: 'short_text', itemId: 'text', label: '填写说明' }),
      answer({ answer: false, fieldType: 'confirmation', itemId: 'confirm', label: '确认完成' }),
      answer({ answer: true, fieldType: 'confirmation', imageRequirement: 'single', itemId: 'photo', label: '拍照确认' }),
    ], []);

    expect(issues).toEqual([
      { itemId: 'text', label: '填写说明', reason: '请完成填写或确认' },
      { itemId: 'confirm', label: '确认完成', reason: '请完成填写或确认' },
      { itemId: 'photo', label: '拍照确认', reason: '请上传至少一张图片' },
    ]);
  });

  it('accepts false boolean answers, completed choices and immediately available images', () => {
    const issues = getTaskSubmissionIssues([
      answer({ answer: false, fieldType: 'boolean', itemId: 'boolean', label: '是否异常' }),
      answer({ answer: ['合格'], fieldType: 'multi_choice', itemId: 'choice', label: '检查结果' }),
      answer({ answer: null, fieldType: 'image', itemId: 'photo', label: '现场照片' }),
      answer({ answer: null, fieldType: 'short_text', isRequired: false, itemId: 'optional', label: '选填备注' }),
    ], ['photo']);

    expect(issues).toEqual([]);
  });

  it('marks a required answer and photo as one combined issue', () => {
    expect(getTaskSubmissionIssues([
      answer({ answer: null, fieldType: 'short_text', imageRequirement: 'single', itemId: 'combined', label: '整改说明' }),
    ], [])).toEqual([
      { itemId: 'combined', label: '整改说明', reason: '请完成填写或确认，并上传至少一张图片' },
    ]);
  });
});
