import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { downloadOperationReportImage, loadOperationReportImages } from '../services/operation-report-images.service';
import { getOperationReport } from '../services/operation-reports.service';
import { OperationReportDetailPage } from './OperationReportDetailPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/operation-report-images.service', () => ({
  downloadOperationReportImage: vi.fn(),
  loadOperationReportImages: vi.fn(),
}));
vi.mock('../services/operation-reports.service', () => ({ getOperationReport: vi.fn() }));

describe('OperationReportDetailPage photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ profile: { role: 'admin' } } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(getOperationReport).mockResolvedValue({
      field_config_snapshot: [{ id: 'material', kind: 'manual', label: '物料剩余', unit: '箱' }],
      id: 'report-1',
      manual_values: { material: '3' },
      report_date: '2026-07-24',
      text_report: '每日运营报告',
      title_snapshot: '每日运营报告',
    } as never);
    vi.mocked(loadOperationReportImages).mockResolvedValue([{
      field_id: 'material',
      file_name: 'material.jpg',
      id: 'image-1',
      object_path: 'store/report/material.jpg',
      signedUrl: 'https://example.test/material.jpg',
    }] as never);
    vi.mocked(downloadOperationReportImage).mockResolvedValue(undefined);
  });

  it('opens a large preview and downloads the original image', async () => {
    render(
      <MemoryRouter initialEntries={['/app/operation-reports/report-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes><Route path="/app/operation-reports/:reportId" element={<OperationReportDetailPage />} /></Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '查看物料剩余大图' }));
    expect(screen.getByRole('dialog', { name: '运营报告现场图片大图' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下载原图' }));
    await waitFor(() => expect(downloadOperationReportImage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'image-1' })));
  });
});
