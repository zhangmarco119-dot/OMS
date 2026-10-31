import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { OperationReportsPage } from './OperationReportsPage';
import { getOperationReportAvailability, getOperationReportDraft, syncOperationReportSources } from '../services/operation-reports.service';
import { useAuth } from '../features/auth/AuthContext';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../services/store-business.service', async (original) => ({ ...await original<typeof import('../services/store-business.service')>(), loadStoreClosures: vi.fn().mockResolvedValue([{ store_id: 'west', closed_from: '2026-10-01', reopened_from: null }]) }));
vi.mock('../services/operation-reports.service', async (original) => ({
  ...await original<typeof import('../services/operation-reports.service')>(),
  getOperationReportAvailability: vi.fn().mockResolvedValue({ available: true, operating: false, fields: [] }),
  listOperationReports: vi.fn().mockResolvedValue([{ id: 'old-report', report_date: '2026-09-30', title_snapshot: '关店前报告', status: 'submitted', computed_data: { sales_amount: 100, transaction_count: 2 } }]),
  getOperationReportDraft: vi.fn(), syncOperationReportSources: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
  vi.mocked(useAuth).mockReturnValue({ profile: { id: 'staff', role: 'staff' }, store: { id: 'west' }, availableStores: [] } as never);
  vi.mocked(getOperationReportAvailability).mockResolvedValue({ available: true, operating: false, fields: [] });
});

it('blocks new report generation for a closed store while keeping submitted history accessible', async () => {
  render(<MemoryRouter><OperationReportsPage /></MemoryRouter>);
  expect(await screen.findByText('门店已关店')).toBeVisible();
  expect(getOperationReportDraft).not.toHaveBeenCalled();
  expect(syncOperationReportSources).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: '历史报告' }));
  expect(await screen.findByRole('link', { name: /关店前报告/ })).toHaveAttribute('href', '/app/operation-reports/old-report');
});

it('excludes closed stores from template setup while retaining them for historical report queries', async () => {
  vi.mocked(useAuth).mockReturnValue({ profile: { id: 'admin', role: 'admin' }, store: { id: 'west' }, availableStores: [{ id: 'west', name: '西直门' }, { id: 'five', name: '五道口' }] } as never);
  vi.mocked(getOperationReportAvailability).mockImplementation(async (id) => ({ available: id === 'west', operating: id !== 'west', fields: [] }));
  render(<MemoryRouter><OperationReportsPage /></MemoryRouter>);
  expect(await screen.findByRole('link', { name: /关店前报告/ })).toBeVisible();
  const selector = screen.getByRole('combobox', { name: '运营报告门店' });
  expect(within(selector).getByRole('option', { name: '西直门' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: '模板配置' }));
  await waitFor(() => expect(selector).toHaveValue('five'));
  expect(within(selector).queryByRole('option', { name: '西直门' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: '报告记录' }));
  await waitFor(() => expect(selector).toHaveValue('west'));
  expect(within(selector).getByRole('option', { name: '西直门' })).toBeInTheDocument();
});
