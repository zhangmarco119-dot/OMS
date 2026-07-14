import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadV2TaskDetail,
  loadV2TaskImageUrls,
  loadV2TaskReferenceImageUrls,
  reviewV2TaskItems,
  type V2TaskAnswerRow,
  type V2TaskDetail,
  type V2TaskRow,
} from '../services/v2-tasks.service';
import { AdminV2TaskReviewPage } from './AdminV2TaskReviewPage';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/v2-tasks.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/v2-tasks.service')>();
  return {
    ...original,
    loadV2TaskDetail: vi.fn(),
    loadV2TaskImageUrls: vi.fn(),
    loadV2TaskReferenceImageUrls: vi.fn(),
    reviewV2TaskItems: vi.fn(),
  };
});

const approvedAnswer = {
  answer: true,
  id: 'answer-1',
  item_id: '00000000-0000-4000-8000-000000000001',
  item_snapshot: { field_type: 'confirmation', id: '00000000-0000-4000-8000-000000000001', label: '门头清洁' },
  review_status: 'approved',
  submission_round: 1,
} as unknown as V2TaskAnswerRow;
const resubmittedAnswer = {
  answer: true,
  id: 'answer-2',
  item_id: '00000000-0000-4000-8000-000000000002',
  item_snapshot: { field_type: 'confirmation', id: '00000000-0000-4000-8000-000000000002', label: '操作台清洁' },
  review_status: 'resubmitted',
  submission_round: 2,
} as unknown as V2TaskAnswerRow;
const task = {
  correction_item_ids: [resubmittedAnswer.item_id],
  due_at: '2026-07-20T12:00:00Z',
  id: 'task-1',
  name: '闭店检查',
  snapshot: {
    groups: [{ id: 'group-1', sort_order: 0, title: '清洁检查', items: [
      { id: approvedAnswer.item_id, sort_order: 0 },
      { id: resubmittedAnswer.item_id, sort_order: 1 },
    ] }],
  },
  status: 'resubmitted',
  task_no: 'TSK-1',
} as unknown as V2TaskRow;

describe('AdminV2TaskReviewPage focused re-review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadV2TaskDetail).mockResolvedValue({ answers: [approvedAnswer, resubmittedAnswer], images: [], reviews: [], task } as V2TaskDetail);
    vi.mocked(loadV2TaskImageUrls).mockResolvedValue({});
    vi.mocked(loadV2TaskReferenceImageUrls).mockResolvedValue({});
    vi.mocked(reviewV2TaskItems).mockResolvedValue({});
  });

  it('marks the resubmitted item and only sends that item for re-review', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/tasks/task-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route element={<AdminV2TaskReviewPage />} path="/app/admin/tasks/:taskId" /></Routes></MemoryRouter>);

    expect(await screen.findByText('重新提交 · 待复审')).toBeInTheDocument();
    expect(screen.getByText('已通过 · 无需复审')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /门头清洁/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /操作台清洁/ }));
    fireEvent.click(screen.getByRole('button', { name: '所选通过' }));
    fireEvent.click(screen.getByRole('button', { name: /提交审核结果/ }));

    await waitFor(() => expect(reviewV2TaskItems).toHaveBeenCalledWith({}, 'task-1', [
      { decision: 'approved', itemId: resubmittedAnswer.item_id },
    ], ''));
  });
});
