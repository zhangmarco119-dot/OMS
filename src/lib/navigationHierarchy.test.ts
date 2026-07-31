import { beforeEach, describe, expect, it } from 'vitest';

import { logicalParentPath, logicalParentRoute, queryDetailParentRoute, rememberParentRoute, rememberRoute } from './navigationHierarchy';

describe('navigation hierarchy', () => {
  beforeEach(() => sessionStorage.clear());

  it('returns to the role-specific SOP list', () => {
    expect(logicalParentPath('/app/sops/123', 'staff')).toBe('/app/sops');
    expect(logicalParentPath('/app/sops/123', 'admin')).toBe('/app/admin/sops');
  });

  it('restores the last filter on a logical parent page', () => {
    rememberRoute('/app/sops', '?category=%E9%85%B8%E5%A5%B6%E7%A2%97');
    expect(logicalParentRoute('/app/sops/123', 'staff')).toBe('/app/sops?category=%E9%85%B8%E5%A5%B6%E7%A2%97');
  });

  it('maps feature pages to their stable parent menu', () => {
    expect(logicalParentPath('/app/admin/attendance/person-1', 'admin')).toBe('/app/admin/attendance');
    expect(logicalParentPath('/app/history/task-1', 'staff')).toBe('/app/history');
    expect(logicalParentPath('/app/overtime', 'manager')).toBe('/app/workbench');
    expect(logicalParentPath('/app/account/about', 'admin')).toBe('/app/account');
  });

  it('returns to the actual menu used to open a page', () => {
    rememberParentRoute('/app/admin/payroll', '/app/workbench?section=payroll');
    expect(logicalParentRoute('/app/admin/payroll', 'admin')).toBe('/app/workbench?section=payroll');
  });

  it('removes only query parameters that represent a child view', () => {
    expect(queryDetailParentRoute('/app/admin/payroll', '?tab=overview&date=2026-06-30&store=s1&employee=p1')).toBe('/app/admin/payroll?tab=overview&date=2026-06-30&store=s1');
    expect(queryDetailParentRoute('/app/payroll', '?tab=payslips&payslip=slip-1')).toBe('/app/payroll?tab=payslips');
    expect(queryDetailParentRoute('/app/notices', '?notice=notice-1')).toBe('/app/notices');
    expect(queryDetailParentRoute('/app/admin/payroll', '?tab=revenue&date=2026-06-30')).toBeNull();
  });
});
