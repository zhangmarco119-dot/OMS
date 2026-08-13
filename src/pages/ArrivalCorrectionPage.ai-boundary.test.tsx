import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { loadArrivalCorrectionEditor, loadLatestArrivalCorrection, type ArrivalCorrectionEditorData } from '../services/arrivals.service';
import { ArrivalCorrectionPage } from './ArrivalCorrectionPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/arrivals.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/arrivals.service')>();
  return { ...actual, loadArrivalCorrectionEditor: vi.fn(), loadLatestArrivalCorrection: vi.fn() };
});

const editor = {
  items: [{ id: 'item-1', isUnmatchedProduct: true, note: '', productId: null, productName: '原货品', quantity: '1', sortOrder: 0, spec: '', unit: '瓶' }],
  products: [],
  report: {
    arrival_date: '2026-08-13',
    arrival_time: '12:00:00',
    carrier_name: null,
    id: 'report-1',
    note: '原备注',
    report_no: 'DH-001',
    reported_by: 'staff-1',
    reporter_name_snapshot: '员工甲',
    status: 'submitted',
    store_id: 'store-1',
    tracking_no: null,
  },
} as unknown as ArrivalCorrectionEditorData;

describe('ArrivalCorrectionPage AI visibility boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadArrivalCorrectionEditor).mockResolvedValue(editor);
    vi.mocked(loadLatestArrivalCorrection).mockResolvedValue(null);
  });

  it.each(['staff', 'manager'] as const)('ignores AI route state and shows no AI copy for a %s account', async (role) => {
    vi.mocked(useAuth).mockReturnValue({
      availableStores: [{ id: 'store-1', name: '测试门店' }],
      profile: { id: role === 'staff' ? 'staff-1' : 'manager-1', role },
    } as ReturnType<typeof useAuth>);

    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }} initialEntries={[{
      pathname: '/app/arrivals/report-1/correct',
      state: { aiDraftPatch: { fields: { note: 'AI 备注' } }, aiSuggestionId: 'suggestion-1' },
    }]}><Routes><Route path="/app/arrivals/:reportId/correct" element={<ArrivalCorrectionPage />} /></Routes></MemoryRouter>);

    expect(await screen.findByDisplayValue('原备注')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('AI 备注')).not.toBeInTheDocument();
    expect(screen.queryByText('已带入 AI 建议')).not.toBeInTheDocument();
  });
});
