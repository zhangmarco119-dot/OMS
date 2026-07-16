import { describe, expect, it, vi } from 'vitest';

import { loadAdminAttendanceMonth, loadAttendanceMonth } from './attendance.service';

describe('attendance service', () => {
  it('parses employee month details from the stable RPC contract', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { summary: { attendanceDates: ['2026-07-01'], attendanceDays: 1, workedMinutes: 630, lateCount: 1, lateMinutes: 5, missingCount: 0, abnormalCount: 0, lastSyncedAt: null }, days: [] }, error: null });
    const result = await loadAttendanceMonth({ rpc } as never, 'profile-1', '2026-07');
    expect(rpc).toHaveBeenCalledWith('get_attendance_month_detail', { p_profile_id: 'profile-1', p_month: '2026-07-01', p_store_id: null });
    expect(result.summary).toMatchObject({ attendanceDays: 1, workedMinutes: 630, lateMinutes: 5 });
  });

  it('passes administrator pagination and filters only to the protected RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { total: 1, items: [{ profileId: 'p1', displayName: '员工甲', storeId: 's1', storeName: '门店甲', bindingStatus: 'active', attendanceDays: 3, workedMinutes: 1860, attendanceDates: ['2026-07-01'], lateCount: 0, lateMinutes: 0, missingCount: 0, abnormalCount: 0 }] }, error: null });
    const result = await loadAdminAttendanceMonth({ rpc } as never, { month: '2026-07', storeId: 's1', search: '员工', status: 'normal', offset: 50 });
    expect(rpc).toHaveBeenCalledWith('admin_attendance_month', expect.objectContaining({ p_store_id: 's1', p_search: '员工', p_status: 'normal', p_offset: 50, p_limit: 50 }));
    expect(result.items[0]).toMatchObject({ displayName: '员工甲', bindingStatus: 'active', workedMinutes: 1860 });
  });

  it('passes a selected store to employee detail while leaving all stores as null', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { summary: { attendanceDates: [], attendanceDays: 0, workedMinutes: 0 }, days: [] }, error: null });
    await loadAttendanceMonth({ rpc } as never, 'profile-1', '2026-07', 'store-2');
    expect(rpc).toHaveBeenCalledWith('get_attendance_month_detail', { p_profile_id: 'profile-1', p_month: '2026-07-01', p_store_id: 'store-2' });
  });
});
