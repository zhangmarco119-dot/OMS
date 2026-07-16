import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadCategories: vi.fn(),
  loadPage: vi.fn(),
  setFavorite: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/v2-content.service', () => ({
  loadSopCategories: mocks.loadCategories,
  loadSopLibraryPage: mocks.loadPage,
  setSopFavorite: mocks.setFavorite,
}));

import { SopLibraryPage } from './SopLibraryPage';

function DetailStub() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)} type="button">返回 SOP 列表</button>;
}

describe('SopLibraryPage previews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadCategories.mockResolvedValue([{ name: '酸奶碗' }]);
    mocks.loadPage.mockResolvedValue({ items: [{ category: '酸奶碗', id: 'sop-1', isFavorite: false, previewUrl: 'https://example.test/cover.jpg', status: 'published', title: '芒果酸奶碗' }], total: 1 });
  });

  it('shows a compact product thumbnail on the employee SOP entry', async () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><SopLibraryPage /></MemoryRouter>);
    expect(await screen.findByAltText('芒果酸奶碗 预览')).toHaveAttribute('src', 'https://example.test/cover.jpg');
    expect(screen.getByRole('link', { name: /芒果酸奶碗/ })).toHaveClass('min-h-20');
  });

  it('renders five SOPs first and then automatically appends the next five-item page', async () => {
    const entries = Array.from({ length: 8 }, (_, index) => ({
      category: '测试分类', id: `sop-${index + 1}`, isFavorite: false, previewUrl: null, status: 'published', title: `测试 SOP ${index + 1}`,
    }));
    mocks.loadPage.mockImplementation(async (_client, options) => ({
      items: entries.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit),
      total: entries.length,
    }));

    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><SopLibraryPage /></MemoryRouter>);

    expect(await screen.findByRole('link', { name: /测试 SOP 1/ })).toBeInTheDocument();
    expect(mocks.loadPage).toHaveBeenNthCalledWith(1, {}, expect.objectContaining({ limit: 5 }));
    await waitFor(() => expect(mocks.loadPage).toHaveBeenCalledTimes(2), { timeout: 1500 });
    expect(mocks.loadPage).toHaveBeenNthCalledWith(2, {}, expect.objectContaining({ limit: 5, offset: 5 }));
    expect(await screen.findByRole('link', { name: /测试 SOP 8/ })).toBeInTheDocument();
  });

  it('lets an employee favorite a SOP directly from its card', async () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><SopLibraryPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '收藏 芒果酸奶碗' }));
    await waitFor(() => expect(mocks.setFavorite).toHaveBeenCalledWith({}, 'sop-1', true));
    expect(screen.getByRole('button', { name: '取消收藏 芒果酸奶碗' })).toBeInTheDocument();
  });

  it('uses a category dropdown and restores the selected category after viewing a SOP', async () => {
    mocks.loadCategories.mockResolvedValue([{ name: '酸奶碗' }, { name: '奶茶' }]);
    const entries = [
      { category: '酸奶碗', id: 'sop-1', isFavorite: false, previewUrl: null, status: 'published', title: '芒果酸奶碗' },
      { category: '奶茶', id: 'sop-2', isFavorite: false, previewUrl: null, status: 'published', title: '黑糖珍珠奶茶' },
    ];
    mocks.loadPage.mockImplementation(async (_client, options) => { const items = options.category && options.category !== 'all' ? entries.filter((entry) => entry.category === options.category) : entries; return { items, total: items.length }; });
    render(<MemoryRouter initialEntries={['/app/sops']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route path="/app/sops" element={<SopLibraryPage />} /><Route path="/app/sops/:sopId" element={<DetailStub />} /></Routes></MemoryRouter>);

    const category = await screen.findByRole('combobox', { name: 'SOP 分类查看' });
    fireEvent.change(category, { target: { value: '奶茶' } });
    expect(await screen.findByRole('link', { name: /黑糖珍珠奶茶/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /芒果酸奶碗/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: /黑糖珍珠奶茶/ }));
    fireEvent.click(await screen.findByRole('button', { name: '返回 SOP 列表' }));

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'SOP 分类查看' })).toHaveValue('奶茶'));
    expect(screen.getByRole('link', { name: /黑糖珍珠奶茶/ })).toBeInTheDocument();
  });
});
