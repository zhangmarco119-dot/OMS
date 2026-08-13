import { beforeEach, describe, expect, it } from 'vitest';

import { businessParentDecision, isAllowedBusinessParentRoute, logicalParentPath, logicalParentRoute, queryDetailParentRoute, rememberParentRoute, rememberRoute } from './navigationHierarchy';

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
    expect(queryDetailParentRoute('/app/account', '?view=password')).toBe('/app/account');
    expect(queryDetailParentRoute('/app/admin/payroll', '?tab=statistics&statisticsEmployee=p1&statisticsPeriod=2026-07')).toBe('/app/admin/payroll?tab=statistics&statisticsEmployee=p1');
    expect(queryDetailParentRoute('/app/admin/payroll', '?tab=revenue&date=2026-06-30')).toBeNull();
  });

  it('does not treat a peer tab as the parent of another tab', () => {
    expect(isAllowedBusinessParentRoute('/app/admin/payroll?tab=employees', '/app/admin/payroll?tab=overview', 'admin')).toBe(false);
    expect(businessParentDecision('/app/admin/payroll', '?tab=employees', 'admin', '/app/workbench')?.route).toBe('/app/workbench');
  });

  it('keeps each detail level and its exact parent filter state', () => {
    rememberParentRoute('/app/admin/payroll?employee=p1&store=s1&tab=overview', '/app/admin/payroll?store=s1&tab=overview', 4);
    expect(businessParentDecision('/app/admin/payroll', '?tab=overview&store=s1&employee=p1', 'admin')).toMatchObject({
      historyIndex: 4,
      route: '/app/admin/payroll?tab=overview&store=s1',
    });
  });
});
