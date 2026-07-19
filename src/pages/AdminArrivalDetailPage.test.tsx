import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadAdminArrivalDetail,
  markAdminArrivalViewed,
  type AdminArrivalDetail,
} from '../services/admin-arrivals.service';
import { AdminArrivalDetailPage } from './AdminArrivalDetailPage';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/admin-arrivals.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/admin-arrivals.service')>();
  return {
    ...actual,
    loadAdminArrivalDetail: vi.fn(),
    markAdminArrivalViewed: vi.fn(),
    voidAdminArrival: vi.fn(),
  };
});

const detail = (status: 'submitted' | 'viewed'): AdminArrivalDetail => ({
  auditLogs: [],
  images: [],
  items: [],
  report: {
    arrival_date: '2026-07-19',
    arrival_time: '10:30:00',
    carrier_name: null,
    created_at: '2026-07-19T02:30:00Z',
    generated_summary: '淡奶油到货3盒',
    id: 'report-1',
    note: null,
    report_no: 'ARR-001',
    reporter_name_snapshot: '测试员工',
    status,
    store_name_snapshot: '测试门店',
    submitted_at: '2026-07-19T02:31:00Z',
    tracking_no: null,
    viewed_at: status === 'viewed' ? '2026-07-19T02:32:00Z' : null,
    void_reason: null,
    voided_at: null,
  } as AdminArrivalDetail['report'],
});

describe('AdminArrivalDetailPage read state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks a submitted arrival as read as soon as its detail is opened', async () => {
    vi.mocked(loadAdminArrivalDetail)
      .mockResolvedValueOnce(detail('submitted'))
      .mockResolvedValueOnce(detail('viewed'));
    vi.mocked(markAdminArrivalViewed).mockResolvedValue({ status: 'viewed' });

    render(
      <MemoryRouter initialEntries={['/app/admin/arrivals/report-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes><Route element={<AdminArrivalDetailPage />} path="/app/admin/arrivals/:reportId" /></Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(markAdminArrivalViewed).toHaveBeenCalledWith(expect.anything(), 'report-1'));
    expect(await screen.findByText('已查看')).toBeInTheDocument();
    expect(loadAdminArrivalDetail).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: '标记已查看' })).not.toBeInTheDocument();
  });
});
