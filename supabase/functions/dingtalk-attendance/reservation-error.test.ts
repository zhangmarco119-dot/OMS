import { describe, expect, it } from 'vitest';
import { attendanceReservationErrorCode } from './reservation-error';

describe('attendance API reservation errors', () => {
  it('only treats the explicit daily-limit exception as a quota failure', () => {
    expect(attendanceReservationErrorCode('DINGTALK_DAILY_API_LIMIT: 今日钉钉接口调用已达到安全上限')).toBe('DAILY_API_LIMIT');
  });
  it('does not label database sequence or permission errors as exhausted quota', () => {
    expect(attendanceReservationErrorCode('duplicate key value violates unique constraint')).toBe('SYNC_API_RESERVATION_FAILED');
    expect(attendanceReservationErrorCode('service role required')).toBe('SYNC_API_RESERVATION_FAILED');
  });
});
