import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { loadStorageImageResource } from '../lib/imageResourceCache';
import type { Database } from '../types/database';
import { loadAdminArrivalList, loadAdminArrivalThumbnail, markAdminArrivalViewed, voidAdminArrival } from './admin-arrivals.service';

vi.mock('../lib/imageResourceCache', () => ({ loadStorageImageResource: vi.fn() }));

describe('admin arrivals service mutations', () => {
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
      status: 'all',
      storeId: '',
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('list_admin_arrivals_v1', {
      p_date_from: '2026-07-01',
      p_date_to: '2026-07-31',
      p_page: 1,
      p_page_size: 20,
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
