import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

import { normalizedRoute, queryDetailParentRoute } from '../../lib/navigationHierarchy';

const SCROLL_PREFIX = 'storehub:scroll-position:v2:';

const scrollTop = () => window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;

export function RouteScrollReset() {
  const location = useLocation();
  const { pathname, search } = location;
  const navigationType = useNavigationType();
  const routeKey = `${SCROLL_PREFIX}${normalizedRoute(pathname, search)}`;
  const previousLocation = useRef<typeof location | null>(null);

  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return undefined;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  useLayoutEffect(() => {
    const previous = previousLocation.current;
    const samePathPeerUpdate = Boolean(previous) && previous!.pathname === pathname
      && !queryDetailParentRoute(pathname, search)
      && !queryDetailParentRoute(previous!.pathname, previous!.search);
    const restoreRequested = navigationType === 'POP'
      || Boolean((location.state as { restoreScroll?: unknown } | null)?.restoreScroll);
    let top = 0;
    if (restoreRequested) {
      try { top = Number(sessionStorage.getItem(routeKey) ?? 0) || 0; } catch { top = 0; }
    } else if (samePathPeerUpdate) {
      top = scrollTop();
    }

    if (!samePathPeerUpdate || restoreRequested) {
      window.scrollTo({ behavior: 'auto', left: 0, top });
      document.documentElement.scrollTop = top;
      document.body.scrollTop = top;
    }

    previousLocation.current = location;
    return () => {
      try { sessionStorage.setItem(routeKey, String(scrollTop())); } catch { /* restricted storage */ }
    };
  }, [location, navigationType, pathname, routeKey, search]);

  return null;
}
