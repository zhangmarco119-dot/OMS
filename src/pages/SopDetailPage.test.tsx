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

const renderPage = () => render(<MemoryRouter initialEntries={['/app/sops/sop-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route path="/app/sops/:sopId" element={<SopDetailPage />} /><Route path="/app/admin/sops" element={<div>SOP 管理</div>} /></Routes></MemoryRouter>);

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
    expect(firstImage).toHaveAttribute('loading', 'eager');
    expect(screen.getByAltText('六步酸奶碗 步骤 5')).toHaveAttribute('loading', 'lazy');
  });

  it('shows the SOP immediately without waiting for administrator task templates', async () => {
    let resolveTemplates: (value: Array<{ id: string; name: string; status: string }>) => void = () => undefined;
    mocks.loadSopDetail.mockResolvedValue(detail('draft'));
    mocks.loadTaskTemplates.mockReturnValue(new Promise((resolve) => { resolveTemplates = resolve; }));
    renderPage();

    expect(await screen.findByRole('heading', { name: '六步酸奶碗' })).toBeInTheDocument();
    expect(screen.getByAltText('六步酸奶碗 步骤 1')).toBeInTheDocument();
    resolveTemplates([{ id: 'template-1', name: '开店检查', status: 'published' }]);
    await waitFor(() => expect(mocks.loadTaskTemplates).toHaveBeenCalledTimes(1));
  });

  it('shows the same two-column layout to staff for a published SOP', async () => {
    mocks.role = 'staff';
    mocks.loadSopDetail.mockResolvedValue(detail('published'));
    renderPage();

    expect(await screen.findByTestId('sop-detail-step-grid')).toHaveClass('grid-cols-2');
    expect(screen.getAllByRole('img')).toHaveLength(6);
  });

  it('renders a pure-text step and a pure-image step without placeholder copy', async () => {
    mocks.role = 'staff';
    const mixed = detail('published');
    mixed.assetUrls = [
      { asset_kind: 'step', file_name: null, id: 'text-step', mime_type: null, object_path: null, signedUrl: null, sort_order: 0, step_text: '静置十分钟。' },
      { asset_kind: 'step', file_name: 'only-image.jpg', id: 'image-step', mime_type: 'image/jpeg', object_path: 'sop-1/only-image.jpg', signedUrl: 'https://example.test/only-image.jpg', sort_order: 1, step_text: '' },
    ] as never;
    mocks.loadSopDetail.mockResolvedValue(mixed);
    renderPage();

    expect(await screen.findByText('静置十分钟。')).toBeInTheDocument();
    expect(screen.getByAltText(/步骤 2$/)).toBeInTheDocument();
    expect(screen.queryByText(/请按图示/)).not.toBeInTheDocument();
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
    expect(await screen.findByText('SOP 管理')).toBeInTheDocument();
  });
});
