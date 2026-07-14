import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSopDetail: vi.fn(),
  role: 'admin' as 'admin' | 'staff',
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ profile: { role: mocks.role } }) }));
vi.mock('../services/v2-content.service', () => ({ loadSopDetail: mocks.loadSopDetail }));

import { SopDetailPage } from './SopDetailPage';

const detail = (status: 'draft' | 'published') => ({
  assetUrls: Array.from({ length: 6 }, (_, index) => ({
    asset_kind: 'step', file_name: `步骤${index + 1}.jpg`, id: `step-${index + 1}`, mime_type: 'image/jpeg',
    signedUrl: `https://example.test/step-${index + 1}.jpg`, sort_order: index, step_text: `步骤 ${index + 1} 说明`,
  })),
  body: '制作说明', category: '酸奶碗', id: 'sop-1', status, title: '六步酸奶碗',
});

const renderPage = () => render(<MemoryRouter initialEntries={['/app/sops/sop-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route path="/app/sops/:sopId" element={<SopDetailPage />} /></Routes></MemoryRouter>);

describe('SopDetailPage compact employee preview', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.role = 'admin'; });

  it('lets an administrator preview a draft with the same two-column step layout', async () => {
    mocks.loadSopDetail.mockResolvedValue(detail('draft'));
    renderPage();

    expect(await screen.findByRole('heading', { name: '六步酸奶碗' })).toBeInTheDocument();
    expect(screen.getByTestId('sop-detail-step-grid')).toHaveClass('grid-cols-2');
    expect(screen.getAllByRole('img')).toHaveLength(6);
  });

  it('shows the same two-column layout to staff for a published SOP', async () => {
    mocks.role = 'staff';
    mocks.loadSopDetail.mockResolvedValue(detail('published'));
    renderPage();

    expect(await screen.findByTestId('sop-detail-step-grid')).toHaveClass('grid-cols-2');
    expect(screen.getAllByRole('img')).toHaveLength(6);
  });
});
