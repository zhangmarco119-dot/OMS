import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canReviewV2Task,
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
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'admin' } }) }));
vi.mock('../services/v2-tasks.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/v2-tasks.service')>();
  return {
    ...original,
    canReviewV2Task: vi.fn(),
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
    vi.mocked(canReviewV2Task).mockResolvedValue(true);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadV2TaskDetail).mockResolvedValue({ answers: [approvedAnswer, resubmittedAnswer], images: [], reviews: [], submitterName: '刘成跃', task } as V2TaskDetail);
    vi.mocked(loadV2TaskImageUrls).mockResolvedValue({});
    vi.mocked(loadV2TaskReferenceImageUrls).mockResolvedValue({});
    vi.mocked(reviewV2TaskItems).mockResolvedValue({});
  });

  it('treats every unmarked review item as approved', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/tasks/task-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route element={<AdminV2TaskReviewPage />} path="/app/admin/tasks/:taskId" /></Routes></MemoryRouter>);

    expect(await screen.findByText('重新提交 · 待复审')).toBeInTheDocument();
    expect(screen.getByText(/提交人：刘成跃/)).toBeInTheDocument();
    expect(screen.getByText('已通过 · 无需复审')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /门头清洁/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '所选通过' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '一键全部驳回' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /提交审核结果/ }));

    await waitFor(() => expect(reviewV2TaskItems).toHaveBeenCalledWith({}, 'task-1', [
      { decision: 'approved', itemId: resubmittedAnswer.item_id },
    ], ''));
  });

  it('opens a visible dialog when reject actions are missing a selection or reason', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/tasks/task-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route element={<AdminV2TaskReviewPage />} path="/app/admin/tasks/:taskId" /></Routes></MemoryRouter>);

    await screen.findByText('重新提交 · 待复审');
    fireEvent.click(screen.getByRole('button', { name: '所选项驳回' }));
    expect(screen.getByRole('dialog', { name: '请完善审核信息' })).toHaveTextContent('请先勾选需要审核的项目。');
    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));

    fireEvent.click(screen.getByText(/操作台清洁/));
    expect(screen.getByRole('checkbox', { name: /操作台清洁/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '所选项驳回' }));
    fireEvent.click(screen.getByRole('button', { name: /提交审核结果/ }));
    expect(screen.getByRole('dialog', { name: '请完善审核信息' })).toHaveTextContent('请填写具体的整改原因');
    expect(reviewV2TaskItems).not.toHaveBeenCalled();
  });

  it('rejects selected cards and automatically approves the remaining review items', async () => {
    const pendingAnswers = [
      { ...approvedAnswer, id: 'pending-1', item_id: '00000000-0000-4000-8000-000000000011', item_snapshot: { field_type: 'confirmation', id: '00000000-0000-4000-8000-000000000011', label: '门店卫生' }, review_status: 'pending' },
      { ...resubmittedAnswer, id: 'pending-2', item_id: '00000000-0000-4000-8000-000000000012', item_snapshot: { field_type: 'confirmation', id: '00000000-0000-4000-8000-000000000012', label: '库存复核' }, review_status: 'pending' },
    ] as unknown as V2TaskAnswerRow[];
    vi.mocked(loadV2TaskDetail).mockResolvedValue({
      answers: pendingAnswers,
      images: [],
      reviews: [],
      task: { ...task, snapshot: { groups: [{ id: 'group-1', sort_order: 0, title: '检查项目', items: pendingAnswers.map((answer, index) => ({ id: answer.item_id, sort_order: index })) }] }, status: 'submitted' },
    } as V2TaskDetail);

    render(<MemoryRouter initialEntries={['/app/admin/tasks/task-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route element={<AdminV2TaskReviewPage />} path="/app/admin/tasks/:taskId" /></Routes></MemoryRouter>);

    fireEvent.click(await screen.findByText(/库存复核/));
    fireEvent.click(screen.getByRole('button', { name: '所选项驳回' }));
    fireEvent.change(screen.getByPlaceholderText(/有驳回项目时请填写整改原因/), { target: { value: '库存数据不一致，请重新核对。' } });
    fireEvent.click(screen.getByRole('button', { name: /提交审核结果/ }));

    await waitFor(() => expect(reviewV2TaskItems).toHaveBeenCalledWith({}, 'task-1', [
      { decision: 'approved', itemId: pendingAnswers[0].item_id },
      { decision: 'rejected', itemId: pendingAnswers[1].item_id },
    ], '库存数据不一致，请重新核对。'));
  });

  it('allows an optional reason for each rejected product specification', async () => {
    const productAnswer = {
      ...resubmittedAnswer,
      answer: { count_unit: '袋', spec: '15g/袋×20袋/包' },
      item_id: '00000000-0000-4000-8000-000000000021',
      item_snapshot: {
        answer_schema: 'product_spec',
        field_type: 'short_text',
        id: '00000000-0000-4000-8000-000000000021',
        label: '银耳',
        product_id: '00000000-0000-4000-8000-000000000031',
      },
      review_status: 'pending',
    } as unknown as V2TaskAnswerRow;
    vi.mocked(loadV2TaskDetail).mockResolvedValue({
      answers: [productAnswer],
      images: [],
      reviews: [],
      task: {
        ...task,
        snapshot: { groups: [{ id: 'group-1', items: [{ id: productAnswer.item_id }], sort_order: 0, title: '待补全货品' }], workflow_type: 'product_spec_correction' },
        status: 'submitted',
      },
    } as V2TaskDetail);

    render(<MemoryRouter initialEntries={['/app/admin/tasks/task-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route element={<AdminV2TaskReviewPage />} path="/app/admin/tasks/:taskId" /></Routes></MemoryRouter>);

    expect(await screen.findByText(/规格：15g\/袋×20袋\/包/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/银耳/));
    fireEvent.click(screen.getByRole('button', { name: '所选项驳回' }));
    expect(screen.getByRole('textbox', { name: '驳回原因：银耳（选填）' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /提交审核结果/ }));

    await waitFor(() => expect(reviewV2TaskItems).toHaveBeenCalledWith({}, 'task-1', [
      { decision: 'rejected', itemId: productAnswer.item_id, note: undefined },
    ], ''));
  });
});
