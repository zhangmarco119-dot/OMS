import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { useAiPilotSettings } from '../features/ai-review/useAiPilotSettings';
import { loadSubmittedTaskDetailView } from '../features/history/historyService';
import { ensureAiReview } from '../services/ai-review.service';
import { HistoryTaskDetailPage } from './HistoryTaskDetailPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../features/ai-review/useAiPilotSettings', () => ({ useAiPilotSettings: vi.fn() }));
vi.mock('../features/history/historyService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../features/history/historyService')>();
  return { ...original, loadSubmittedTaskDetailView: vi.fn() };
});
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/ai-review.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/ai-review.service')>();
  return { ...actual, ensureAiReview: vi.fn(), loadAiReview: vi.fn() };
});

describe('HistoryTaskDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ profile: { id: 'profile-1', role: 'staff' } } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useAiPilotSettings).mockReturnValue({ error: null, loading: false, reload: vi.fn(), settings: null });
    vi.mocked(loadSubmittedTaskDetailView).mockResolvedValue({
      detail: {
        items: [{
          id: 'item-1',
          is_extra_item: false,
          product_action_status: null,
          product_snapshot: { count_unit: '瓶', name: '测试货品', product_code: null, product_id: 'product-1', spec: '500ml' },
          quantity: 2,
          staff_note: '库存正常',
          status: 'counted',
        }],
        task: {
          created_by: 'profile-1',
          id: 'task-1',
          status: 'submitted',
          store_id: 'store-1',
          submitted_at: '2026-07-31T04:00:00Z',
          task_type: 'inventory',
        },
      },
      summary: {
        itemCount: 1,
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
      },
    } as unknown as Awaited<ReturnType<typeof loadSubmittedTaskDetailView>>);
  });

  it('loads a submitted task directly from its route and renders full-page item details', async () => {
    render(
      <MemoryRouter initialEntries={['/app/history/task-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes><Route path="/app/history/:taskId" element={<HistoryTaskDetailPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/测试货品/)).toBeInTheDocument();
    expect(screen.getByText('2 瓶')).toBeInTheDocument();
    expect(screen.getByText('库存正常')).toBeInTheDocument();
    expect(loadSubmittedTaskDetailView).toHaveBeenCalledWith({}, 'task-1');
  });

  it('does not call AI review for an administrator viewing a non-pilot store task', async () => {
    vi.mocked(useAuth).mockReturnValue({ profile: { id: 'admin-1', role: 'admin' } } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useAiPilotSettings).mockReturnValue({
      error: null,
      loading: false,
      reload: vi.fn(),
      settings: {
        adminApplyEnabled: true,
        adminVisible: true,
        autoRunEnabled: true,
        globalEnabled: true,
        pilotStores: [{ enabled: true, storeId: 'pilot-store', storeName: '试点门店', workflowFlags: {} }],
        workflowFlags: {},
      },
    });

    render(
      <MemoryRouter initialEntries={['/app/history/task-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes><Route path="/app/history/:taskId" element={<HistoryTaskDetailPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/测试货品/)).toBeInTheDocument();
    expect(screen.queryByTestId('ai-entity-review')).not.toBeInTheDocument();
    expect(ensureAiReview).not.toHaveBeenCalled();
  });
});
