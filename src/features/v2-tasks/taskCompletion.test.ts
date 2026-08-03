import { describe, expect, it } from 'vitest';

import type { V2TaskAnswerRow } from '../../services/v2-tasks.service';
import { getTaskSubmissionIssues } from './taskCompletion';

const answer = (input: { answer: V2TaskAnswerRow['answer']; answerSchema?: 'product_correction' | 'product_spec'; fieldType: string; imageRequirement?: string; isRequired?: boolean; itemId: string; label: string; minimumImageCount?: number }) => ({
  answer: input.answer,
  item_id: input.itemId,
  item_snapshot: {
    field_type: input.fieldType,
    answer_schema: input.answerSchema,
    id: input.itemId,
    image_requirement: input.imageRequirement ?? 'none',
    is_required: input.isRequired ?? true,
    label: input.label,
    minimum_image_count: input.minimumImageCount,
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
      { itemId: 'photo', label: '拍照确认', reason: '请至少上传 1 张图片（当前 0 张）' },
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
      { itemId: 'combined', label: '整改说明', reason: '请完成填写或确认，并至少上传 1 张图片（当前 0 张）' },
    ]);
  });

  it('enforces the configured minimum image count immediately', () => {
    const input = [answer({ answer: null, fieldType: 'multi_image', imageRequirement: 'multiple', itemId: 'freezer', label: '大冰箱', minimumImageCount: 8 })];
    expect(getTaskSubmissionIssues(input, ['freezer', 'freezer', 'freezer'])).toEqual([
      { itemId: 'freezer', label: '大冰箱', reason: '请至少上传 8 张图片（当前 3 张）' },
    ]);
    expect(getTaskSubmissionIssues(input, Array(8).fill('freezer'))).toEqual([]);
  });

  it('requires all four editable product correction fields', () => {
    const incomplete = answer({ answer: { category_code: 'fruit', count_unit: '箱', name: '牛油果', spec: '' }, answerSchema: 'product_correction', fieldType: 'short_text', itemId: 'product', label: '牛油果' });
    const complete = answer({ answer: { category_code: 'fruit', count_unit: '箱', name: '牛油果', spec: '12个/箱' }, answerSchema: 'product_correction', fieldType: 'short_text', itemId: 'product', label: '牛油果' });
    expect(getTaskSubmissionIssues([incomplete], [])).toHaveLength(1);
    expect(getTaskSubmissionIssues([complete], [])).toEqual([]);
  });
});
