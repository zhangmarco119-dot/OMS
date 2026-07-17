import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

import { useAuth } from '../../features/auth/AuthContext';
import { logicalParentPath, logicalParentRoute, rememberRoute } from '../../lib/navigationHierarchy';

export function HierarchicalBackGuard() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const previousPath = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = location.pathname;

    if (previous && navigationType === 'POP') {
      const parentPath = logicalParentPath(previous, auth.profile?.role);
      if (parentPath && location.pathname !== parentPath) {
        navigate(logicalParentRoute(previous, auth.profile?.role) ?? parentPath, { replace: true });
        return;
      }
    }

    rememberRoute(location.pathname, location.search);
  }, [auth.profile?.role, location.pathname, location.search, navigate, navigationType]);

  return null;
}
