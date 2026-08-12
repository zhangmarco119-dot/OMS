import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

import { queryDetailParentRoute } from '../../lib/navigationHierarchy';

const SCROLL_PREFIX = 'storehub:scroll-position:';

export function RouteScrollReset() {
  const location = useLocation();
  const { key, pathname, search } = location;
  const navigationType = useNavigationType();
  const storageKey = `${SCROLL_PREFIX}${key}`;
  const previousLocation = useRef<typeof location | null>(null);

  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return undefined;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  useLayoutEffect(() => {
    const previous = previousLocation.current;
    const samePathQueryUpdate = Boolean(previous) && previous!.pathname === pathname
      && !queryDetailParentRoute(pathname, search)
      && !queryDetailParentRoute(previous!.pathname, previous!.search);
    let top = 0;
    if (navigationType === 'POP') {
      try { top = Number(sessionStorage.getItem(storageKey) ?? 0) || 0; } catch { top = 0; }
    } else if (samePathQueryUpdate) {
      top = window.scrollY || document.documentElement.scrollTop || 0;
    }
    if (!samePathQueryUpdate || navigationType === 'POP') {
      window.scrollTo({ behavior: 'auto', left: 0, top });
      document.documentElement.scrollTop = top;
      document.body.scrollTop = top;
    }
    previousLocation.current = location;
    return () => {
      try { sessionStorage.setItem(storageKey, String(window.scrollY || document.documentElement.scrollTop || 0)); } catch { /* restricted storage */ }
    };
  }, [location, navigationType, pathname, search, storageKey]);

  return null;
}
