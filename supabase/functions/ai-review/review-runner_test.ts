import { DeepSeekClient } from './deepseek-client.ts';
import { executeReview, classifyReviewFailure } from './review-runner.ts';
import { AiSuggestionPolicyError, enforceSuggestionPolicy, sanitizeReviewContext } from './review-policy.ts';
import type { AiSuggestion } from './types.ts';

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const EXISTING_PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '44444444-4444-4444-8444-444444444444';

const assert: (condition: unknown, message?: string) => asserts condition = (condition, message = 'Assertion failed') => {
  if (!condition) throw new Error(message);
};

const emptyModel = () => new DeepSeekClient({
  apiKey: 'unit-test-secret',
  fetchImpl: async () => new Response(JSON.stringify({
    model: 'deepseek-v4-pro',
    choices: [{ finish_reason: 'stop', message: { content: '{"suggestions":[]}' } }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
});

const suggestion = (overrides: Partial<AiSuggestion>): AiSuggestion => ({
  action_payload: {},
  action_type: 'review',
  code: 'review_item',
  confidence: 0.9,
  current_value: null,
  explanation: '请根据结构化记录人工复核。',
  field_path: '',
  severity: 'warning',
  suggested_value: null,
  title: '建议复核',
  ...overrides,
});

Deno.test('deterministic duplicate product emits an adoptable DB-allowlisted action', async () => {
  const result = await executeReview(emptyModel(), 'product', {
    workflow: 'product',
    storeId: STORE_ID,
    entityId: null,
    sourceVersion: 'draft-hash',
    product: { productId: null, label: '草莓果泥', spec: '1kg/袋', countUnit: '袋', categoryCode: 'other_food', isActive: true },
    catalog: [{ productId: EXISTING_PRODUCT_ID, label: ' 草莓果泥 ', spec: '1kg/袋', countUnit: '袋', categoryCode: 'other_food', isActive: true }],
  });
  const duplicate = result.suggestions.find((entry) => entry.code === 'duplicate_product_exact');
  assert(duplicate !== undefined);
  assert(duplicate.severity === 'critical');
  assert(duplicate.action_type === 'use_existing_product');
  assert(JSON.stringify(duplicate.action_payload) === JSON.stringify({ product_id: EXISTING_PRODUCT_ID }));
});

Deno.test('model actions must match workflow, payload and current-context allowlists', () => {
  const productContext = sanitizeReviewContext('product', {
    workflow: 'product', storeId: STORE_ID, entityId: null, sourceVersion: 'draft-hash',
    product: { productId: null, label: '新货品', spec: '1kg/袋', countUnit: '袋', categoryCode: 'other_food', isActive: true },
    catalog: [{ productId: EXISTING_PRODUCT_ID, label: '已有货品', spec: '1kg/袋', countUnit: '袋', categoryCode: 'other_food', isActive: true }],
  });
  assert(enforceSuggestionPolicy('product', suggestion({
    action_type: 'use_existing_product', action_payload: { product_id: EXISTING_PRODUCT_ID },
  }), productContext).action_type === 'use_existing_product');

  const orderContext = sanitizeReviewContext('order', {
    workflow: 'order', storeId: STORE_ID, entityId: RUN_ID, sourceVersion: '1',
    task: { taskId: RUN_ID, taskType: 'order', items: [{ itemId: ITEM_ID, productId: EXISTING_PRODUCT_ID, label: '已有货品', spec: '1kg/袋', countUnit: '袋', quantity: 1, itemStatus: 'completed', isExtraItem: false, sortOrder: 1 }] },
    history: [],
  });
  assert(enforceSuggestionPolicy('order', suggestion({
    action_type: 'edit_quantity', action_payload: { item_id: ITEM_ID, quantity: 2 },
  }), orderContext).action_type === 'edit_quantity');
  assert(enforceSuggestionPolicy('order', suggestion({
    action_type: 'mark_no_order_needed', action_payload: { item_id: ITEM_ID },
  }), orderContext).action_type === 'mark_no_order_needed');

  for (const invalid of [
    suggestion({ action_type: 'use_existing_product', action_payload: {} }),
    suggestion({ action_type: 'use_existing_product', action_payload: { product_id: '55555555-5555-4555-8555-555555555555' } }),
    suggestion({ action_type: 'edit_quantity', action_payload: { item_id: ITEM_ID, quantity: -1 } }),
    suggestion({ action_type: 'mark_no_order_needed', action_payload: { item_id: '55555555-5555-4555-8555-555555555555' } }),
  ]) {
    let rejected = false;
    try {
      enforceSuggestionPolicy(invalid.action_type === 'use_existing_product' ? 'product' : 'order', invalid, invalid.action_type === 'use_existing_product' ? productContext : orderContext);
    } catch (error) {
      rejected = error instanceof AiSuggestionPolicyError;
      const classified = classifyReviewFailure(error);
      assert(classified.code === 'MODEL_INVALID_SUGGESTION' && classified.retryable);
    }
    assert(rejected);
  }
});

Deno.test('deterministic suggestions cannot bypass the same action target policy', async () => {
  let modelCalled = false;
  const client = new DeepSeekClient({
    apiKey: 'unit-test',
    fetchImpl: async () => {
      modelCalled = true;
      return new Response(JSON.stringify({
        model: 'deepseek-v4-pro',
        choices: [{ finish_reason: 'stop', message: { content: '{"suggestions":[]}' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  let classified: ReturnType<typeof classifyReviewFailure> | null = null;
  try {
    await executeReview(client, 'product', {
      workflow: 'product', storeId: STORE_ID, entityId: null, sourceVersion: 'draft',
      product: { productId: null, label: '安佳淡奶油', spec: '1L/盒', countUnit: '盒', categoryCode: 'other_food', isActive: true },
      catalog: [{ productId: 'not-a-uuid', label: '安佳淡奶油', spec: '1L/盒', countUnit: '盒', categoryCode: 'other_food', isActive: true }],
    });
  } catch (error) {
    classified = classifyReviewFailure(error);
  }
  assert(classified?.code === 'MODEL_INVALID_SUGGESTION');
  assert(!modelCalled, 'The invalid deterministic action should fail before model egress.');
});
