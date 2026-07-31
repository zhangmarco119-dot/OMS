import { describe, expect, it } from 'vitest';

import type { TaskWithItems } from '../tasks/taskService';
import { filterUnreadSubmittedTasks, orderSubmittedInventoryItems, type HistoryTask } from './historyService';

const historyTask = (id: string) => ({ task: { id } } as HistoryTask);

describe('history notification filtering', () => {
  it('removes submissions already viewed by the current admin', () => {
    expect(filterUnreadSubmittedTasks(
      [historyTask('task-1'), historyTask('task-2'), historyTask('task-3')],
      ['task-1', 'task-3'],
    ).map((item) => item.task.id)).toEqual(['task-2']);
  });

  it('limits only after read submissions are removed', () => {
    expect(filterUnreadSubmittedTasks(
      [historyTask('task-1'), historyTask('task-2'), historyTask('task-3')],
      ['task-1'],
      1,
    ).map((item) => item.task.id)).toEqual(['task-2']);
  });
});

describe('submitted inventory item ordering', () => {
  const inventoryItem = (
    id: string,
    productActionStatus: TaskWithItems['items'][number]['product_action_status'] = null,
  ) => ({ id, product_action_status: productActionStatus } as TaskWithItems['items'][number]);

  it('keeps active and newly added products first, then moves confirmed deletions to the bottom', () => {
    const items = [
      inventoryItem('active-1'),
      inventoryItem('deleted-1', 'deletion_approved'),
      { ...inventoryItem('new-1'), is_extra_item: true },
      inventoryItem('active-2'),
      inventoryItem('deleted-2', 'deletion_approved'),
    ];

    expect(orderSubmittedInventoryItems(items).map((item) => item.id)).toEqual([
      'active-1',
      'new-1',
      'active-2',
      'deleted-1',
      'deleted-2',
    ]);
    expect(items.map((item) => item.id)).toEqual([
      'active-1',
      'deleted-1',
      'new-1',
      'active-2',
      'deleted-2',
    ]);
  });
});
