import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
});
