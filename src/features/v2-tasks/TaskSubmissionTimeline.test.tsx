import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TaskSubmissionTimeline } from './TaskSubmissionTimeline';

describe('TaskSubmissionTimeline', () => {
  it('shows labeled submission, rejection, and resubmission events', () => {
    render(<TaskSubmissionTimeline events={[
      { action: 'submitted', created_at: '2020-08-01T10:00:00.000Z', id: 'review-1', task_id: 'task-1' },
      { action: 'rejected', created_at: '2020-08-01T11:00:00.000Z', id: 'review-2', task_id: 'task-1' },
      { action: 'resubmitted', created_at: '2020-08-01T12:00:00.000Z', id: 'review-3', task_id: 'task-1' },
    ]} fallbackSubmittedAt={null} />);

    expect(screen.getByText('提交与整改时间')).toBeInTheDocument();
    expect(screen.getByText('首次提交')).toHaveClass('bg-blue-50');
    expect(screen.getByText('驳回')).toHaveClass('bg-red-50');
    expect(screen.getByText('第 1 次重新提交')).toHaveClass('bg-violet-50');
    expect(screen.getByText('2020/8/1 18:00:00')).toBeInTheDocument();
    expect(screen.getByText('2020/8/1 19:00:00')).toBeInTheDocument();
    expect(screen.getByText('2020/8/1 20:00:00')).toBeInTheDocument();
  });
});
