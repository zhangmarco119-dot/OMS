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
    expect(result.template).toEqual({ category: 'inspection', name: '新任务' });
    expect(result.groups[0].id).toBe('group-1');
    expect(result.groups[0].items[0]).toMatchObject({ field_type: 'confirmation', guidance: '新项目说明', id: 'item-1', is_required: true });
  });

  it('requires task, group and item names', () => {
    const draft = taskContentFromSnapshot('', snapshot);
    expect(validateTaskContent(draft)).toBe('请填写任务名称。');
  });
});
