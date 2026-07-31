import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminV2TaskPublishPage, AdminV2TasksPage } from './AdminV2TasksPage';

const mocks = vi.hoisted(() => ({
  loadCategories: vi.fn(),
  loadRecipients: vi.fn(),
  loadSchedules: vi.fn(),
  loadTasks: vi.fn(),
  loadTemplates: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../features/auth/AuthContext', () => ({
  useAuth: () => ({ availableStores: [{ id: 'store-1', name: '测试门店' }, { id: 'store-2', name: '第二门店' }] }),
}));
vi.mock('../services/task-templates.service', () => ({ loadTaskCategories: mocks.loadCategories, loadTaskTemplates: mocks.loadTemplates }));
vi.mock('../services/v2-tasks.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/v2-tasks.service')>();
  return { ...original, loadV2TaskRecipients: mocks.loadRecipients, loadV2TaskSchedules: mocks.loadSchedules, loadV2Tasks: mocks.loadTasks };
});

describe('AdminV2TasksPage navigation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.loadTemplates.mockResolvedValue([]);
    mocks.loadCategories.mockResolvedValue([]);
    mocks.loadTasks.mockResolvedValue([]);
    mocks.loadSchedules.mockResolvedValue([]);
    mocks.loadRecipients.mockResolvedValue([]);
  });

  it('keeps template management and task publishing as independent entry buttons', async () => {
    render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: '管理任务模板' })).toHaveAttribute('href', '/app/admin/task-templates');
    expect(screen.getByRole('link', { name: '任务发布' })).toHaveAttribute('href', '/app/admin/tasks/publish');
    expect(screen.queryByRole('heading', { name: '发布任务' })).not.toBeInTheDocument();
  });

  it('shows the publishing form only on the dedicated task publishing page', async () => {
    render(<MemoryRouter><AdminV2TaskPublishPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: '发布任务' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '管理任务模板' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '员工' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '店长' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '兼职' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /允许店长审核员工提交/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: '立即发布' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '定时发布' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: '定时发布' }));
    expect(screen.getByLabelText('定时发布时间')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('发布方式'), { target: { value: 'recurring' } });
    expect(screen.getByLabelText('首次 / 下次发布时间')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '创建周期任务时立即发布一次' })).not.toBeChecked();
  });

  it('separates completed tasks and provides time, store, category, and search filters', async () => {
    const finishedAt = new Date();
    finishedAt.setHours(10, 0, 0, 0);
    mocks.loadCategories.mockResolvedValue([{ code: 'closing', label: '打烊任务' }]);
    mocks.loadTasks.mockResolvedValue([
      {
        assigned_profile_id: null,
        category: 'closing',
        due_at: finishedAt.toISOString(),
        id: 'completed-task',
        name: '每日打烊',
        reviewed_at: finishedAt.toISOString(),
        schedule_id: null,
        status: 'approved',
        store_id: 'store-1',
        submitted_at: finishedAt.toISOString(),
        task_no: 'TASK-001',
        updated_at: finishedAt.toISOString(),
      },
      {
        assigned_profile_id: null,
        category: 'closing',
        due_at: finishedAt.toISOString(),
        id: 'active-task',
        name: '仍在进行',
        reviewed_at: null,
        schedule_id: null,
        status: 'pending',
        store_id: 'store-1',
        submitted_at: null,
        task_no: 'TASK-002',
        updated_at: finishedAt.toISOString(),
      },
    ]);

    render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);

    expect(await screen.findByRole('tab', { name: '进行中任务 1' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: '已完成任务 1' }));

    expect(screen.getByRole('heading', { name: '已完成任务' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /每日打烊/ })).toHaveAttribute('href', '/app/admin/tasks/completed-task');
    expect(screen.queryByText('仍在进行')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '选择某日' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '选择某月' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '选择时间区间' })).toBeInTheDocument();
    expect(screen.getByLabelText('门店')).toHaveValue('');
    expect(screen.getByLabelText('任务分类')).toHaveValue('');
    expect(screen.getByRole('option', { name: '打烊任务' })).toBeInTheDocument();
    expect(screen.getByLabelText('搜索任务')).toBeInTheDocument();
  });

  it('shows the exact planned time for a single task waiting for scheduled publication', async () => {
    mocks.loadTasks.mockResolvedValue([{
      assigned_profile_id: null,
      category: 'closing',
      due_at: '2026-08-01T14:00:00.000Z',
      id: 'scheduled-task',
      name: '定时打烊检查',
      publish_at: '2026-08-01T10:30:00.000Z',
      publish_notified_at: null,
      reviewed_at: null,
      schedule_id: null,
      status: 'pending',
      store_id: 'store-1',
      submitted_at: null,
      task_no: 'TASK-SCHEDULED',
      updated_at: '2026-07-31T10:00:00.000Z',
    }]);

    render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);

    expect(await screen.findByText('待定时发布')).toBeInTheDocument();
    expect(screen.getByText(/定时发布 2026\/8\/1 18:30:00/)).toBeInTheDocument();
  });

  it('keeps the completed-task view and filters when the task list is opened again', async () => {
    const finishedAt = new Date();
    mocks.loadTasks.mockResolvedValue([{
      assigned_profile_id: null,
      category: 'closing',
      due_at: finishedAt.toISOString(),
      id: 'completed-task',
      name: '每日打烊',
      reviewed_at: finishedAt.toISOString(),
      schedule_id: null,
      status: 'approved',
      store_id: 'store-1',
      submitted_at: finishedAt.toISOString(),
      task_no: 'TASK-001',
      updated_at: finishedAt.toISOString(),
    }]);

    const first = render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: '已完成任务 1' }));
    fireEvent.change(screen.getByLabelText('门店'), { target: { value: 'store-1' } });
    first.unmount();

    render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);
    expect(await screen.findByRole('tab', { name: '已完成任务 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('门店')).toHaveValue('store-1');
  });
});
