import { describe, expect, it } from 'vitest';

import { createEmptyTaskTemplate, validateTaskTemplateDraft } from './templateForm';

const storeId = '00000000-0000-4000-8000-000000000001';

describe('task template form', () => {
  it('validates a grouped weekly-clean template', () => {
    const draft = createEmptyTaskTemplate([storeId]);
    draft.name = '每周闭店清洁';
    draft.groups[0].title = '操作间';
    draft.groups[0].items[0].label = '确认操作台已消毒';
    expect(validateTaskTemplateDraft(draft).category).toBe('weekly_clean');
  });

  it('requires stores, groups, item labels and choice options', () => {
    const draft = createEmptyTaskTemplate([]);
    draft.name = '巡店检查';
    draft.groups[0].title = '门店形象';
    draft.groups[0].items[0].label = '卫生评级';
    expect(() => validateTaskTemplateDraft(draft)).toThrow('至少选择一个适用门店');
    draft.storeIds = [storeId];
    draft.groups[0].items[0].fieldType = 'single_choice';
    expect(() => validateTaskTemplateDraft(draft)).toThrow('选择题至少需要一个选项');
    draft.groups[0].items[0].optionsText = '优秀\n需整改';
    expect(validateTaskTemplateDraft(draft).groups[0].items[0].optionsText).toContain('优秀');
  });

  it('validates the minimum count for multiple-image items', () => {
    const draft = createEmptyTaskTemplate([storeId]);
    draft.name = '打烊检查';
    draft.groups[0].title = '冰箱';
    draft.groups[0].items[0].label = '大冰箱';
    draft.groups[0].items[0].imageRequirement = 'multiple';
    draft.groups[0].items[0].minimumImageCount = 8;
    expect(validateTaskTemplateDraft(draft).groups[0].items[0].minimumImageCount).toBe(8);
  });
});
