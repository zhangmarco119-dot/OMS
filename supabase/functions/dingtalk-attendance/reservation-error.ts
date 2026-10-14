export const attendanceReservationErrorCode = (message: string) =>
  message.includes('DINGTALK_DAILY_API_LIMIT') ? 'DAILY_API_LIMIT' : 'SYNC_API_RESERVATION_FAILED';
