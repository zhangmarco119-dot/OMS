import { render, screen } from '@testing-library/react';
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
  useAuth: () => ({ availableStores: [{ id: 'store-1', name: '测试门店' }] }),
}));
vi.mock('../services/task-templates.service', () => ({ loadTaskCategories: mocks.loadCategories, loadTaskTemplates: mocks.loadTemplates }));
vi.mock('../services/v2-tasks.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/v2-tasks.service')>();
  return { ...original, loadV2TaskRecipients: mocks.loadRecipients, loadV2TaskSchedules: mocks.loadSchedules, loadV2Tasks: mocks.loadTasks };
});

describe('AdminV2TasksPage navigation', () => {
  beforeEach(() => {
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
  });
});
