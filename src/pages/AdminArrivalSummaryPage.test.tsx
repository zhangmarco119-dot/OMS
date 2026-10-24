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
    expect(screen.getByLabelText('期间到货总量 2 瓶')).toBeInTheDocument();
    expect(screen.getByText('2026-09-22 10:30')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '产品汇总' })).not.toBeInTheDocument();
    expect(screen.getAllByText('蓝莓果酱').length).toBeGreaterThan(0);
    expect(screen.queryByText('淡奶油')).not.toBeInTheDocument();
  });

  it('groups matching products separately and allows focusing on one exact name/unit', async () => {
    vi.mocked(loadAdminArrivalSummary).mockResolvedValue({ products: [], details: [
      ...summary.details,
      { ...summary.details[1], item_id: 'second-jam', report_id: 'report-jam-2', arrival_date: '2026-09-23', quantity: 5 },
      { ...summary.details[1], item_id: 'jam-box', unit: '箱', quantity: 1 },
      { ...summary.details[1], item_id: 'another-jam', product_name_snapshot: '草莓果酱', quantity: 4 },
    ] });
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AdminArrivalSummaryPage /></MemoryRouter>);
    await screen.findByRole('searchbox', { name: '检索汇总产品' });
    await screen.findByText('明细数量合计');
    fireEvent.change(screen.getByRole('searchbox', { name: '检索汇总产品' }), { target: { value: '果酱' } });
    expect(screen.getByLabelText('期间到货总量 7 瓶')).toBeInTheDocument();
    expect(screen.getByLabelText('期间到货总量 1 箱')).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: '选择统计商品' });
    fireEvent.change(select, { target: { value: JSON.stringify(['蓝莓果酱', '瓶']) } });
    expect(screen.queryByRole('region', { name: '草莓果酱（瓶）到货统计' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('期间到货总量 1 箱')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '查看蓝莓果酱到货详情' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: '查看蓝莓果酱到货详情' })[0]).toHaveTextContent('2026-09-23 10:30');
    fireEvent.click(screen.getByRole('button', { name: '清空汇总产品检索' }));
    expect(screen.getByRole('tab', { name: '到货明细' })).toBeInTheDocument();
  });
});
