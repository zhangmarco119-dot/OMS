import { runDeterministicRules } from './deterministic-rules.ts';
import { parseDraftProductInput, sanitizeReviewContext } from './review-policy.ts';

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const ENTITY_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '77777777-7777-4777-8777-777777777777';

const assert: (condition: unknown, message?: string) => asserts condition = (condition, message = 'Assertion failed') => {
  if (!condition) throw new Error(message);
};

const assertEquals = (actual: unknown, expected: unknown) => {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
};

Deno.test('accepts the database product context and normalizes camelCase keys', () => {
  const context = sanitizeReviewContext('product', {
    workflow: 'product',
    storeId: STORE_ID,
    entityId: ENTITY_ID,
    sourceVersion: 4,
    product: {
      productId: PRODUCT_ID,
      label: '安佳淡奶油',
      spec: '1L/盒×12盒/箱',
      countUnit: '盒',
      categoryCode: 'other_food',
      isActive: true,
    },
    catalog: [{
      productId: PRODUCT_ID,
      label: '安佳淡奶油',
      spec: '1L/盒×12盒/箱',
      countUnit: '盒',
      categoryCode: 'other_food',
      isActive: true,
    }],
  });
  assertEquals(context.store_id, STORE_ID);
  assertEquals(context.source_version, 4);
  assertEquals((context.product as Record<string, unknown>).count_unit, '盒');
  assert(!runDeterministicRules('product', context).some((entry) => entry.code === 'duplicate_product_exact'), 'An edited product must not duplicate itself.');
});

Deno.test('accepts the database product creation request context', () => {
  const context = sanitizeReviewContext('product_creation_request', {
    workflow: 'product_creation_request',
    storeId: STORE_ID,
    entityId: ENTITY_ID,
    sourceVersion: 1,
    request: {
      requestId: ENTITY_ID,
      label: '草莓果泥',
      spec: '1kg/袋',
      countUnit: '袋',
      categoryCode: 'other_food',
      requestStatus: 'pending',
    },
    catalog: [],
  });
  assertEquals((context.request as Record<string, unknown>).request_status, 'pending');
});

Deno.test('accepts the database arrival context and detects a repeated item', () => {
  const context = sanitizeReviewContext('arrival_report', {
    workflow: 'arrival_report', storeId: STORE_ID, entityId: ENTITY_ID, sourceVersion: 2,
    arrival: {
      reportId: ENTITY_ID, arrivalDate: '2026-08-13', lifecycleStatus: 'submitted',
      items: [
        { itemId: '44444444-4444-4444-8444-444444444444', productId: PRODUCT_ID, label: '草莓', quantity: 2, unit: '盒', isUnmatchedProduct: false, sortOrder: 1 },
        { itemId: '55555555-5555-4555-8555-555555555555', productId: PRODUCT_ID, label: '草莓', quantity: 3, unit: '盒', isUnmatchedProduct: false, sortOrder: 2 },
      ],
    },
    history: [{ arrivalDate: '2026-08-12', productId: PRODUCT_ID, label: '草莓', quantity: 2, unit: '盒' }],
    catalog: [{ productId: PRODUCT_ID, label: '草莓', spec: '500g/盒', countUnit: '盒', categoryCode: 'fruit', isActive: true }],
  });
  const findings = runDeterministicRules('arrival_report', context);
  assert(findings.some((entry) => entry.code === 'duplicate_arrival_item'));
});

Deno.test('arrival history is not mistaken for a current duplicate and supports deterministic outliers', () => {
  const context = sanitizeReviewContext('arrival_report', {
    workflow: 'arrival_report', storeId: STORE_ID, entityId: ENTITY_ID, sourceVersion: 2,
    arrival: {
      reportId: ENTITY_ID, arrivalDate: '2026-08-13', lifecycleStatus: 'active',
      items: [{ itemId: '44444444-4444-4444-8444-444444444444', productId: PRODUCT_ID, label: '草莓', quantity: 20, unit: '箱', isUnmatchedProduct: false, sortOrder: 1 }],
    },
    history: [1, 2, 2].map((quantity, index) => ({ arrivalDate: `2026-08-0${index + 1}`, productId: PRODUCT_ID, label: '草莓', quantity, unit: '盒' })),
    catalog: [{ productId: PRODUCT_ID, label: '草莓', spec: '500g/盒', countUnit: '盒', categoryCode: 'fruit', isActive: true }],
  });
  const findings = runDeterministicRules('arrival_report', context);
  assert(!findings.some((entry) => entry.code === 'duplicate_arrival_item'));
  assert(findings.some((entry) => entry.code === 'arrival_quantity_outlier'));
  assert(findings.some((entry) => entry.code === 'arrival_unit_mismatch'));
});

for (const workflow of ['inventory', 'order'] as const) {
  Deno.test(`accepts the database ${workflow} task context`, () => {
    const context = sanitizeReviewContext(workflow, {
      workflow, storeId: STORE_ID, entityId: ENTITY_ID, sourceVersion: 1,
      task: {
        taskId: ENTITY_ID, taskType: workflow,
        items: [{ itemId: '66666666-6666-4666-8666-666666666666', productId: PRODUCT_ID, label: '原味酸奶', spec: '120g/杯', countUnit: '杯', quantity: 10, itemStatus: 'completed', isExtraItem: false, sortOrder: 1 }],
      },
      history: [{ taskType: workflow, submittedAt: '2026-08-12T10:00:00Z', productId: PRODUCT_ID, quantity: 9, itemStatus: 'completed' }],
    });
    assertEquals((context.task as Record<string, unknown>).task_type, workflow);
  });
}

Deno.test('order rules compare no-order-needed against the latest inventory history', () => {
  const context = sanitizeReviewContext('order', {
    workflow: 'order', storeId: STORE_ID, entityId: ENTITY_ID, sourceVersion: 1,
    task: { taskId: ENTITY_ID, taskType: 'order', items: [{ itemId: ITEM_ID, productId: PRODUCT_ID, label: '原味酸奶', spec: '120g/杯', countUnit: '杯', quantity: null, itemStatus: 'no_order_needed', isExtraItem: false, sortOrder: 1 }] },
    history: [{ taskType: 'inventory', submittedAt: '2026-08-12T10:00:00Z', productId: PRODUCT_ID, quantity: 0, itemStatus: 'completed' }],
  });
  assert(runDeterministicRules('order', context).some((entry) => entry.code === 'no_order_with_zero_inventory'));
});

Deno.test('rejects sensitive and non-allowlisted egress fields', () => {
  for (const unsafe of [
    { note: '员工填写的自由备注' },
    { imageUrl: 'https://private.example/image.jpg' },
    { trackingNo: 'SF123456789' },
    { employeeName: '张三' },
    { product: { label: '普通货品', imageUrl: 'https://private.example/nested.jpg' } },
    { product: { label: '联系邮箱 staff@example.com' } },
  ]) {
    let rejected = false;
    try {
      sanitizeReviewContext('product', { workflow: 'product', storeId: STORE_ID, entityId: ENTITY_ID, sourceVersion: 1, ...unsafe });
    } catch {
      rejected = true;
    }
    assert(rejected, `Expected rejection for ${Object.keys(unsafe)[0]}`);
  }
});

Deno.test('rejects V2 task content during the structured-data pilot', () => {
  let rejected = false;
  try {
    sanitizeReviewContext('v2_task', { workflow: 'v2_task', storeId: STORE_ID, entityId: ENTITY_ID, sourceVersion: 1 });
  } catch {
    rejected = true;
  }
  assert(rejected);
});

Deno.test('product draft accepts exactly the approved fields', () => {
  assertEquals(parseDraftProductInput({
    name: '安佳淡奶油', spec: '1L/盒', countUnit: '盒', categoryCode: 'other_food', productId: PRODUCT_ID,
  }), {
    categoryCode: 'other_food', countUnit: '盒', name: '安佳淡奶油', productId: PRODUCT_ID, spec: '1L/盒',
  });
  let rejected = false;
  try {
    parseDraftProductInput({ name: '安佳淡奶油', spec: '1L/盒', countUnit: '盒', categoryCode: 'other_food', note: '不要发送' });
  } catch {
    rejected = true;
  }
  assert(rejected);
});
