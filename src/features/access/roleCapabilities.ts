import type { UserRole } from '../../types/domain';

export type V1HistoryScope = 'self' | 'store' | 'authorized-stores';

export const getV1HistoryScope = (role: UserRole): V1HistoryScope => {
  if (role === 'staff') {
    return 'self';
  }
  if (role === 'manager') {
    return 'store';
  }
  return 'authorized-stores';
};

export const canManageV1ProductsFromTask = (role: UserRole | null | undefined) =>
  role === 'manager';

export const canOperateV2Modules = (role: UserRole | null | undefined) =>
  role === 'staff' || role === 'manager';
