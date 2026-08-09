import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { loadArrivalHistory, type ArrivalReportRow } from '../services/arrivals.service';
import { ArrivalHistoryPage } from './ArrivalHistoryPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/arrivals.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/arrivals.service')>();
  return { ...original, loadArrivalHistory: vi.fn() };
});

const viewedReport = {
  arrival_date: '2026-07-22',
  arrival_time: '12:30:00',
  generated_summary: '淡奶油到货3盒。',
  id: '00000000-0000-4000-8000-000000000301',
  report_no: 'ARR-20260722-00000001',
  reporter_name_snapshot: '测试员工',
  status: 'viewed',
  submitted_at: '2026-07-22T04:30:00Z',
  void_reason: null,
} as ArrivalReportRow;

describe('ArrivalHistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      profile: { id: '00000000-0000-4000-8000-000000000001', role: 'staff' },
      store: { id: '00000000-0000-4000-8000-000000000101', name: '测试门店' },
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadArrivalHistory).mockResolvedValue([viewedReport]);
  });

  it('shows a viewed report as submitted without exposing the administrator read state', async () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><ArrivalHistoryPage /></MemoryRouter>);

    expect(await screen.findByText('已上报')).toBeInTheDocument();
    expect(screen.queryByText('管理员已查看')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: `查看到货记录 ${viewedReport.report_no}` })).toHaveAttribute(
      'href',
      `/app/arrivals/${viewedReport.id}`,
    );
  });

  it('filters arrival history by day, month, or a custom range', async () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><ArrivalHistoryPage /></MemoryRouter>);

    await screen.findByText('已上报');
    fireEvent.click(screen.getByRole('tab', { name: '选择时间区间' }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-07-31' } });

    await waitFor(() => expect(loadArrivalHistory).toHaveBeenLastCalledWith(
      expect.anything(),
      '00000000-0000-4000-8000-000000000101',
      '2026-07-01',
      '2026-07-31',
    ));
  });
});
