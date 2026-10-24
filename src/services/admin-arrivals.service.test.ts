import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { loadStorageImageResource } from '../lib/imageResourceCache';
import type { Database } from '../types/database';
import { loadAdminArrivalList, loadAdminArrivalSummary, loadAdminArrivalThumbnail, markAdminArrivalViewed, voidAdminArrival } from './admin-arrivals.service';

vi.mock('../lib/imageResourceCache', () => ({ loadStorageImageResource: vi.fn() }));

describe('admin arrivals service mutations', () => {
  it('reads every page in the selected period/store before calculating product totals', async () => {
    const sample = { product_name_snapshot: '酸奶', unit: '箱', quantity: 1, store_id: 'store-1', store_name_snapshot: '测试门店', arrival_date: '2026-10-01' };
    const range = vi.fn().mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, i) => ({ ...sample, item_id: `i${i}`, report_id: `r${i}` })), error: null }).mockResolvedValueOnce({ data: [{ ...sample, item_id: 'last', report_id: 'last' }], error: null });
    const query = { select: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), range };
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient<Database>;
    const summary = await loadAdminArrivalSummary(client, { dateFrom: '2026-10-01', dateTo: '2026-10-24' }, 'store-1');
    expect(range.mock.calls).toEqual([[0, 499], [500, 999]]);
    expect(query.gte).toHaveBeenCalledWith('arrival_date', '2026-10-01');
    expect(query.lte).toHaveBeenCalledWith('arrival_date', '2026-10-24');
    expect(query.eq).toHaveBeenCalledWith('store_id', 'store-1');
    expect(summary.details).toHaveLength(501);
    expect(summary.products[0]).toMatchObject({ total_quantity: 501, report_count: 501 });
  });
  it('marks a report viewed through the protected RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'viewed' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await markAdminArrivalViewed(client, 'report-1');
    expect(rpc).toHaveBeenCalledWith('mark_arrival_viewed', { p_report_id: 'report-1' });
  });

  it('loads the complete Arrival Center page through one bounded RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { count: 0, reports: [] }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;

    await loadAdminArrivalList(client, {
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      page: 1,
      productSearch: ' 淡奶油 ',
      status: 'all',
      storeId: '',
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('list_admin_arrivals_v2', {
      p_date_from: '2026-07-01',
      p_date_to: '2026-07-31',
      p_page: 1,
      p_page_size: 20,
      p_product_search: '淡奶油',
      p_status: 'all',
      p_store_id: null,
    });
  });

  it('loads a small persistent thumbnail instead of the original image', async () => {
    vi.mocked(loadStorageImageResource).mockResolvedValue('blob:thumbnail');
    const client = {} as SupabaseClient<Database>;

    await expect(loadAdminArrivalThumbnail(client, 'store/report/goods.jpg')).resolves.toBe('blob:thumbnail');
    expect(loadStorageImageResource).toHaveBeenCalledWith(client, 'arrival-report-images', 'store/report/goods.jpg', {
      scope: 'device',
      transform: { height: 160, quality: 55, resize: 'cover', width: 160 },
      variant: 'arrival-thumbnail',
      version: 'v1',
    });
  });

  it('requires a reason and trims it before voiding', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'voided' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await expect(voidAdminArrival(client, 'report-1', '   ')).rejects.toThrow('请填写作废原因');
    await voidAdminArrival(client, 'report-1', '  重复上报  ');
    expect(rpc).toHaveBeenCalledWith('void_arrival_report', { p_reason: '重复上报', p_report_id: 'report-1' });
  });
});
