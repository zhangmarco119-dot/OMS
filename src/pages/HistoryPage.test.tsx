import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { loadSubmittedTasks, type HistoryTask } from '../features/history/historyService';
import { HistoryPage } from './HistoryPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../features/history/historyService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../features/history/historyService')>();
  return { ...original, loadSubmittedTasks: vi.fn() };
});
vi.mock('../lib/supabase', () => ({ supabase: {} }));

const submittedTask = {
  itemCount: 3,
  storeName: '测试门店',
  storeShortName: '测试店',
  submitterName: '测试员工',
  submitterUsername: 'tester',
  task: {
    created_by: 'profile-1',
    id: 'task-1',
    status: 'submitted',
    store_id: 'store-1',
    submitted_at: '2026-07-31T04:00:00Z',
    task_type: 'inventory',
  },
} as HistoryTask;

describe('HistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(useAuth).mockReturnValue({
      profile: { id: 'profile-1', role: 'staff', store_id: 'store-1' },
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadSubmittedTasks).mockResolvedValue([submittedTask]);
  });

  it('opens submitted inventory details as a standalone page', async () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><HistoryPage /></MemoryRouter>);

    const detailLink = await screen.findByRole('link', { name: '查看明细' });
    expect(detailLink).toHaveAttribute('href', '/app/history/task-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
