import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

import { useAuth } from '../../features/auth/AuthContext';
import { logicalParentPath, queryDetailParentRoute, rememberParentRoute, rememberRoute } from '../../lib/navigationHierarchy';

export function HierarchicalBackGuard() {
  const auth = useAuth();
  const location = useLocation();
  const navigationType = useNavigationType();
  const previousLocation = useRef<{ pathname: string; search: string } | null>(null);

  useEffect(() => {
    const previous = previousLocation.current;
    previousLocation.current = { pathname: location.pathname, search: location.search };

    if (previous && navigationType !== 'POP' && `${previous.pathname}${previous.search}` !== `${location.pathname}${location.search}`) {
      const parentPath = logicalParentPath(location.pathname, auth.profile?.role);
      const queryParent = queryDetailParentRoute(location.pathname, location.search);
      if (parentPath || queryParent) rememberParentRoute(location.pathname, `${previous.pathname}${previous.search}`);
    }

    rememberRoute(location.pathname, location.search);
  }, [auth.profile?.role, location.pathname, location.search, navigationType]);

  return null;
}
