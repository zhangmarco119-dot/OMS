import type { UserRole } from '../types/domain';

const STORAGE_PREFIX = 'storehub:last-route:';
const PARENT_PREFIX = 'storehub:parent-route:';

const normalizedPath = (path: string) => path.replace(/\/$/, '') || '/';

export function rememberRoute(pathname: string, search = '') {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${normalizedPath(pathname)}`, `${normalizedPath(pathname)}${search}`);
  } catch {
    // Storage may be unavailable in private or restricted browser contexts.
  }
}

export function rememberedRoute(pathname: string) {
  const normalized = normalizedPath(pathname);
  try {
    return sessionStorage.getItem(`${STORAGE_PREFIX}${normalized}`) || normalized;
  } catch {
    return normalized;
  }
}

export function rememberParentRoute(pathname: string, parentRoute: string) {
  try {
    sessionStorage.setItem(`${PARENT_PREFIX}${normalizedPath(pathname)}`, parentRoute);
  } catch {
    // Storage may be unavailable in private or restricted browser contexts.
  }
}

export function rememberedParentRoute(pathname: string) {
  try {
    return sessionStorage.getItem(`${PARENT_PREFIX}${normalizedPath(pathname)}`);
  } catch {
    return null;
  }
}

export function queryDetailParentRoute(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  const childKeys = pathname === '/app/admin/payroll' ? ['employee'] : pathname === '/app/payroll' ? ['payslip'] : pathname === '/app/notices' ? ['notice'] : [];
  if (!childKeys.some((key) => params.has(key))) return null;
  childKeys.forEach((key) => params.delete(key));
  const next = params.toString();
  return `${normalizedPath(pathname)}${next ? `?${next}` : ''}`;
}

export function logicalParentPath(pathname: string, role?: UserRole) {
  const path = normalizedPath(pathname);

  if (/^\/app\/account\/about\/manual\/[^/]+$/.test(path)) return '/app/account/about';
  if (path === '/app/account/about') return '/app/account';
  if (/^\/app\/admin\/attendance\/[^/]+$/.test(path)) return '/app/admin/attendance';
  if (/^\/app\/admin\/arrivals\/[^/]+$/.test(path)) return '/app/admin/arrivals';
  if (path === '/app/admin/arrivals/summary') return '/app/admin/arrivals';
  if (/^\/app\/admin\/tasks\/[^/]+$/.test(path) || path === '/app/admin/tasks/publish' || path === '/app/admin/task-templates') return '/app/admin/tasks';
  if (/^\/app\/tasks\/[^/]+$/.test(path)) return '/app/tasks';
  if (/^\/app\/notices\/[^/]+$/.test(path)) return '/app/notices';
  if (/^\/app\/sops\/[^/]+$/.test(path)) return role === 'admin' ? '/app/admin/sops' : '/app/sops';
  if (/^\/app\/arrivals\/[^/]+\/success$/.test(path) || path === '/app/arrivals/history') return '/app/arrivals';

  if (path.startsWith('/app/admin/')) return '/app/workbench';
  if ([
    '/app/inventory', '/app/order', '/app/arrivals', '/app/tasks', '/app/notices', '/app/sops',
    '/app/history', '/app/operations-history', '/app/attendance', '/app/payroll', '/app/overtime',
  ].includes(path)) return '/app/workbench';

  return null;
}

export function logicalParentRoute(pathname: string, role?: UserRole) {
  const parent = logicalParentPath(pathname, role);
  return parent ? rememberedParentRoute(pathname) ?? rememberedRoute(parent) : null;
}
