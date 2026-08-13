import type { Json } from '../../types/database';

const FOLLOW_UP_KEY = 'storehub:ai-review-follow-up-draft';

export interface AiFollowUpTaskDraft {
  actionType: string;
  currentValue: Json;
  draftPatch: Record<string, Json | undefined>;
  entityId: string;
  fieldPath: string | null;
  rationale: string;
  sourceWorkflow: 'inventory' | 'order' | 'v2_task';
  storeId: string;
  storeName: string;
  suggestionId: string;
  suggestedValue: Json;
  title: string;
}

export interface AiProductCreationReviewDraft {
  draftPatch: Record<string, Json | undefined>;
  requestId: string;
  storeId: string;
  suggestionId: string;
}

export const saveAiFollowUpTaskDraft = (draft: AiFollowUpTaskDraft) => {
  window.sessionStorage.setItem(FOLLOW_UP_KEY, JSON.stringify(draft));
};

export const readAiFollowUpTaskDraft = (): AiFollowUpTaskDraft | null => {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(FOLLOW_UP_KEY) ?? 'null') as AiFollowUpTaskDraft | null;
    return value?.suggestionId && value.storeId && value.actionType && value.draftPatch ? value : null;
  } catch {
    return null;
  }
};

export const clearAiFollowUpTaskDraft = () => window.sessionStorage.removeItem(FOLLOW_UP_KEY);
