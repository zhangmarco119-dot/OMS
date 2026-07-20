import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { loadAdminArrivalList } from '../services/admin-arrivals.service';
import { AdminArrivalsPage } from './AdminArrivalsPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/admin-arrivals.service', async (original) => {
  const actual = await original<typeof import('../services/admin-arrivals.service')>();
  return { ...actual, loadAdminArrivalList: vi.fn() };
});

describe('AdminArrivalsPage filters', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(useAuth).mockReturnValue({
      availableStores: [{ id: 'store-1', name: '测试门店' }],
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadAdminArrivalList).mockResolvedValue({ count: 0, reports: [] });
  });

  it('keeps the compact period filter visible without a filter menu', async () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AdminArrivalsPage /></MemoryRouter>);

    expect(await screen.findByRole('tab', { name: '选择某日' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '选择某月' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '选择时间区间' })).toBeInTheDocument();
    expect(screen.getByLabelText('日期')).toBeVisible();
    expect(screen.queryByRole('button', { name: '筛选' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '到货汇总' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新到货记录' })).toBeInTheDocument();
  });
});
