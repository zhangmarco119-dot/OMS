import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSopDetail: vi.fn(),
  loadTaskTemplates: vi.fn(),
  publishSop: vi.fn(),
  role: 'admin' as 'admin' | 'staff',
  saveSop: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ availableStores: [{ id: 'store-1', name: '测试门店' }], profile: { role: mocks.role } }) }));
vi.mock('../services/v2-content.service', () => ({ loadSopDetail: mocks.loadSopDetail, publishSop: mocks.publishSop, saveSop: mocks.saveSop }));
vi.mock('../services/task-templates.service', () => ({ loadTaskTemplates: mocks.loadTaskTemplates }));

import { SopDetailPage } from './SopDetailPage';

const detail = (status: 'draft' | 'published') => ({
  assetUrls: Array.from({ length: 6 }, (_, index) => ({
    asset_kind: 'step', file_name: `步骤${index + 1}.jpg`, id: `step-${index + 1}`, mime_type: 'image/jpeg',
    signedUrl: `https://example.test/step-${index + 1}.jpg`, sort_order: index, step_text: `步骤 ${index + 1} 说明`,
  })),
  body: '制作说明', category: '酸奶碗', effective_at: null, id: 'sop-1', roles: ['staff', 'manager'], status,
  storeIds: ['store-1'], taskTemplateId: null, title: '六步酸奶碗',
});

const renderPage = () => render(<MemoryRouter initialEntries={['/app/sops/sop-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route path="/app/sops/:sopId" element={<SopDetailPage />} /></Routes></MemoryRouter>);

describe('SopDetailPage compact employee preview', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.role = 'admin'; mocks.loadTaskTemplates.mockResolvedValue([{ id: 'template-1', name: '开店检查', status: 'published' }]); });

  it('lets an administrator preview a draft with the same two-column step layout', async () => {
    mocks.loadSopDetail.mockResolvedValue(detail('draft'));
    renderPage();

    expect(await screen.findByRole('heading', { name: '六步酸奶碗' })).toBeInTheDocument();
    expect(screen.getByTestId('sop-detail-step-grid')).toHaveClass('grid-cols-2');
    expect(screen.getAllByRole('img')).toHaveLength(6);
    const firstDescription = screen.getByText('步骤 1 说明');
    const firstImage = screen.getByAltText('六步酸奶碗 步骤 1');
    expect(firstDescription.compareDocumentPosition(firstImage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the same two-column layout to staff for a published SOP', async () => {
    mocks.role = 'staff';
    mocks.loadSopDetail.mockResolvedValue(detail('published'));
    renderPage();

    expect(await screen.findByTestId('sop-detail-step-grid')).toHaveClass('grid-cols-2');
    expect(screen.getAllByRole('img')).toHaveLength(6);
  });

  it('publishes a draft from the basic settings below the administrator preview', async () => {
    mocks.loadSopDetail.mockResolvedValueOnce(detail('draft')).mockResolvedValueOnce(detail('published'));
    mocks.saveSop.mockResolvedValue({ id: 'sop-1' });
    mocks.publishSop.mockResolvedValue({ status: 'published' });
    renderPage();

    expect(await screen.findByRole('heading', { name: '发布基本设置' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /静默发布/ })).toBeChecked();
    fireEvent.click(screen.getByText('高级选项'));
    fireEvent.change(screen.getByRole('combobox', { name: '关联任务模板' }), { target: { value: 'template-1' } });
    fireEvent.click(screen.getByRole('button', { name: '确认发布 SOP' }));

    await waitFor(() => expect(mocks.saveSop).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      id: 'sop-1', roles: ['staff', 'manager'], storeIds: ['store-1'], taskTemplateId: 'template-1',
    })));
    expect(mocks.publishSop).toHaveBeenCalledWith(expect.anything(), 'sop-1', { silent: true });
    expect(await screen.findByText('SOP 已静默发布。')).toBeInTheDocument();
  });
});
