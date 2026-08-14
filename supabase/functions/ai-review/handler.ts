import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.51.0';

import { DeepSeekClient } from './deepseek-client.ts';
import { executeReview, classifyReviewFailure, retryAt } from './review-runner.ts';
import {
  assertExactObjectKeys,
  parseDraftProductInput,
  parseUuid,
  parseWorkflow,
} from './review-policy.ts';
import type { ClaimedReviewJob, DraftProductInput } from './types.ts';

type Client = SupabaseClient;

export interface HandlerDependencies {
  anonClient: (authorization: string) => Client;
  deepSeekClient: () => Promise<DeepSeekClient>;
  serviceClient: Client;
  workerSecret?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-storehub-contract, x-storehub-release',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const safeEqual = (left: string, right: string) => {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (!a.length || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
};

const rpcData = async <T>(promise: PromiseLike<{ data: unknown; error: { message?: string } | null }>, publicMessage: string) => {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || publicMessage);
  return data as T;
};

const readJson = async (request: Request) => {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > 64_000) throw new Error('Request is too large.');
  try {
    const source = await request.text();
    if (new TextEncoder().encode(source).length > 64_000) throw new Error('Request is too large.');
    return JSON.parse(source);
  } catch {
    throw new Error('Request body must be valid JSON and no larger than 64 KB.');
  }
};

const requireAdmin = async (request: Request, dependencies: HandlerDependencies) => {
  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) throw new Response(JSON.stringify({ error: 'Please sign in.' }), { status: 401 });
  const userClient = dependencies.anonClient(authorization);
  const user = await userClient.auth.getUser();
  if (user.error || !user.data.user) throw new Response(JSON.stringify({ error: 'Your session has expired.' }), { status: 401 });
  const profile = await dependencies.serviceClient
    .from('profiles')
    .select('id,role,is_active,deleted_at')
    .eq('id', user.data.user.id)
    .single();
  if (profile.error || profile.data?.role !== 'admin' || !profile.data.is_active || profile.data.deleted_at) {
    throw new Response(JSON.stringify({ error: 'Administrator access is required.' }), { status: 403 });
  }
  return { actorId: user.data.user.id, userClient };
};

const parseTriggerType = (value: unknown): ClaimedReviewJob['trigger_type'] => {
  if (value === 'auto' || value === 'draft' || value === 'ensure' || value === 'rerun') return value;
  throw new Error('trigger_type is invalid.');
};

export const normalizeClaimedJobs = (value: unknown): ClaimedReviewJob[] => {
  const rows = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  return rows.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    try {
      const workflow = parseWorkflow(row.workflow);
      const triggerType = parseTriggerType(row.trigger_type);
      const entityId = row.entity_id === null ? null : parseUuid(row.entity_id, 'entity_id');
      const entityVersion = typeof row.entity_version === 'string' ? row.entity_version.trim() : '';
      if (!entityVersion) throw new Error('entity_version is invalid.');
      // A create-product draft intentionally has no persisted business entity.
      // No other claimed workflow may omit its entity identifier.
      if (entityId === null && (workflow !== 'product' || triggerType !== 'draft')) return [];
      return [{
        attempt: Math.max(1, Math.trunc(Number(row.attempt) || 1)),
        context: row.context,
        entity_id: entityId,
        entity_version: entityVersion,
        job_id: parseUuid(row.job_id, 'job_id'),
        run_id: parseUuid(row.run_id, 'run_id'),
        source_hash: typeof row.source_hash === 'string' ? row.source_hash : '',
        store_id: parseUuid(row.store_id, 'store_id'),
        trigger_type: triggerType,
        workflow,
      }];
    } catch {
      return [];
    }
  });
};

const complete = async (client: Client, runId: string, execution: Awaited<ReturnType<typeof executeReview>>) =>
  rpcData(client.rpc('complete_ai_review_run', {
    p_latency_ms: execution.latencyMs,
    p_model: execution.model,
    p_run_id: runId,
    p_suggestions: execution.suggestions,
    p_system_fingerprint: execution.systemFingerprint,
    p_usage: execution.usage,
  }), 'Unable to save AI review results.');

const fail = async (client: Client, runId: string, attemptCount: number, error: unknown) => {
  const failure = classifyReviewFailure(error);
  const saved = await rpcData<Record<string, unknown>>(client.rpc('fail_ai_review_run', {
    p_error_code: failure.code,
    p_error_message: failure.message,
    p_next_retry_at: failure.retryable ? retryAt(attemptCount) : null,
    p_retryable: failure.retryable,
    p_run_id: runId,
  }), 'Unable to save AI review failure.');
  return {
    ...failure,
    retryable: saved.retryable === true,
    status: typeof saved.status === 'string' ? saved.status : saved.retryable === true ? 'queued' : 'failed',
  };
};

const processJobs = async (dependencies: HandlerDependencies, requestedLimit: number) => {
  const limit = Math.max(1, Math.min(10, Math.trunc(requestedLimit || 5)));
  const workerId = `edge-${crypto.randomUUID()}`;
  const claimed = await rpcData<unknown>(dependencies.serviceClient.rpc('claim_ai_review_jobs', {
    p_limit: limit,
    p_worker_id: workerId,
  }), 'Unable to claim AI review jobs.');
  const jobs = normalizeClaimedJobs(claimed);
  const results = await Promise.all(jobs.map(async (job): Promise<Record<string, unknown>> => {
    let execution: Awaited<ReturnType<typeof executeReview>>;
    try {
      execution = await executeReview(await dependencies.deepSeekClient(), job.workflow, job.context);
    } catch (error) {
      const failure = await fail(dependencies.serviceClient, job.run_id, job.attempt, error);
      return { runId: job.run_id, status: failure.retryable ? 'retry_scheduled' : 'failed', errorCode: failure.code };
    }
    try {
      const saved = await complete(dependencies.serviceClient, job.run_id, execution);
      return { runId: job.run_id, status: 'succeeded', suggestionCount: execution.suggestions.length, saved };
    } catch {
      // Completion may have committed even if the network response was lost.
      // Do not overwrite a possibly completed run with fail_ai_review_run; the
      // database lease safely reclaims it if completion did not commit.
      return { runId: job.run_id, status: 'persistence_unknown', errorCode: 'AI_REVIEW_PERSISTENCE_UNKNOWN' };
    }
  }));
  return { claimed: jobs.length, results, status: results.some((entry) => entry.status !== 'succeeded') ? 'partial' : 'succeeded' };
};

const drainQueue = async (dependencies: HandlerDependencies, requestedLimit: number) => {
  const maximum = Math.max(1, Math.min(20, Math.trunc(requestedLimit || 10)));
  const results: Record<string, unknown>[] = [];
  let claimed = 0;
  while (claimed < maximum) {
    const batch = await processJobs(dependencies, Math.min(10, maximum - claimed));
    claimed += batch.claimed;
    results.push(...batch.results);
    if (batch.claimed === 0) break;
  }
  return {
    claimed,
    results,
    status: results.some((entry) => entry.status !== 'succeeded') ? 'partial' : 'succeeded',
  };
};

const authorizeWorker = async (request: Request, dependencies: HandlerDependencies) => {
  const workerToken = request.headers.get('x-storehub-ai-worker-secret')?.trim() ?? '';
  if (dependencies.workerSecret && safeEqual(workerToken, dependencies.workerSecret)) return true;
  const cronToken = request.headers.get('x-storehub-cron-secret')?.trim() ?? '';
  if (!cronToken) return false;
  const verification = await dependencies.serviceClient.rpc('verify_ai_review_cron_token', { p_token: cronToken });
  return !verification.error && verification.data === true;
};

const listProviderModels = async (dependencies: HandlerDependencies) => {
  const config = await rpcData<{ base_url?: string; api_key?: string }>(
    dependencies.serviceClient.rpc('service_get_ai_provider_config'),
    'Unable to load AI provider configuration.',
  );
  const baseUrl = (config.base_url || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
  const apiKey = config.api_key?.trim();
  if (!apiKey) throw new Error('尚未配置 API Key，无法获取模型列表。');
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`列出模型失败：HTTP ${response.status}`);
  const payload = (await response.json()) as { data?: Array<{ id?: string }> };
  return (Array.isArray(payload.data) ? payload.data : [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
};

const draftToRpc = (draft: DraftProductInput) => ({
  categoryCode: draft.categoryCode,
  countUnit: draft.countUnit,
  name: draft.name,
  spec: draft.spec,
});

export const createAiReviewHandler = (dependencies: HandlerDependencies) => async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = assertExactObjectKeys(await readJson(request), ['action', 'storeId', 'workflow', 'entityId', 'runId', 'structured', 'limit']);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid request.' }, 400);
  }
  const action = payload.action;

  try {
    if (action === 'process-queue' || action === 'drain') {
      assertExactObjectKeys(payload, ['action', 'limit']);
      if (!await authorizeWorker(request, dependencies)) return json({ error: 'Worker authentication failed.' }, 401);
      return json(action === 'drain'
        ? await drainQueue(dependencies, Number(payload.limit) || 10)
        : await processJobs(dependencies, Number(payload.limit) || 5));
    }

    const { userClient } = await requireAdmin(request, dependencies);
    if (action === 'list-models') {
      assertExactObjectKeys(payload, ['action']);
      const models = await listProviderModels(dependencies);
      return json({ models });
    }
    if (action === 'ensure') {
      assertExactObjectKeys(payload, ['action', 'storeId', 'workflow', 'entityId']);
      const workflow = parseWorkflow(payload.workflow);
      const storeId = parseUuid(payload.storeId, 'storeId');
      const entityId = parseUuid(payload.entityId, 'entityId');
      const data = await rpcData(userClient.rpc('admin_ensure_ai_review', {
        p_entity_id: entityId,
        p_store_id: storeId,
        p_workflow: workflow,
      }), 'Unable to queue AI review.');
      return json({ status: 'queued', review: data }, 202);
    }
    if (action === 'rerun') {
      assertExactObjectKeys(payload, ['action', 'runId']);
      const runId = parseUuid(payload.runId, 'runId');
      const data = await rpcData(userClient.rpc('admin_rerun_ai_review', { p_run_id: runId }), 'Unable to rerun AI review.');
      return json({ status: 'queued', review: data }, 202);
    }
    if (action === 'check-draft') {
      assertExactObjectKeys(payload, ['action', 'storeId', 'workflow', 'structured']);
      if (payload.workflow !== 'product') throw new Error('Draft checking only supports the product workflow.');
      const storeId = parseUuid(payload.storeId, 'storeId');
      const draft = parseDraftProductInput(payload.structured);
      const started = await rpcData<Record<string, unknown>>(userClient.rpc('admin_ai_check_product_draft', {
        p_draft: draftToRpc(draft),
        p_product_id: draft.productId ?? null,
        p_store_id: storeId,
      }), 'Unable to start product draft review.');
      if (started.status === 'disabled') {
        return json({ runId: null, status: 'disabled', error: 'AI 自动分析已关闭', errorCode: 'AI_AUTO_DISABLED' });
      }
      const runId = parseUuid(started.run_id, 'run_id');
      const workerId = `draft-${crypto.randomUUID()}`;
      const claimed = await rpcData<unknown>(dependencies.serviceClient.rpc('claim_ai_review_run', {
        p_run_id: runId,
        p_worker_id: workerId,
      }), 'Unable to claim product draft review.');
      const [draftJob] = normalizeClaimedJobs(claimed);
      if (!draftJob || draftJob.run_id !== runId || draftJob.store_id !== storeId || draftJob.workflow !== 'product') {
        throw new Error('Product draft review could not be claimed safely.');
      }
      let execution: Awaited<ReturnType<typeof executeReview>>;
      try {
        execution = await executeReview(await dependencies.deepSeekClient(), 'product', draftJob.context);
      } catch (error) {
        const failure = await fail(dependencies.serviceClient, runId, draftJob.attempt, error);
        return json({ runId, status: failure.retryable ? 'retry_scheduled' : 'failed', error: failure.message, errorCode: failure.code, retryable: failure.retryable });
      }
      try {
        const saved = await complete(dependencies.serviceClient, runId, execution);
        return json({
          runId,
          status: 'succeeded',
          suggestionCount: execution.suggestions.length,
          suggestions: execution.suggestions,
          review: saved,
        });
      } catch {
        return json({
          runId,
          status: 'persistence_unknown',
          error: 'The AI review result is still being confirmed. Please refresh before rerunning.',
          errorCode: 'AI_REVIEW_PERSISTENCE_UNKNOWN',
          retryable: true,
        }, 503);
      }
    }
    return json({ error: 'Unknown AI review action.' }, 400);
  } catch (error) {
    if (error instanceof Response) {
      return new Response(error.body, { status: error.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const failure = classifyReviewFailure(error);
    const status = failure.code === 'INVALID_REVIEW_CONTEXT' ? 400
      : failure.code === 'MODEL_AUTH_FAILED' || failure.code === 'MODEL_NOT_CONFIGURED' ? 503
      : failure.retryable ? 503 : 400;
    return json({ error: failure.message, errorCode: failure.code, retryable: failure.retryable }, status);
  }
};
