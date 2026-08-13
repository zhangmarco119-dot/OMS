import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { useAiPilotSettings } from '../features/ai-review/useAiPilotSettings';
import { actOnAiSuggestion, listAiReviews, loadAiReview, skipAiReview } from '../services/ai-review.service';
import { AdminAiReviewPage } from './AdminAiReviewPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../features/ai-review/useAiPilotSettings', () => ({ useAiPilotSettings: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/ai-review.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/ai-review.service')>();
  return { ...actual, actOnAiSuggestion: vi.fn(), listAiReviews: vi.fn(), loadAiReview: vi.fn(), rerunAiReview: vi.fn(), skipAiReview: vi.fn() };
});

const run = {
  completedAt: '2026-08-13T01:00:00Z',
  createdAt: '2026-08-13T00:59:00Z',
  entityId: 'report-1',
  errorMessage: null,
  id: 'run-1',
  maxSeverity: 'critical' as const,
  pendingCount: 1,
  status: 'completed' as const,
  storeId: '00000000-0000-4000-8000-000000000001',
  storeName: '宝珠奶酪（五道口店）',
  sourceHash: 'source-hash-1',
  suggestionCount: 1,
  summary: '发现数量异常',
  workflow: 'arrival_report' as const,
};

function LocationProbe() {
  const location = useLocation();
  return <pre data-testid="location-state">{JSON.stringify({ pathname: location.pathname, state: location.state })}</pre>;
}

describe('AdminAiReviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      availableStores: [
        { id: '00000000-0000-4000-8000-000000000001', name: '宝珠奶酪（五道口店）' },
        { id: '00000000-0000-4000-8000-000000000099', name: '非试点门店' },
      ],
      profile: { id: 'admin-1', role: 'admin' },
    } as ReturnType<typeof useAuth>);
    vi.mocked(useAiPilotSettings).mockReturnValue({
      error: null,
      loading: false,
      reload: vi.fn(),
      settings: {
        adminApplyEnabled: true,
        adminVisible: true,
        autoRunEnabled: true,
        globalEnabled: true,
        pilotStores: [{ enabled: true, storeId: '00000000-0000-4000-8000-000000000001', storeName: '宝珠奶酪（五道口店）', workflowFlags: {} }],
        workflowFlags: {},
      },
    });
    vi.mocked(listAiReviews).mockResolvedValue({ items: [run], total: 1 });
    vi.mocked(loadAiReview).mockResolvedValue({
      run,
      suggestions: [{ actionType: 'edit_quantity', confidence: 0.96, currentValue: 120, draftPatch: { item_id: 'item-1', quantity: 12 }, fieldPath: 'arrival.items[0].quantity', id: 'suggestion-1', issueType: 'quantity_outlier', rationale: '最近五次中位数为 12，本次为 120', severity: 'critical', sourceHash: 'source-hash-1', status: 'pending', suggestedValue: 12, title: '数量疑似多填一位' }],
    });
    vi.mocked(actOnAiSuggestion).mockResolvedValue({ actionType: 'edit_quantity', draftPatch: { item_id: 'item-1', quantity: 12 }, runId: 'run-1', sourceHash: 'source-hash-1', status: 'applied_to_draft', suggestionId: 'suggestion-1', targetEntityId: 'report-1', targetEntityType: 'arrival_report', targetStoreId: run.storeId });
    vi.mocked(skipAiReview).mockResolvedValue(run);
  });

  it('shows only pilot stores and renders critical as high risk with evidence', async () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AdminAiReviewPage /></MemoryRouter>);
    expect(await screen.findByText('发现数量异常')).toBeInTheDocument();
    expect(screen.getAllByText('高风险')).toHaveLength(2);
    expect(screen.getByRole('option', { name: '宝珠奶酪（五道口店）' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '非试点门店' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看建议' }));
    expect(await screen.findByText(/最近五次中位数为 12/)).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('filters by workflow, store and status through the administrator RPC', async () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AdminAiReviewPage /></MemoryRouter>);
    await screen.findByText('发现数量异常');
    fireEvent.change(screen.getByLabelText('门店'), { target: { value: run.storeId } });
    fireEvent.change(screen.getByLabelText('流程'), { target: { value: 'arrival_report' } });
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'completed' } });
    await waitFor(() => expect(listAiReviews).toHaveBeenLastCalledWith({}, expect.objectContaining({ status: 'completed', storeIds: [run.storeId], workflow: 'arrival_report' })));
  });

  it('opens an existing product for a product request without marking the suggestion applied', async () => {
    const requestRun = { ...run, entityId: 'request-1', workflow: 'product_creation_request' as const };
    const existingSuggestion = {
      actionType: 'use_existing_product',
      confidence: 0.98,
      currentValue: { name: '疑似重复酸奶' },
      draftPatch: { product_id: 'product-existing' },
      fieldPath: 'request.product_id',
      id: 'suggestion-existing',
      issueType: 'duplicate_product',
      rationale: '货品库中已有高度相似货品',
      severity: 'critical' as const,
      sourceHash: 'source-hash-request',
      status: 'pending' as const,
      suggestedValue: { name: '已有标准酸奶', product_id: 'product-existing' },
      title: '建议使用已有货品',
    };
    vi.mocked(listAiReviews).mockResolvedValue({ items: [requestRun], total: 1 });
    vi.mocked(loadAiReview).mockResolvedValue({ run: requestRun, suggestions: [existingSuggestion] });

    render(
      <MemoryRouter initialEntries={['/app/admin/ai-reviews']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes>
          <Route element={<AdminAiReviewPage />} path="/app/admin/ai-reviews" />
          <Route element={<LocationProbe />} path="/app/admin/products" />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(requestRun.summary);
    fireEvent.click(screen.getByRole('button', { name: '查看建议' }));
    expect(await screen.findByText(new RegExp(existingSuggestion.rationale))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '修改后采纳' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /仅查看已有货品/ }));

    const route = await screen.findByTestId('location-state');
    expect(route).toHaveTextContent('/app/admin/products');
    expect(route).toHaveTextContent('product-existing');
    expect(route).toHaveTextContent('product_creation_request');
    expect(actOnAiSuggestion).not.toHaveBeenCalled();
  });
});
