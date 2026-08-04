import { describe, expect, it } from 'vitest';

import { formatV2TaskDueAt, getV2TaskDisplayStatus, isV2TaskOverdue } from './taskPresentation';

describe('task deadline presentation', () => {
  const dueAt = '2026-08-04T14:00:00.000Z';

  it('marks an unsubmitted task overdue as soon as its deadline is reached', () => {
    expect(isV2TaskOverdue({ due_at: dueAt, status: 'pending' }, Date.parse(dueAt))).toBe(true);
    expect(getV2TaskDisplayStatus({ due_at: dueAt, status: 'in_progress' }, Date.parse(dueAt) + 1)).toBe('overdue');
  });

  it('does not mark an already submitted task overdue', () => {
    expect(isV2TaskOverdue({ due_at: dueAt, status: 'submitted' }, Date.parse(dueAt) + 60_000)).toBe(false);
    expect(getV2TaskDisplayStatus({ due_at: dueAt, status: 'approved' }, Date.parse(dueAt) + 60_000)).toBe('approved');
  });

  it('formats the deadline as an explicit Chinese date and time', () => {
    expect(formatV2TaskDueAt(dueAt)).toMatch(/2026/);
    expect(formatV2TaskDueAt(dueAt)).toMatch(/22:00/);
  });
});
