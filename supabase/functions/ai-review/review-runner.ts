import { DeepSeekClient, DeepSeekReviewError } from './deepseek-client.ts';
import { mergeSuggestions, runDeterministicRules } from './deterministic-rules.ts';
import { buildSystemPrompt, serializeModelContext } from './prompt.ts';
import { AiSuggestionPolicyError, enforceSuggestionPolicy, sanitizeReviewContext } from './review-policy.ts';
import type { AiReviewWorkflow, ModelUsage } from './types.ts';

export interface ReviewExecution {
  attempts: number;
  latencyMs: number;
  model: string;
  suggestions: Record<string, unknown>[];
  systemFingerprint: string | null;
  usage: ModelUsage;
}

export const executeReview = async (
  client: DeepSeekClient,
  workflow: AiReviewWorkflow,
  rawContext: unknown,
): Promise<ReviewExecution> => {
  const startedAt = Date.now();
  const context = sanitizeReviewContext(workflow, rawContext);
  const deterministic = runDeterministicRules(workflow, context)
    .map((suggestion) => ({ ...enforceSuggestionPolicy(workflow, suggestion, context), source: 'rule' as const }));
  const model = await client.review(buildSystemPrompt(workflow), serializeModelContext(context));
  const safeModelSuggestions = model.suggestions.map((suggestion) => enforceSuggestionPolicy(workflow, suggestion, context));
  return {
    attempts: model.attempts,
    latencyMs: Date.now() - startedAt,
    model: model.model,
    suggestions: mergeSuggestions(deterministic, safeModelSuggestions),
    systemFingerprint: model.systemFingerprint,
    usage: model.usage,
  };
};

export const classifyReviewFailure = (error: unknown) => {
  if (error instanceof DeepSeekReviewError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof AiSuggestionPolicyError) {
    return { code: 'MODEL_INVALID_SUGGESTION', message: error.message.slice(0, 240), retryable: true };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/context|allowlist|unsupported|unsafe|workflow|invalid/i.test(message)) {
    return { code: 'INVALID_REVIEW_CONTEXT', message: message.slice(0, 240), retryable: false };
  }
  return { code: 'AI_REVIEW_FAILED', message: 'The AI review could not be completed.', retryable: true };
};

export const retryAt = (attemptCount: number, now = Date.now()) => {
  const delays = [60_000, 5 * 60_000, 30 * 60_000];
  return new Date(now + delays[Math.min(Math.max(0, attemptCount), delays.length - 1)]).toISOString();
};
