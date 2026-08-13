export const AI_REVIEW_WORKFLOWS = [
  'product',
  'product_creation_request',
  'arrival_report',
  'inventory',
  'order',
  'v2_task',
] as const;

export type AiReviewWorkflow = (typeof AI_REVIEW_WORKFLOWS)[number];
export type SuggestionSeverity = 'info' | 'warning' | 'critical';

export interface AiReviewContext {
  [key: string]: JsonValue;
  workflow: AiReviewWorkflow;
}

export type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AiSuggestion {
  action_payload: Record<string, JsonValue>;
  action_type: string;
  code: string;
  confidence: number;
  current_value: JsonValue;
  explanation: string;
  field_path: string;
  severity: SuggestionSeverity;
  suggested_value: JsonValue;
  title: string;
}

export interface DeterministicFinding extends AiSuggestion {
  source: 'rule';
}

export interface ClaimedReviewJob {
  attempt: number;
  context: unknown;
  entity_id: string | null;
  entity_version: string;
  job_id: string;
  run_id: string;
  source_hash: string;
  store_id: string;
  trigger_type: 'auto' | 'draft' | 'ensure' | 'rerun';
  workflow: AiReviewWorkflow;
}

export interface ModelUsage {
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  prompt_tokens?: number;
  total_tokens?: number;
}

export interface ModelReviewResult {
  attempts: number;
  model: string;
  suggestions: AiSuggestion[];
  systemFingerprint: string | null;
  usage: ModelUsage;
}

export interface DraftProductInput {
  categoryCode: string;
  countUnit: string;
  name: string;
  productId?: string;
  spec: string;
}

export const isAiReviewWorkflow = (value: unknown): value is AiReviewWorkflow =>
  typeof value === 'string' && (AI_REVIEW_WORKFLOWS as readonly string[]).includes(value);
