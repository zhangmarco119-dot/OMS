import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import {
  loadV2TaskDetail,
  loadV2TaskImageUrls,
  loadV2TaskReferenceImageUrls,
  saveV2TaskProgress,
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
    submitV2Task: vi.fn(),
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
});
