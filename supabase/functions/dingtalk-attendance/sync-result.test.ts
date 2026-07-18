import { describe, expect, it } from 'vitest';

import { summarizeAttendanceSync } from './sync-result';

describe('attendance sync result isolation', () => {
  it('reports one employee failure without discarding successful employees', () => {
    expect(summarizeAttendanceSync(3, 2, 1)).toEqual({ status: 'partial', message: '同步完成：2 名成功，1 名失败。' });
  });

  it('treats no bindings as a safe no-op', () => {
    expect(summarizeAttendanceSync(0, 0, 0)).toEqual({ status: 'succeeded', message: '没有可同步的已绑定员工。' });
  });
});
