import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { loadAdminArrivalList, loadAdminArrivalThumbnail, type AdminArrivalListItem } from '../services/admin-arrivals.service';
import { AdminArrivalsPage } from './AdminArrivalsPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/admin-arrivals.service', async (original) => {
  const actual = await original<typeof import('../services/admin-arrivals.service')>();
  return { ...actual, loadAdminArrivalList: vi.fn(), loadAdminArrivalThumbnail: vi.fn() };
});

describe('AdminArrivalsPage filters', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(useAuth).mockReturnValue({
      availableStores: [{ id: 'store-1', name: '测试门店' }],
      profile: { id: 'admin-1' },
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadAdminArrivalList).mockResolvedValue({ count: 0, reports: [] });
    vi.mocked(loadAdminArrivalThumbnail).mockResolvedValue(null);
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

  it('shows record text without waiting for its thumbnail download', async () => {
    vi.mocked(loadAdminArrivalList).mockResolvedValue({
      count: 1,
      reports: [{
        allProductsMatched: true,
        arrival_date: '2026-08-04',
        arrival_time: '14:30:00',
        id: 'report-1',
        itemSummary: '淡奶油到货2盒',
        productTypeCount: 1,
        reporter_name_snapshot: '测试员工',
        status: 'submitted',
        store_name_snapshot: '测试门店',
        thumbnailObjectPath: 'store/report/goods.jpg',
      } as AdminArrivalListItem],
    });
    vi.mocked(loadAdminArrivalThumbnail).mockReturnValue(new Promise(() => undefined));

    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AdminArrivalsPage /></MemoryRouter>);

    expect(await screen.findByText('淡奶油到货2盒')).toBeInTheDocument();
    expect(screen.getByText('照片加载中')).toBeInTheDocument();
    expect(screen.getByText('共 1 条')).toBeInTheDocument();
  });
});
