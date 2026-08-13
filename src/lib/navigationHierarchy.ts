import type { UserRole } from '../types/domain';

const STORAGE_PREFIX = 'storehub:last-route:';
const PARENT_PREFIX = 'storehub:parent-route:v2:';

export interface RememberedParentRoute {
  historyIndex: number | null;
  route: string;
}

export interface BusinessParentDecision extends RememberedParentRoute {
  source: 'query' | 'remembered' | 'declared' | 'default';
}

const normalizedPath = (path: string) => path.replace(/\/$/, '') || '/';

const splitRoute = (route: string) => {
  const [pathname, rawSearch = ''] = route.split('?', 2);
  return { pathname: normalizedPath(pathname), search: rawSearch ? `?${rawSearch}` : '' };
};

export function normalizedRoute(pathname: string, search = '') {
  const params = new URLSearchParams(search);
  params.sort();
  const next = params.toString();
  return `${normalizedPath(pathname)}${next ? `?${next}` : ''}`;
}

const normalizedRouteValue = (route: string) => {
  const { pathname, search } = splitRoute(route);
  return normalizedRoute(pathname, search);
};

export function sameNavigationRoute(left: string, right: string) {
  return normalizedRouteValue(left) === normalizedRouteValue(right);
}

export function isPrimaryNavigationRoute(route: string) {
  const { pathname } = splitRoute(route);
  return ['/app', '/app/messages', '/app/workbench', '/app/menu', '/app/todos', '/app/account'].includes(pathname);
}

export function rememberRoute(pathname: string, search = '') {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${normalizedPath(pathname)}`, normalizedRoute(pathname, search));
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

export function rememberParentRoute(route: string, parentRoute: string, historyIndex: number | null = null) {
  try {
    sessionStorage.setItem(`${PARENT_PREFIX}${normalizedRouteValue(route)}`, JSON.stringify({
      historyIndex: Number.isInteger(historyIndex) ? historyIndex : null,
      route: normalizedRouteValue(parentRoute),
    } satisfies RememberedParentRoute));
  } catch {
    // Storage may be unavailable in private or restricted browser contexts.
  }
}

export function rememberedParentRouteInfo(route: string): RememberedParentRoute | null {
  try {
    const stored = sessionStorage.getItem(`${PARENT_PREFIX}${normalizedRouteValue(route)}`);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<RememberedParentRoute>;
    if (typeof parsed.route !== 'string' || !parsed.route.startsWith('/app')) return null;
    return {
      historyIndex: Number.isInteger(parsed.historyIndex) ? Number(parsed.historyIndex) : null,
      route: normalizedRouteValue(parsed.route),
    };
  } catch {
    return null;
  }
}

export function rememberedParentRoute(route: string) {
  return rememberedParentRouteInfo(route)?.route ?? null;
}

export function queryDetailParentRoute(pathname: string, search: string) {
  const path = normalizedPath(pathname);
  const params = new URLSearchParams(search);

  if (path === '/app/admin/payroll') {
    const tab = params.get('tab') || 'overview';
    let childKey: string | null = null;
    if (tab === 'statistics' && params.has('statisticsPeriod')) childKey = 'statisticsPeriod';
    else if (tab === 'statistics' && params.has('statisticsEmployee')) childKey = 'statisticsEmployee';
    else if (tab === 'payslips' && params.has('editPayslip')) childKey = 'editPayslip';
    else if (tab === 'payslips' && params.has('payslip')) childKey = 'payslip';
    else if (tab === 'overview' && params.has('employee')) childKey = 'employee';
    if (!childKey) return null;
    params.delete(childKey);
  } else if (path === '/app/payroll' && params.has('payslip')) {
    params.delete('payslip');
  } else if (path === '/app/account' && params.has('view')) {
    params.delete('view');
  } else if (path === '/app/notices' && params.has('notice')) {
    params.delete('notice');
  } else if (path === '/app/inventory' && params.has('linkedTaskId')) {
    return `/app/tasks/${encodeURIComponent(params.get('linkedTaskId') || '')}`;
  } else if (path === '/app/arrivals' && params.has('reportId')) {
    return '/app/arrivals/history';
  } else {
    return null;
  }

  const next = params.toString();
  return `${path}${next ? `?${next}` : ''}`;
}

export function logicalParentPath(pathname: string, role?: UserRole) {
  const path = normalizedPath(pathname);

  if (/^\/app\/account\/about\/manual\/[^/]+$/.test(path)) return '/app/account/about';
  if (path === '/app/account/about') return '/app/account';
  if (path === '/app/admin/products/correction-task') return '/app/admin/products';
  if (/^\/app\/admin\/attendance\/[^/]+$/.test(path)) return '/app/admin/attendance';
  if (path === '/app/admin/arrivals/summary' || /^\/app\/admin\/arrivals\/[^/]+$/.test(path)) return '/app/admin/arrivals';
  if (path === '/app/admin/tasks/publish' || path === '/app/admin/task-templates' || /^\/app\/admin\/tasks\/[^/]+$/.test(path)) return '/app/admin/tasks';
  if (/^\/app\/tasks\/[^/]+$/.test(path)) return '/app/tasks';
  if (/^\/app\/payroll-confirmations\/[^/]+$/.test(path)) return '/app/todos';
  if (/^\/app\/notices\/[^/]+$/.test(path)) return '/app/notices';
  if (/^\/app\/sops\/[^/]+$/.test(path)) return role === 'admin' ? '/app/admin/sops' : '/app/sops';
  if (/^\/app\/operation-reports\/[^/]+$/.test(path)) return '/app/operation-reports';
  if (/^\/app\/history\/[^/]+$/.test(path)) return '/app/history';
  if (/^\/app\/arrivals\/corrections\/[^/]+\/review$/.test(path)) return '/app/todos';
  if (/^\/app\/arrivals\/[^/]+\/correct$/.test(path)) return path.replace(/\/correct$/, '');
  if (/^\/app\/arrivals\/[^/]+\/success$/.test(path)) return '/app/arrivals';
  if (path === '/app/arrivals/history') return '/app/arrivals';
  if (/^\/app\/arrivals\/[^/]+$/.test(path)) return '/app/arrivals/history';

  if (path.startsWith('/app/admin/')) return '/app/workbench';
  if ([
    '/app/inventory', '/app/order', '/app/arrivals', '/app/tasks', '/app/notices', '/app/sops',
    '/app/history', '/app/operations-history', '/app/attendance', '/app/payroll', '/app/overtime', '/app/operation-reports',
  ].includes(path)) return '/app/workbench';

  return null;
}

const matchesPath = (route: string, pattern: RegExp | string) => {
  const { pathname } = splitRoute(route);
  if (typeof pattern !== 'string') return pattern.test(pathname);
  if (pattern === '/app/workbench') return pathname === '/app/workbench' || pathname === '/app/menu';
  return pathname === pattern;
};

export function isAllowedBusinessParentRoute(currentRoute: string, candidateRoute: string, role?: UserRole) {
  const current = splitRoute(currentRoute);
  const candidate = normalizedRouteValue(candidateRoute);
  if (!candidate.startsWith('/app') || sameNavigationRoute(currentRoute, candidate)) return false;

  const queryParent = queryDetailParentRoute(current.pathname, current.search);
  if (queryParent) return sameNavigationRoute(queryParent, candidate);

  const defaultParent = logicalParentPath(current.pathname, role);
  if (defaultParent && matchesPath(candidate, defaultParent)) return true;

  if (/^\/app\/tasks\/[^/]+$/.test(current.pathname)) {
    return matchesPath(candidate, '/app') || matchesPath(candidate, '/app/todos');
  }
  if (/^\/app\/admin\/tasks\/[^/]+$/.test(current.pathname)) {
    return matchesPath(candidate, '/app') || matchesPath(candidate, '/app/todos');
  }
  if (/^\/app\/notices\/[^/]+$/.test(current.pathname)) {
    return matchesPath(candidate, '/app') || matchesPath(candidate, '/app/account') || matchesPath(candidate, '/app/todos') || matchesPath(candidate, /^\/app\/tasks\/[^/]+$/);
  }
  if (/^\/app\/sops\/[^/]+$/.test(current.pathname)) {
    return matchesPath(candidate, '/app') || matchesPath(candidate, '/app/sops') || matchesPath(candidate, '/app/admin/sops') || matchesPath(candidate, /^\/app\/tasks\/[^/]+$/);
  }
  if (/^\/app\/history\/[^/]+$/.test(current.pathname)) {
    return matchesPath(candidate, /^\/app\/admin\/tasks\/[^/]+$/);
  }
  if (current.pathname === '/app/arrivals/history') {
    return matchesPath(candidate, '/app/operations-history');
  }
  if (['/app/history', '/app/tasks'].includes(current.pathname)) {
    return matchesPath(candidate, '/app/operations-history') || matchesPath(candidate, '/app');
  }

  // Dashboard cards and notifications are legitimate alternate entry points for
  // business pages. This does not make unrelated feature pages parents.
  if (defaultParent === '/app/workbench' && matchesPath(candidate, '/app')) return true;

  return false;
}

export function businessParentDecision(pathname: string, search: string, role?: UserRole, declaredBackTo?: string): BusinessParentDecision | null {
  const currentRoute = normalizedRoute(pathname, search);
  const remembered = rememberedParentRouteInfo(currentRoute);
  const queryParent = queryDetailParentRoute(pathname, search);

  if (queryParent) {
    return {
      historyIndex: remembered && sameNavigationRoute(remembered.route, queryParent) ? remembered.historyIndex : null,
      route: queryParent,
      source: 'query',
    };
  }

  if (remembered && isAllowedBusinessParentRoute(currentRoute, remembered.route, role)) {
    return { ...remembered, source: 'remembered' };
  }

  if (declaredBackTo) {
    const declared = rememberedRoute(splitRoute(declaredBackTo).pathname);
    const route = sameNavigationRoute(declaredBackTo, splitRoute(declaredBackTo).pathname) ? declared : normalizedRouteValue(declaredBackTo);
    const defaultParent = logicalParentPath(pathname, role);
    const obsoleteHomeFallback = defaultParent === '/app/workbench' && matchesPath(route, '/app');
    if (!obsoleteHomeFallback && isAllowedBusinessParentRoute(currentRoute, route, role)) {
      return { historyIndex: null, route, source: 'declared' };
    }
  }

  const defaultParent = logicalParentPath(pathname, role);
  if (!defaultParent) return null;
  return { historyIndex: null, route: rememberedRoute(defaultParent), source: 'default' };
}

export function logicalParentRoute(pathname: string, role?: UserRole, search = '') {
  return businessParentDecision(pathname, search, role)?.route ?? null;
}
