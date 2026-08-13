import type { AiPilotSettings, AiWorkflow } from '../../services/ai-review.service';

export const isAiWorkflowEnabledForStore = (
  settings: AiPilotSettings | null,
  storeId: string,
  workflow: AiWorkflow,
  requireApply = false,
) => {
  if (!settings?.globalEnabled || !settings.adminVisible || (requireApply && !settings.adminApplyEnabled)) return false;
  const scope = settings.pilotStores.find((store) => store.storeId === storeId);
  return Boolean(scope?.enabled && settings.workflowFlags[workflow] !== false && scope.workflowFlags[workflow] !== false);
};
