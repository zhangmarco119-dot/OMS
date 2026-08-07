import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import {
  loadV2TaskDetail,
  loadV2TaskImageUrls,
  loadV2TaskReferenceImageUrls,
  saveV2TaskProgress,
  submitV2TaskWithAnswers,
  type V2TaskAnswerRow,
  type V2TaskDetail,
  type V2TaskRow,
} from '../services/v2-tasks.service';
import { V2TaskExecutionPage } from './V2TaskExecutionPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/v2-tasks.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/v2-tasks.service')>();
  return {
    ...original,
    loadV2TaskDetail: vi.fn(),
    loadV2TaskImageUrls: vi.fn(),
    loadV2TaskReferenceImageUrls: vi.fn(),
    saveV2TaskProgress: vi.fn(),
    submitV2TaskWithAnswers: vi.fn(),
  };
});

const task = {
  correction_item_ids: [],
  due_at: '2026-07-20T12:00:00Z',
  id: 'task-1',
  name: '闭店检查',
  status: 'pending',
  version: 1,
} as unknown as V2TaskRow;

const requiredConfirmation = {
  answer: false,
  id: 'answer-1',
  item_id: 'item-1',
  item_snapshot: {
    field_type: 'confirmation',
    id: 'item-1',
    image_requirement: 'none',
    is_required: true,
    label: '确认关闭电源',
  },
} as unknown as V2TaskAnswerRow;

describe('V2TaskExecutionPage required submission state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ profile: { id: 'profile-1' } } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadV2TaskDetail).mockResolvedValue({ answers: [requiredConfirmation], images: [], reviews: [], task } as V2TaskDetail);
    vi.mocked(loadV2TaskImageUrls).mockResolvedValue({});
    vi.mocked(loadV2TaskReferenceImageUrls).mockResolvedValue({});
    vi.mocked(saveV2TaskProgress).mockResolvedValue(task);
    vi.mocked(submitV2TaskWithAnswers).mockResolvedValue({ ...task, status: 'submitted', version: 2 });
  });

  it('shows a gray clickable submit button and a Chinese reminder until required work is complete', async () => {
    render(
      <MemoryRouter initialEntries={['/app/tasks/task-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes><Route element={<V2TaskExecutionPage />} path="/app/tasks/:taskId" /></Routes>
      </MemoryRouter>,
    );

    const submit = await screen.findByRole('button', { name: '提交检查' });
    expect(submit).toHaveClass('bg-slate-300');
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    expect(await screen.findByRole('dialog', { name: '必填项目未完成' })).toBeInTheDocument();
    expect(screen.getByText('确认关闭电源')).toBeInTheDocument();
    expect(screen.getByText('请完成填写或确认')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));

    fireEvent.click(screen.getByRole('checkbox', { name: '确认完成' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '提交检查' })).toHaveClass('bg-brand-600'));
  });

  it('shows the configured minimum image count on the matching task item', async () => {
    const imageAnswer = {
      ...requiredConfirmation,
      item_id: 'freezer-item',
      item_snapshot: {
        field_type: 'multi_image',
        id: 'freezer-item',
        image_requirement: 'multiple',
        is_required: true,
        label: '大冰箱',
        minimum_image_count: 8,
      },
    } as unknown as V2TaskAnswerRow;
    vi.mocked(loadV2TaskDetail).mockResolvedValue({ answers: [imageAnswer], images: [], reviews: [], task } as V2TaskDetail);

    render(
      <MemoryRouter initialEntries={['/app/tasks/task-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes><Route element={<V2TaskExecutionPage />} path="/app/tasks/:taskId" /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('图片要求：至少上传 8 张')).toBeInTheDocument();
    expect(screen.getByText('已完成 0/8')).toBeInTheDocument();
  });

  it('shows a direct link to the SOP associated with the task', async () => {
    vi.mocked(loadV2TaskDetail).mockResolvedValue({
      answers: [requiredConfirmation],
      images: [],
      reviews: [],
      task: {
        ...task,
        related_content_title: '新品酸奶碗制作',
        related_notice_id: null,
        related_sop_id: 'sop-1',
      },
    } as V2TaskDetail);

    render(
      <MemoryRouter initialEntries={['/app/tasks/task-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes><Route element={<V2TaskExecutionPage />} path="/app/tasks/:taskId" /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: /新品酸奶碗制作/ })).toHaveAttribute('href', '/app/sops/sop-1');
  });

  it('collects product specification and count unit as one reviewable product answer', async () => {
    const productAnswer = {
      ...requiredConfirmation,
      answer: { count_unit: '盒', spec: '' },
      item_id: 'product-item',
      item_snapshot: {
        answer_schema: 'product_spec',
        current_count_unit: '盒',
        current_spec: '请填写！',
        field_type: 'short_text',
        id: 'product-item',
        is_required: true,
        label: '银耳',
        product_id: 'product-1',
      },
    } as unknown as V2TaskAnswerRow;
    vi.mocked(loadV2TaskDetail).mockResolvedValue({ answers: [productAnswer], images: [], reviews: [], task } as V2TaskDetail);

    render(
      <MemoryRouter initialEntries={['/app/tasks/task-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes><Route element={<V2TaskExecutionPage />} path="/app/tasks/:taskId" /></Routes>
      </MemoryRouter>,
    );

    const specInput = await screen.findByRole('textbox', { name: '银耳正确规格' });
    expect(screen.getByRole('textbox', { name: '银耳点货单位' })).toHaveValue('盒');
    expect(screen.getByRole('button', { name: '提交检查' })).toHaveClass('bg-slate-300');
    fireEvent.change(specInput, { target: { value: '15g/袋×20袋/包' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '提交检查' })).toHaveClass('bg-brand-600'));
  });

  it('does not ask for images when a product correction item omits image requirements', async () => {
    const productAnswer = {
      ...requiredConfirmation,
      answer: { category_code: 'fruit', count_unit: '箱', name: '牛油果', spec: '12个/箱' },
      item_id: 'product-correction-item',
      item_snapshot: {
        answer_schema: 'product_correction',
        field_type: 'short_text',
        id: 'product-correction-item',
        is_required: true,
        label: '牛油果',
        product_action: 'create',
      },
    } as unknown as V2TaskAnswerRow;
    vi.mocked(loadV2TaskDetail).mockResolvedValue({ answers: [productAnswer], images: [], reviews: [], task } as V2TaskDetail);

    render(
      <MemoryRouter initialEntries={['/app/tasks/task-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes><Route element={<V2TaskExecutionPage />} path="/app/tasks/:taskId" /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('textbox', { name: '牛油果正确名称' })).toBeInTheDocument();
    expect(screen.queryByText(/图片要求/)).not.toBeInTheDocument();
    expect(screen.queryByText('上传图片')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交检查' })).toHaveClass('bg-brand-600');
  });

  it('atomically saves and resubmits a rejected task for review', async () => {
    const rejectedTask = {
      ...task,
      correction_item_ids: ['item-1'],
      status: 'rejected',
      version: 4,
    } as V2TaskRow;
    const correctedAnswer = { ...requiredConfirmation, answer: true, review_status: 'rejected' } as V2TaskAnswerRow;
    vi.mocked(loadV2TaskDetail).mockResolvedValue({ answers: [correctedAnswer], images: [], reviews: [], task: rejectedTask } as V2TaskDetail);
    vi.mocked(submitV2TaskWithAnswers).mockResolvedValue({ ...rejectedTask, status: 'resubmitted', version: 6 });

    render(
      <MemoryRouter initialEntries={['/app/tasks/task-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes><Route element={<V2TaskExecutionPage />} path="/app/tasks/:taskId" /></Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '重新提交审核' }));
    await waitFor(() => expect(submitV2TaskWithAnswers).toHaveBeenCalledWith(expect.anything(), 'task-1', 4, expect.arrayContaining([expect.objectContaining({ item_id: 'item-1' })])));
    expect(await screen.findByText('整改任务已重新提交，等待审核')).toBeInTheDocument();
  });
});
