import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadCategories: vi.fn(),
  loadEntries: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/v2-content.service', () => ({
  loadSopCategories: mocks.loadCategories,
  loadSopLibraryEntries: mocks.loadEntries,
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
    mocks.loadEntries.mockResolvedValue([{ category: '酸奶碗', id: 'sop-1', previewUrl: 'https://example.test/cover.jpg', status: 'published', title: '芒果酸奶碗' }]);
  });

  it('shows a compact product thumbnail on the employee SOP entry', async () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><SopLibraryPage /></MemoryRouter>);
    expect(await screen.findByAltText('芒果酸奶碗 预览')).toHaveAttribute('src', 'https://example.test/cover.jpg');
    expect(screen.getByRole('button', { name: /芒果酸奶碗/ })).toHaveClass('min-h-20');
  });

  it('uses a category dropdown and restores the selected category after viewing a SOP', async () => {
    mocks.loadCategories.mockResolvedValue([{ name: '酸奶碗' }, { name: '奶茶' }]);
    mocks.loadEntries.mockResolvedValue([
      { category: '酸奶碗', id: 'sop-1', previewUrl: null, status: 'published', title: '芒果酸奶碗' },
      { category: '奶茶', id: 'sop-2', previewUrl: null, status: 'published', title: '黑糖珍珠奶茶' },
    ]);
    render(<MemoryRouter initialEntries={['/app/sops']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Routes><Route path="/app/sops" element={<SopLibraryPage />} /><Route path="/app/sops/:sopId" element={<DetailStub />} /></Routes></MemoryRouter>);

    const category = await screen.findByRole('combobox', { name: 'SOP 分类查看' });
    fireEvent.change(category, { target: { value: '奶茶' } });
    expect(screen.getByRole('button', { name: /黑糖珍珠奶茶/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /芒果酸奶碗/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /黑糖珍珠奶茶/ }));
    fireEvent.click(await screen.findByRole('button', { name: '返回 SOP 列表' }));

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'SOP 分类查看' })).toHaveValue('奶茶'));
    expect(screen.getByRole('button', { name: /黑糖珍珠奶茶/ })).toBeInTheDocument();
  });
});
