import { describe, expect, it } from 'vitest';

import { taskContentFromSnapshot, taskContentToSnapshot, validateTaskContent } from './taskContent';

const snapshot = {
  groups: [{ description: '旧分组说明', id: 'group-1', items: [{ field_type: 'confirmation', guidance: '旧项目说明', id: 'item-1', is_required: true, label: '旧项目' }], title: '旧分组' }],
  template: { category: 'inspection', name: '旧任务' },
};

describe('taskContent', () => {
  it('edits visible content while preserving ids and field settings', () => {
    const draft = taskContentFromSnapshot('旧任务', snapshot);
    draft.name = '新任务';
    draft.groups[0].title = '新分组';
    draft.groups[0].items[0].guidance = '新项目说明';
    const result = taskContentToSnapshot(draft) as typeof snapshot;
    expect(result.template).toEqual({ allow_overdue: false, category: 'inspection', description: '', name: '新任务', requires_review: true });
    expect(result.groups[0].id).toBe('group-1');
    expect(result.groups[0].items[0]).toMatchObject({ field_type: 'confirmation', guidance: '新项目说明', id: 'item-1', is_required: true });
  });

  it('requires task, group and item names', () => {
    const draft = taskContentFromSnapshot('', snapshot);
    expect(validateTaskContent(draft)).toBe('请填写任务名称。');
  });

  it('supports adding complete groups and field definitions to a live task', () => {
    const draft = taskContentFromSnapshot('旧任务', snapshot);
    draft.groups.push({
      description: '新增说明',
      id: 'f0523948-29db-42e7-bff4-df54cc3d0bed',
      items: [{
        fieldType: 'single_choice', guidance: '请选择', id: 'dca3505c-19fc-49f1-af70-b2c00b16f36d',
        imageRequirement: 'single', isRequired: true, label: '新项目', optionsText: '合格\n不合格', raw: {},
        referenceImagePaths: ['f0523948-29db-42e7-bff4-df54cc3d0bed/dca3505c-19fc-49f1-af70-b2c00b16f36d/image.jpg'], referenceImageUrls: ['blob:preview'],
      }],
      raw: {},
      title: '新增分组',
    });
    const result = taskContentToSnapshot(draft) as { groups: Array<{ items: Array<Record<string, unknown>> }> };
    expect(result.groups[1].items[0]).toMatchObject({ field_type: 'single_choice', image_requirement: 'single', options: ['合格', '不合格'], sort_order: 0 });
    expect(validateTaskContent(draft)).toBeNull();
  });
});
