import { describe, expect, it } from 'vitest';

import {
  canManageV1ProductsFromTask,
  canOperateV2Modules,
  getV1HistoryScope,
} from './roleCapabilities';

describe('role capabilities', () => {
  it('preserves the V1 employee and manager history difference', () => {
    expect(getV1HistoryScope('staff')).toBe('self');
    expect(getV1HistoryScope('manager')).toBe('store');
    expect(getV1HistoryScope('admin')).toBe('authorized-stores');
  });

  it('preserves manager-only V1 product maintenance in task pages', () => {
    expect(canManageV1ProductsFromTask('staff')).toBe(false);
    expect(canManageV1ProductsFromTask('manager')).toBe(true);
    expect(canManageV1ProductsFromTask('admin')).toBe(false);
  });

  it('shares only V2 execution modules between employees and managers', () => {
    expect(canOperateV2Modules('staff')).toBe(true);
    expect(canOperateV2Modules('manager')).toBe(true);
    expect(canOperateV2Modules('admin')).toBe(false);
    expect(canOperateV2Modules(null)).toBe(false);
  });
});
