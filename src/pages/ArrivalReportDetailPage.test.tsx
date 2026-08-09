import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { loadArrivalReportDetail, loadLatestArrivalCorrection, reopenVoidedArrivalReport } from '../services/arrivals.service';
import { ArrivalReportDetailPage } from './ArrivalReportDetailPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/arrivals.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/arrivals.service')>();
  return {
    ...original,
    loadArrivalReportDetail: vi.fn(),
    loadLatestArrivalCorrection: vi.fn(),
    reopenVoidedArrivalReport: vi.fn(),
  };
});

const reportId = '00000000-0000-4000-8000-000000000301';
const profileId = '00000000-0000-4000-8000-000000000001';

describe('ArrivalReportDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ profile: { id: profileId, role: 'staff' } } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadArrivalReportDetail).mockResolvedValue({
      images: [],
      items: [],
      report: {
        arrival_date: '2026-07-22',
        arrival_time: '12:30:00',
        carrier_name: null,
        generated_summary: '淡奶油到货3盒。',
        id: reportId,
        note: null,
        report_no: 'ARR-20260722-00000001',
        reported_by: profileId,
        reporter_name_snapshot: '测试员工',
        status: 'voided',
        submitted_at: '2026-07-22T04:30:00Z',
        tracking_no: null,
        void_reason: '照片不清楚',
      },
    } as unknown as Awaited<ReturnType<typeof loadArrivalReportDetail>>);
    vi.mocked(loadLatestArrivalCorrection).mockResolvedValue(null);
    vi.mocked(reopenVoidedArrivalReport).mockResolvedValue({ id: reportId } as Awaited<ReturnType<typeof reopenVoidedArrivalReport>>);
  });

  it('lets the original reporter reopen a voided report for editing', async () => {
    render(
      <MemoryRouter initialEntries={[`/app/arrivals/${reportId}`]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes>
          <Route path="/app/arrivals/:reportId" element={<ArrivalReportDetailPage />} />
          <Route path="/app/arrivals" element={<p>修改页面</p>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '修改并重新上报' }));

    await waitFor(() => expect(reopenVoidedArrivalReport).toHaveBeenCalledWith(expect.anything(), reportId));
    expect(await screen.findByText('修改页面')).toBeInTheDocument();
    expect(screen.queryByText('管理员已查看')).not.toBeInTheDocument();
  });
});
