import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

import { useAuth } from '../../features/auth/AuthContext';
import {
  businessParentDecision,
  isAllowedBusinessParentRoute,
  isPrimaryNavigationRoute,
  normalizedRoute,
  queryDetailParentRoute,
  rememberParentRoute,
  rememberedParentRouteInfo,
  rememberRoute,
} from '../../lib/navigationHierarchy';

interface PreviousLocation {
  historyIndex: number | null;
  pathname: string;
  search: string;
}

export function HierarchicalBackGuard() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const previousLocation = useRef<PreviousLocation | null>(null);

  useLayoutEffect(() => {
    const role = auth.profile?.role;
    const previous = previousLocation.current;
    const historyIndexValue = Number(window.history.state?.idx);
    const historyIndex = Number.isInteger(historyIndexValue) ? historyIndexValue : null;
    const currentRoute = normalizedRoute(location.pathname, location.search);

    if (previous) {
      const previousRoute = normalizedRoute(previous.pathname, previous.search);
      const changed = previousRoute !== currentRoute;

      if (changed && navigationType === 'POP') {
        const wasBackward = previous.historyIndex === null || historyIndex === null || historyIndex <= previous.historyIndex;
        if (wasBackward && isPrimaryNavigationRoute(previousRoute) && currentRoute.startsWith('/app')) {
          previousLocation.current = { historyIndex, pathname: location.pathname, search: location.search };
          navigate(previousRoute, { replace: true, state: { businessBack: true, restoreScroll: true } });
          return;
        }
        const previousParent = businessParentDecision(previous.pathname, previous.search, role);
        if (wasBackward && previousParent && !isAllowedBusinessParentRoute(previousRoute, currentRoute, role)) {
          previousLocation.current = { historyIndex, pathname: location.pathname, search: location.search };
          navigate(previousParent.route, { replace: true, state: { businessBack: true, restoreScroll: true } });
          return;
        }
      }

      if (changed && navigationType === 'PUSH' && isAllowedBusinessParentRoute(currentRoute, previousRoute, role)) {
        rememberParentRoute(currentRoute, previousRoute, previous.historyIndex);
      }

      if (changed && navigationType === 'REPLACE') {
        const inheritedParent = rememberedParentRouteInfo(previousRoute);
        if (inheritedParent && isAllowedBusinessParentRoute(currentRoute, inheritedParent.route, role)) {
          rememberParentRoute(currentRoute, inheritedParent.route, inheritedParent.historyIndex);
        }
      }
    }

    // A detail query must never replace the remembered state of its list page.
    if (!queryDetailParentRoute(location.pathname, location.search)) {
      rememberRoute(location.pathname, location.search);
    }
    previousLocation.current = { historyIndex, pathname: location.pathname, search: location.search };
  }, [auth.profile?.role, location.pathname, location.search, navigate, navigationType]);

  return null;
}
