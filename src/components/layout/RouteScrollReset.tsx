import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function RouteScrollReset() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return undefined;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  useLayoutEffect(() => {
    window.scrollTo({ behavior: 'auto', left: 0, top: 0 });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);

  return null;
}
