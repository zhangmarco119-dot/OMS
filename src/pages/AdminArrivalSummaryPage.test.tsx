import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { loadAdminArrivalSummary, type AdminArrivalSummary } from '../services/admin-arrivals.service';
import { AdminArrivalSummaryPage } from './AdminArrivalSummaryPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/admin-arrivals.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/admin-arrivals.service')>();
  return { ...actual, loadAdminArrivalSummary: vi.fn() };
});

const summary: AdminArrivalSummary = {
  details: [{
    arrival_date: '2026-09-22', arrival_time: '09:30:00', is_unmatched_product: false, item_id: 'item-cream', product_id: 'product-cream', product_name_snapshot: '淡奶油', quantity: 3, report_id: 'report-cream', report_no: 'ARR-001', reported_by: 'staff-1', reporter_name_snapshot: '员工甲', sort_order: 1, status: 'viewed', store_id: 'store-1', store_name_snapshot: '测试门店', submitted_at: '2026-09-22T01:31:00Z', unit: '盒',
  }, {
    arrival_date: '2026-09-22', arrival_time: '10:30:00', is_unmatched_product: false, item_id: 'item-jam', product_id: 'product-jam', product_name_snapshot: '蓝莓果酱', quantity: 2, report_id: 'report-jam', report_no: 'ARR-002', reported_by: 'staff-2', reporter_name_snapshot: '员工乙', sort_order: 1, status: 'viewed', store_id: 'store-1', store_name_snapshot: '测试门店', submitted_at: '2026-09-22T02:31:00Z', unit: '瓶',
  }],
  products: [{
    arrival_date: '2026-09-22', product_name_snapshot: '淡奶油', report_count: 1, store_id: 'store-1', store_name_snapshot: '测试门店', total_quantity: 3, unit: '盒',
  }, {
    arrival_date: '2026-09-22', product_name_snapshot: '蓝莓果酱', report_count: 1, store_id: 'store-1', store_name_snapshot: '测试门店', total_quantity: 2, unit: '瓶',
  }],
};

describe('AdminArrivalSummaryPage product search', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ availableStores: [{ id: 'store-1', name: '测试门店' }] } as ReturnType<typeof useAuth>);
    vi.mocked(loadAdminArrivalSummary).mockResolvedValue(summary);
  });

  it('filters both views and links each detail card to its exact product item', async () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AdminArrivalSummaryPage /></MemoryRouter>);

    expect(await screen.findByRole('searchbox', { name: '检索汇总产品' })).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox', { name: '检索汇总产品' }), { target: { value: '蓝莓' } });

    await waitFor(() => expect(screen.queryByText('淡奶油')).not.toBeInTheDocument());
    const links = screen.getAllByRole('link', { name: '查看蓝莓果酱到货详情' });
    expect(links[0]).toHaveAttribute('href', '/app/admin/arrivals/report-jam?item=item-jam');
    expect(screen.getByText('明细数量合计').nextSibling).toHaveTextContent('2');

    fireEvent.click(screen.getByRole('tab', { name: '产品汇总' }));
    expect(screen.getAllByText('蓝莓果酱').length).toBeGreaterThan(0);
    expect(screen.queryByText('淡奶油')).not.toBeInTheDocument();
  });
});
