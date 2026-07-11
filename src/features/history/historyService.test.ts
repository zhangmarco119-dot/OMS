import { describe, expect, it } from 'vitest';

import { filterUnreadSubmittedTasks, type HistoryTask } from './historyService';

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
