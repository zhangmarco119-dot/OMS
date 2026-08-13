import { DeepSeekClient } from './deepseek-client.ts';
import { createAiReviewHandler, normalizeClaimedJobs, type HandlerDependencies } from './handler.ts';

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

const assert: (condition: unknown, message?: string) => asserts condition = (condition, message = 'Assertion failed') => {
  if (!condition) throw new Error(message);
};

const jsonRequest = (body: unknown, headers: Record<string, string> = {}) => new Request('https://example.test/ai-review', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const modelClient = (status = 200) => new DeepSeekClient({
  apiKey: 'unit-test-secret',
  fetchImpl: async () => status === 200 ? new Response(JSON.stringify({
    model: 'deepseek-v4-pro',
    choices: [{ finish_reason: 'stop', message: { content: '{"suggestions":[]}' } }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }) : new Response('provider secret must not be exposed', { status }),
});

const dependencies = (
  profileRole: 'admin' | 'staff' = 'admin',
  options: { completeFails?: boolean; cronTokenValid?: boolean; failRetryable?: boolean; modelStatus?: number; queueJob?: boolean } = {},
) => {
  const rpcCalls: Array<{ args: Record<string, unknown>; name: string }> = [];
  let queueJobClaimed = false;
  const userClient = {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ args, name });
      if (name === 'admin_ai_check_product_draft') return { data: { run_id: RUN_ID, status: 'queued' }, error: null };
      return { data: {}, error: null };
    },
  };
  const profileBuilder = {
    select() { return this; },
    eq() { return this; },
    async single() {
      return { data: { id: USER_ID, role: profileRole, is_active: true, deleted_at: null }, error: null };
    },
  };
  const serviceClient = {
    from: () => profileBuilder,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ args, name });
      if (name === 'claim_ai_review_run') return { data: {
        attempt: 1,
        context: {
          workflow: 'product', storeId: STORE_ID, entityId: null, sourceVersion: 'draft-hash',
          product: { productId: null, label: '安佳淡奶油', spec: '1L/盒', countUnit: '盒', categoryCode: 'other_food', isActive: true },
          catalog: [],
        },
        entity_id: null, entity_version: 'draft-hash', job_id: JOB_ID, run_id: RUN_ID,
        source_hash: 'draft-hash', store_id: STORE_ID, trigger_type: 'draft', workflow: 'product',
      }, error: null };
      if (name === 'claim_ai_review_jobs') {
        if (!options.queueJob || queueJobClaimed) return { data: [], error: null };
        queueJobClaimed = true;
        return { data: [{
          attempt: 1,
          context: {
            workflow: 'product', storeId: STORE_ID, entityId: RUN_ID, sourceVersion: '1',
            product: { productId: RUN_ID, label: '安佳淡奶油', spec: '1L/盒', countUnit: '盒', categoryCode: 'other_food', isActive: true },
            catalog: [],
          },
          entity_id: RUN_ID, entity_version: '1', job_id: JOB_ID, run_id: RUN_ID,
          source_hash: 'source-hash', store_id: STORE_ID, trigger_type: 'auto', workflow: 'product',
        }], error: null };
      }
      if (name === 'complete_ai_review_run') return options.completeFails
        ? { data: null, error: { message: 'ambiguous completion response' } }
        : { data: { run_id: RUN_ID, status: 'completed', suggestion_count: 0 }, error: null };
      if (name === 'fail_ai_review_run') return {
        data: { run_id: RUN_ID, status: options.failRetryable ? 'queued' : 'failed', retryable: options.failRetryable === true },
        error: null,
      };
      if (name === 'verify_ai_review_cron_token') return { data: options.cronTokenValid === true, error: null };
      return { data: {}, error: null };
    },
  };
  return {
    dependencies: {
      anonClient: () => userClient as unknown as HandlerDependencies['serviceClient'],
      deepSeekClient: () => modelClient(options.modelStatus),
      serviceClient: serviceClient as unknown as HandlerDependencies['serviceClient'],
      workerSecret: 'worker-test-secret',
    } satisfies HandlerDependencies,
    rpcCalls,
  };
};

Deno.test('check-draft authenticates admin, claims the exact run and completes it', async () => {
  const fixture = dependencies();
  const response = await createAiReviewHandler(fixture.dependencies)(jsonRequest({
    action: 'check-draft', storeId: STORE_ID, workflow: 'product',
    structured: { name: '安佳淡奶油', spec: '1L/盒', countUnit: '盒', categoryCode: 'other_food' },
  }, { Authorization: 'Bearer unit-test-jwt' }));
  const body = await response.json();
  assert(response.status === 200);
  assert(body.runId === RUN_ID && body.status === 'succeeded');
  assert(fixture.rpcCalls.some((call) => call.name === 'admin_ai_check_product_draft'));
  assert(fixture.rpcCalls.some((call) => call.name === 'admin_ai_check_product_draft' && call.args.p_product_id === null));
  assert(fixture.rpcCalls.some((call) => call.name === 'claim_ai_review_run' && call.args.p_run_id === RUN_ID));
  assert(fixture.rpcCalls.some((call) => call.name === 'complete_ai_review_run'));
});

Deno.test('claimed create-product draft preserves a null entity_id instead of dropping the job', () => {
  const [job] = normalizeClaimedJobs({
    attempt: 1,
    context: {
      workflow: 'product', storeId: STORE_ID, entityId: null, sourceVersion: 'draft-hash',
      product: { productId: null, label: '新货品', spec: '500g/袋', countUnit: '袋', categoryCode: 'other_food', isActive: true },
      catalog: [],
    },
    entity_id: null,
    entity_version: 'draft-hash',
    job_id: JOB_ID,
    run_id: RUN_ID,
    source_hash: 'draft-hash',
    store_id: STORE_ID,
    trigger_type: 'draft',
    workflow: 'product',
  });
  assert(job !== undefined, 'The claimed draft job was incorrectly filtered out.');
  assert(job.entity_id === null);
  assert(job.entity_version === 'draft-hash');
});

Deno.test('null entity_id remains invalid outside a create-product draft', () => {
  const jobs = normalizeClaimedJobs({
    attempt: 1,
    context: {},
    entity_id: null,
    entity_version: '1',
    job_id: JOB_ID,
    run_id: RUN_ID,
    source_hash: 'source-hash',
    store_id: STORE_ID,
    trigger_type: 'ensure',
    workflow: 'arrival_report',
  });
  assert(jobs.length === 0);
});

Deno.test('staff cannot use administrator actions', async () => {
  const fixture = dependencies('staff');
  const response = await createAiReviewHandler(fixture.dependencies)(jsonRequest({
    action: 'ensure', storeId: STORE_ID, workflow: 'product', entityId: RUN_ID,
  }, { Authorization: 'Bearer unit-test-jwt' }));
  assert(response.status === 403);
  assert(!fixture.rpcCalls.some((call) => call.name === 'admin_ensure_ai_review'));
});

Deno.test('worker secret can process an empty queue without a user JWT', async () => {
  const fixture = dependencies();
  const response = await createAiReviewHandler(fixture.dependencies)(jsonRequest(
    { action: 'process-queue', limit: 5 },
    { 'x-storehub-ai-worker-secret': 'worker-test-secret' },
  ));
  const body = await response.json();
  assert(response.status === 200);
  assert(body.claimed === 0 && body.status === 'succeeded');
});

Deno.test('CORS permits administrator app headers but not server-only worker secrets', async () => {
  const fixture = dependencies();
  const response = await createAiReviewHandler(fixture.dependencies)(new Request('https://example.test/ai-review', { method: 'OPTIONS' }));
  const headers = response.headers.get('Access-Control-Allow-Headers') ?? '';
  assert(response.status === 200);
  assert(headers.includes('authorization'));
  assert(headers.includes('x-storehub-contract') && headers.includes('x-storehub-release'));
  assert(!headers.includes('x-storehub-ai-worker-secret') && !headers.includes('x-storehub-cron-secret'));
  assert(response.headers.get('Cache-Control') === 'no-store');
  assert(response.headers.get('X-Content-Type-Options') === 'nosniff');
});

Deno.test('invalid worker token is rejected without claiming the queue or echoing the token', async () => {
  const fixture = dependencies();
  const secret = 'wrong-worker-secret';
  const response = await createAiReviewHandler(fixture.dependencies)(jsonRequest(
    { action: 'process-queue', limit: 5 },
    { 'x-storehub-ai-worker-secret': secret },
  ));
  assert(response.status === 401);
  assert(!(await response.text()).includes(secret));
  assert(!fixture.rpcCalls.some((call) => call.name === 'claim_ai_review_jobs'));
});

Deno.test('cron token is independently verified when the worker header is wrong', async () => {
  const fixture = dependencies('admin', { cronTokenValid: true });
  const response = await createAiReviewHandler(fixture.dependencies)(jsonRequest(
    { action: 'process-queue', limit: 5 },
    { 'x-storehub-ai-worker-secret': 'wrong', 'x-storehub-cron-secret': 'valid-cron-token' },
  ));
  assert(response.status === 200);
  assert(fixture.rpcCalls.some((call) => call.name === 'verify_ai_review_cron_token' && call.args.p_token === 'valid-cron-token'));
});

Deno.test('model failure uses the database effective retry decision', async () => {
  const fixture = dependencies('admin', { failRetryable: false, modelStatus: 401 });
  const response = await createAiReviewHandler(fixture.dependencies)(jsonRequest({
    action: 'check-draft', storeId: STORE_ID, workflow: 'product',
    structured: { name: '安佳淡奶油', spec: '1L/盒', countUnit: '盒', categoryCode: 'other_food' },
  }, { Authorization: 'Bearer unit-test-jwt' }));
  const body = await response.json();
  assert(body.status === 'failed' && body.retryable === false);
  assert(body.errorCode === 'MODEL_AUTH_FAILED');
  assert(fixture.rpcCalls.some((call) => call.name === 'fail_ai_review_run'));
});

Deno.test('ambiguous completion does not overwrite a possibly committed run with failure', async () => {
  const fixture = dependencies('admin', { completeFails: true });
  const response = await createAiReviewHandler(fixture.dependencies)(jsonRequest({
    action: 'check-draft', storeId: STORE_ID, workflow: 'product',
    structured: { name: '安佳淡奶油', spec: '1L/盒', countUnit: '盒', categoryCode: 'other_food' },
  }, { Authorization: 'Bearer unit-test-jwt' }));
  const body = await response.json();
  assert(response.status === 503 && body.status === 'persistence_unknown');
  assert(!fixture.rpcCalls.some((call) => call.name === 'fail_ai_review_run'));
});

Deno.test('drain reports retry-scheduled jobs as partial instead of hiding them as succeeded', async () => {
  const fixture = dependencies('admin', { failRetryable: true, modelStatus: 401, queueJob: true });
  const response = await createAiReviewHandler(fixture.dependencies)(jsonRequest(
    { action: 'drain', limit: 1 },
    { 'x-storehub-ai-worker-secret': 'worker-test-secret' },
  ));
  const body = await response.json();
  assert(response.status === 200);
  assert(body.status === 'partial' && body.results[0].status === 'retry_scheduled');
});
