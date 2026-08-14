import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '../types/database';

type Client = SupabaseClient<Database>;
type RpcResult = Promise<{ data: unknown; error: { message: string } | null }>;

export type AiWorkflow = 'product' | 'product_creation_request' | 'arrival_report' | 'inventory' | 'order' | 'v2_task';
export type AiRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped' | 'stale';
export type AiSeverity = 'info' | 'warning' | 'critical';
export type AiSuggestionStatus = 'pending' | 'applied_to_draft' | 'ignored' | 'stale';

export interface AiReviewRun {
  completedAt: string | null;
  createdAt: string;
  entityId: string;
  errorMessage: string | null;
  id: string;
  maxSeverity: AiSeverity | null;
  pendingCount: number;
  status: AiRunStatus;
  storeId: string;
  storeName: string;
  sourceHash: string;
  suggestionCount: number;
  summary: string;
  workflow: AiWorkflow;
}

export interface AiSuggestion {
  actionType: string;
  confidence: number | null;
  currentValue: Json;
  draftPatch: Record<string, Json | undefined>;
  fieldPath: string | null;
  id: string;
  issueType: string;
  rationale: string;
  severity: AiSeverity;
  sourceHash: string;
  status: AiSuggestionStatus;
  suggestedValue: Json;
  title: string;
}

export interface AiReviewDetail {
  run: AiReviewRun;
  suggestions: AiSuggestion[];
}

export interface AiReviewFilters {
  limit?: number;
  offset?: number;
  status?: AiRunStatus | '';
  storeIds?: string[];
  workflow?: AiWorkflow | '';
}

export interface AiReviewList {
  items: AiReviewRun[];
  total: number;
}

export interface AiSuggestionActionResult {
  actionType: string | null;
  draftPatch: Record<string, Json | undefined>;
  runId: string;
  sourceHash: string | null;
  status: AiSuggestionStatus;
  suggestionId: string;
  targetEntityId: string | null;
  targetStoreId: string | null;
  targetEntityType: string | null;
}

export interface AiPilotStoreScope {
  enabled: boolean;
  storeId: string;
  storeName: string;
  workflowFlags: Partial<Record<AiWorkflow, boolean>>;
}

export interface AiPilotSettings {
  adminApplyEnabled: boolean;
  adminVisible: boolean;
  autoRunEnabled: boolean;
  dailyRunLimit?: number;
  globalEnabled: boolean;
  pilotStores: AiPilotStoreScope[];
  workflowFlags: Partial<Record<AiWorkflow, boolean>>;
}

export interface AiProviderConfig {
  apiKeyConfigured: boolean;
  apiKeyLast4: string | null;
  baseUrl: string;
  configuredAt: string;
  model: string;
}

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};

const textValue = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const nullableText = (value: unknown) => typeof value === 'string' && value ? value : null;
const numberValue = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const jsonValue = (value: unknown): Json => value as Json;

const runStatus = (value: unknown): AiRunStatus => (
  ['queued', 'running', 'completed', 'failed', 'skipped', 'stale'].includes(String(value))
    ? value as AiRunStatus
    : 'queued'
);

const workflowValue = (value: unknown): AiWorkflow => (
  ['product', 'product_creation_request', 'arrival_report', 'inventory', 'order', 'v2_task'].includes(String(value))
    ? value as AiWorkflow
    : 'product'
);

const severityValue = (value: unknown): AiSeverity => value === 'critical' ? 'critical' : value === 'warning' ? 'warning' : 'info';
const suggestionStatusValue = (value: unknown): AiSuggestionStatus => (
  ['pending', 'applied_to_draft', 'ignored', 'stale'].includes(String(value))
    ? value as AiSuggestionStatus
    : 'pending'
);

const workflowFlagsValue = (value: unknown): Partial<Record<AiWorkflow, boolean>> => {
  const row = asRecord(value);
  return Object.fromEntries(Object.entries(row).filter(([key, enabled]) => (
    ['product', 'product_creation_request', 'arrival_report', 'inventory', 'order', 'v2_task'].includes(key)
    && typeof enabled === 'boolean'
  ))) as Partial<Record<AiWorkflow, boolean>>;
};

export const loadAiPilotSettings = async (client: Client): Promise<AiPilotSettings> => {
  const data = asRecord(await callRpc(client, 'admin_get_ai_settings'));
  return {
    adminApplyEnabled: data.admin_apply_enabled === true,
    adminVisible: data.admin_visible === true,
    autoRunEnabled: data.auto_run_enabled === true,
    dailyRunLimit: numberValue(data.daily_run_limit, 200),
    globalEnabled: data.global_enabled === true,
    pilotStores: (Array.isArray(data.pilot_stores) ? data.pilot_stores : []).flatMap((value) => {
      const row = asRecord(value);
      const storeId = textValue(row.store_id);
      if (!storeId) return [];
      return [{
        enabled: row.enabled === true,
        storeId,
        storeName: textValue(row.store_name, '试点门店'),
        workflowFlags: workflowFlagsValue(row.workflow_flags),
      }];
    }),
    workflowFlags: workflowFlagsValue(data.workflow_flags),
  };
};

export const loadAiProviderConfig = async (client: Client): Promise<AiProviderConfig> => {
  const data = asRecord(await callRpc(client, 'admin_get_ai_provider_config'));
  return {
    apiKeyConfigured: data.api_key_configured === true,
    apiKeyLast4: nullableText(data.api_key_last4),
    baseUrl: textValue(data.base_url),
    configuredAt: textValue(data.configured_at),
    model: textValue(data.model, 'deepseek-v4-pro'),
  };
};

export const saveAiProviderConfig = async (
  client: Client,
  input: { baseUrl: string; model: string; apiKey?: string | null; clearApiKey?: boolean },
): Promise<AiProviderConfig> => {
  const data = asRecord(await callRpc(client, 'admin_save_ai_provider_config', {
    p_api_key: input.apiKey ?? null,
    p_base_url: input.baseUrl,
    p_clear_api_key: input.clearApiKey === true,
    p_model: input.model,
  }));
  return {
    apiKeyConfigured: data.api_key_configured === true,
    apiKeyLast4: nullableText(data.api_key_last4),
    baseUrl: textValue(data.base_url),
    configuredAt: textValue(data.configured_at),
    model: textValue(data.model, 'deepseek-v4-pro'),
  };
};

export const listAiProviderModels = async (client: Client): Promise<string[]> => {
  const { data, error } = await client.functions.invoke('ai-review', {
    body: { action: 'list-models' },
  });
  if (error) throw new Error(error.message);
  const payload = asRecord(data);
  return (Array.isArray(payload.models) ? payload.models : [])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
};

export const saveAiSettings = async (
  client: Client,
  input: {
    adminApplyEnabled: boolean;
    adminVisible: boolean;
    autoRunEnabled: boolean;
    dailyRunLimit: number;
    globalEnabled: boolean;
    workflowFlags: Partial<Record<AiWorkflow, boolean>>;
  },
): Promise<AiPilotSettings> => {
  const data = asRecord(await callRpc(client, 'admin_save_ai_settings', {
    p_admin_apply_enabled: input.adminApplyEnabled,
    p_admin_visible: input.adminVisible,
    p_auto_run_enabled: input.autoRunEnabled,
    p_daily_run_limit: input.dailyRunLimit,
    p_global_enabled: input.globalEnabled,
    p_workflow_flags: input.workflowFlags,
  }));
  return {
    adminApplyEnabled: data.admin_apply_enabled === true,
    adminVisible: data.admin_visible === true,
    autoRunEnabled: data.auto_run_enabled === true,
    dailyRunLimit: numberValue(data.daily_run_limit, 200),
    globalEnabled: data.global_enabled === true,
    pilotStores: (Array.isArray(data.pilot_stores) ? data.pilot_stores : []).flatMap((value) => {
      const row = asRecord(value);
      const storeId = textValue(row.store_id);
      if (!storeId) return [];
      return [{
        enabled: row.enabled === true,
        storeId,
        storeName: textValue(row.store_name, '试点门店'),
        workflowFlags: workflowFlagsValue(row.workflow_flags),
      }];
    }),
    workflowFlags: workflowFlagsValue(data.workflow_flags),
  };
};

export const normalizeAiReviewRun = (value: unknown): AiReviewRun => {
  const row = asRecord(value);
  const id = textValue(row.id ?? row.run_id);
  return {
    completedAt: nullableText(row.completed_at),
    createdAt: textValue(row.created_at, new Date(0).toISOString()),
    entityId: textValue(row.entity_id),
    errorMessage: nullableText(row.error_message ?? row.last_error),
    id,
    maxSeverity: row.max_severity ? severityValue(row.max_severity) : null,
    pendingCount: numberValue(row.pending_count),
    status: runStatus(row.status),
    storeId: textValue(row.store_id),
    storeName: textValue(row.store_name ?? row.store_name_snapshot, '试点门店'),
    sourceHash: textValue(row.source_hash),
    suggestionCount: numberValue(row.suggestion_count),
    summary: textValue(row.summary, 'AI 结构化数据检查'),
    workflow: workflowValue(row.workflow),
  };
};

export const normalizeAiSuggestion = (value: unknown): AiSuggestion => {
  const row = asRecord(value);
  const draftPatch = asRecord(row.draft_patch) as Record<string, Json | undefined>;
  return {
    actionType: textValue(row.action_type, 'review'),
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    currentValue: jsonValue(row.current_value ?? null),
    draftPatch,
    fieldPath: nullableText(row.field_path),
    id: textValue(row.id ?? row.suggestion_id),
    issueType: textValue(row.issue_type, 'general'),
    rationale: textValue(row.rationale ?? row.reason, '请结合实际业务记录人工复核。'),
    severity: severityValue(row.severity),
    sourceHash: textValue(row.source_hash),
    status: suggestionStatusValue(row.status),
    suggestedValue: jsonValue(row.suggested_value ?? null),
    title: textValue(row.title, '建议复核'),
  };
};

const callRpc = async (client: Client, name: string, args?: Record<string, unknown>) => {
  const rpc = client.rpc.bind(client) as unknown as (
    fn: string,
    input?: Record<string, unknown>,
  ) => RpcResult;
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
};

export const listAiReviews = async (client: Client, filters: AiReviewFilters = {}): Promise<AiReviewList> => {
  const data = asRecord(await callRpc(client, 'admin_ai_list_reviews', {
    p_limit: filters.limit ?? 50,
    p_offset: filters.offset ?? 0,
    p_status: filters.status || null,
    p_store_ids: filters.storeIds?.length ? filters.storeIds : null,
    p_workflow: filters.workflow || null,
  }));
  const rows = Array.isArray(data.items) ? data.items : [];
  return { items: rows.map(normalizeAiReviewRun), total: numberValue(data.total, rows.length) };
};

export const loadAiReview = async (client: Client, runId: string): Promise<AiReviewDetail> => {
  const data = asRecord(await callRpc(client, 'admin_ai_get_review', { p_run_id: runId }));
  return {
    run: normalizeAiReviewRun(data.run ?? data),
    suggestions: (Array.isArray(data.suggestions) ? data.suggestions : []).map(normalizeAiSuggestion),
  };
};

export const ensureAiReview = async (
  client: Client,
  input: { entityId: string; storeId: string; workflow: AiWorkflow },
) => normalizeAiReviewRun(await callRpc(client, 'admin_ensure_ai_review', {
  p_entity_id: input.entityId,
  p_store_id: input.storeId,
  p_workflow: input.workflow,
}));

export const rerunAiReview = async (client: Client, runId: string) => normalizeAiReviewRun(
  await callRpc(client, 'admin_rerun_ai_review', { p_run_id: runId }),
);

export const skipAiReview = async (client: Client, runId: string, reason = '管理员跳过等待') => normalizeAiReviewRun(
  await callRpc(client, 'admin_ai_skip_review', { p_reason: reason, p_run_id: runId }),
);

export const actOnAiSuggestion = async (
  client: Client,
  suggestionId: string,
  action: 'apply_to_draft' | 'ignore' | 'restore',
  note: string | null = null,
  expectedSourceHash: string | null = null,
): Promise<AiSuggestionActionResult> => {
  const data = asRecord(await callRpc(client, 'admin_ai_act_on_suggestion', {
    p_action: action,
    p_expected_source_hash: expectedSourceHash,
    p_note: note,
    p_suggestion_id: suggestionId,
  }));
  const target = asRecord(data.target);
  return {
    actionType: nullableText(data.action_type),
    draftPatch: asRecord(data.draft_patch) as Record<string, Json | undefined>,
    runId: textValue(data.run_id),
    sourceHash: nullableText(data.source_hash ?? target.source_hash),
    status: suggestionStatusValue(data.status),
    suggestionId: textValue(data.suggestion_id, suggestionId),
    targetEntityId: nullableText(data.target_entity_id ?? target.entity_id),
    targetEntityType: nullableText(data.target_entity_type ?? target.workflow),
    targetStoreId: nullableText(data.target_store_id ?? target.store_id),
  };
};

export const checkAiProductDraft = async (
  client: Client,
  input: { draft: Record<string, Json | undefined>; productId?: string | null; storeId: string },
): Promise<AiReviewDetail> => {
  const { data: response, error } = await client.functions.invoke('ai-review', {
    body: {
      action: 'check-draft',
      storeId: input.storeId,
      structured: {
        categoryCode: textValue(input.draft.category_code),
        countUnit: textValue(input.draft.count_unit),
        name: textValue(input.draft.name),
        ...(input.productId ? { productId: input.productId } : {}),
        spec: textValue(input.draft.spec),
      },
      workflow: 'product',
    },
  });
  if (error) throw new Error(error.message);
  const data = asRecord(response);
  if (data.status === 'failed' || data.error) throw new Error(textValue(data.error, 'AI 草稿检查失败。'));
  const runId = textValue(data.runId ?? asRecord(data.review).run_id);
  if (!runId) throw new Error('AI 草稿检查未返回检查编号。');
  return loadAiReview(client, runId);
};
