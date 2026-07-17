import { beforeEach, describe, expect, it } from 'vitest';

import { logicalParentPath, logicalParentRoute, rememberRoute } from './navigationHierarchy';

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
    expect(logicalParentPath('/app/overtime', 'manager')).toBe('/app/workbench');
    expect(logicalParentPath('/app/account/about', 'admin')).toBe('/app/account');
  });
});
