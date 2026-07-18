import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

import { useAuth } from '../../features/auth/AuthContext';
import { logicalParentPath, logicalParentRoute, queryDetailParentRoute, rememberParentRoute, rememberRoute } from '../../lib/navigationHierarchy';

export function HierarchicalBackGuard() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const previousLocation = useRef<{ pathname: string; search: string } | null>(null);

  useEffect(() => {
    const previous = previousLocation.current;
    previousLocation.current = { pathname: location.pathname, search: location.search };

    if (previous && navigationType === 'POP') {
      const queryParent = queryDetailParentRoute(previous.pathname, previous.search);
      const parentPath = logicalParentPath(previous.pathname, auth.profile?.role);
      const target = queryParent ?? (parentPath ? logicalParentRoute(previous.pathname, auth.profile?.role) ?? parentPath : null);
      const current = `${location.pathname}${location.search}`;
      if (target && current !== target) {
        navigate(target, { replace: true });
        return;
      }
    }

    if (previous && navigationType !== 'POP' && previous.pathname !== location.pathname) {
      const parentPath = logicalParentPath(location.pathname, auth.profile?.role);
      if (parentPath) rememberParentRoute(location.pathname, queryDetailParentRoute(previous.pathname, previous.search) ?? `${previous.pathname}${previous.search}`);
    }

    rememberRoute(location.pathname, location.search);
  }, [auth.profile?.role, location.pathname, location.search, navigate, navigationType]);

  return null;
}
