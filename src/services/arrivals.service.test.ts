import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { ArrivalDraftItem } from '../features/arrivals/arrivalForm';
import type { Database } from '../types/database';
import { applyArrivalOpenedAt, localArrivalDate, localArrivalTime, saveArrivalDraft } from './arrivals.service';

const report = {
  arrival_date: '2026-07-12',
  arrival_time: '12:00:00',
  carrier_name: null,
  created_at: '2026-07-12T04:00:00.000Z',
  generated_summary: '原味酸奶到货 2 杯。',
  id: '00000000-0000-4000-8000-000000000001',
  note: null,
  report_no: 'ARR-20260712-00000001',
  reported_by: '00000000-0000-4000-8000-000000000002',
  reporter_name_snapshot: '测试员工',
  status: 'draft',
  store_id: '00000000-0000-4000-8000-000000000003',
  store_name_snapshot: '测试门店',
  submission_key: null,
  submitted_at: null,
  tracking_no: null,
  updated_at: '2026-07-12T04:00:01.000Z',
  version: 2,
  viewed_at: null,
  viewed_by: null,
  void_reason: null,
  voided_at: null,
  voided_by: null,
};

const completeItem: ArrivalDraftItem = {
  id: '00000000-0000-4000-8000-000000000101',
  isUnmatchedProduct: true,
  note: '',
  productId: null,
  productName: '原味酸奶',
  quantity: '2',
  sortOrder: 0,
  spec: '',
  unit: '杯',
};

describe('arrivals service', () => {
  it('uses the device local date and time for a new arrival draft', () => {
    const now = new Date(2026, 6, 13, 9, 5, 0);
    expect(localArrivalDate(now)).toBe('2026-07-13');
    expect(localArrivalTime(now)).toBe('09:05');
  });

  it('refreshes a restored draft to the moment the arrival page is opened', () => {
    const restored = applyArrivalOpenedAt({
      arrivalDate: '2026-07-10',
      arrivalTime: '08:30',
      carrierName: '顺丰',
    }, new Date(2026, 6, 13, 17, 58, 45));

    expect(restored).toEqual({
      arrivalDate: '2026-07-13',
      arrivalTime: '17:58',
      carrierName: '顺丰',
    });
  });

  it('saves complete items through the atomic draft RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: report, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;

    await saveArrivalDraft(client, {
      arrivalDate: '2026-07-12',
      arrivalTime: '12:00',
      carrierName: '',
      expectedVersion: 1,
      items: [completeItem, { ...completeItem, id: '00000000-0000-4000-8000-000000000102', quantity: '' }],
      note: '',
      reportId: report.id,
      trackingNo: '',
    });

    expect(rpc).toHaveBeenCalledWith('save_arrival_draft', expect.objectContaining({
      p_expected_version: 1,
      p_items: [expect.objectContaining({ product_name_snapshot: '原味酸奶', quantity: 2 })],
      p_report_id: report.id,
    }));
  });

  it('rejects malformed RPC data instead of trusting database JSON', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: { id: report.id }, error: null }),
    } as unknown as SupabaseClient<Database>;

    await expect(saveArrivalDraft(client, {
      arrivalDate: '2026-07-12',
      arrivalTime: '12:00',
      carrierName: '',
      expectedVersion: 1,
      items: [completeItem],
      note: '',
      reportId: report.id,
      trackingNo: '',
    })).rejects.toThrow('数据库返回的到货草稿格式无效');
  });
});
