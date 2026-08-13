import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { businessParentDecision } from './navigationHierarchy';

export function useBusinessBack(declaredBackTo?: string) {
  const location = useLocation();
  const navigate = useNavigate();

  return useCallback(() => {
    const decision = businessParentDecision(location.pathname, location.search, undefined, declaredBackTo);
    if (!decision) return;
    const currentHistoryIndex = Number(window.history.state?.idx);
    const hasVerifiedImmediateParent = Number.isInteger(currentHistoryIndex)
      && decision.historyIndex !== null
      && decision.historyIndex === currentHistoryIndex - 1;
    if (hasVerifiedImmediateParent) {
      navigate(-1);
      return;
    }
    navigate(decision.route, { replace: true, state: { businessBack: true, restoreScroll: true } });
  }, [declaredBackTo, location.pathname, location.search, navigate]);
}
