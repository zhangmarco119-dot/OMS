import {
  isAiReviewWorkflow,
  type AiReviewContext,
  type AiReviewWorkflow,
  type AiSuggestion,
  type DraftProductInput,
  type JsonValue,
} from './types.ts';

const MAX_CONTEXT_BYTES = 512_000;
const MAX_DEPTH = 8;
const MAX_ARRAY_LENGTH = 1_000;
const MAX_STRING_LENGTH = 500;

const forbiddenKeys = new Set([
  'address',
  'answer',
  'answers',
  'bucket',
  'carrier',
  'carrier_name',
  'created_by_name',
  'display_name',
  'email',
  'employee',
  'employee_name',
  'file',
  'file_name',
  'free_text',
  'guidance',
  'image',
  'image_path',
  'image_url',
  'images',
  'manager_name',
  'mobile',
  'note',
  'notes',
  'object_path',
  'phone',
  'profile',
  'profile_name',
  'remark',
  'reporter',
  'reporter_name',
  'staff_name',
  'storage_path',
  'tracking_no',
  'url',
  'urls',
  'waybill',
]);

// Context is produced by database functions, but this second allow-list is a
// deliberate egress boundary before any value can reach the model provider.
const allowedKeys = new Set([
  'active', 'arrival', 'arrival_date', 'arrival_quantity', 'average', 'baseline', 'baselines',
  'candidate', 'candidate_product_id', 'candidates', 'catalog', 'category', 'category_code',
  'count', 'count_unit', 'created_at', 'current', 'current_value', 'date', 'days',
  'entity', 'entity_id', 'entity_version', 'expected_count_unit', 'field', 'field_type', 'fields',
  'first_date', 'first_seen_date', 'historical', 'historical_median', 'historical_values',
  'history', 'id', 'inventory_quantity', 'is_active', 'is_extra_item',
  'is_issue', 'is_unmatched_product', 'item', 'item_count', 'item_id', 'item_status', 'items', 'label', 'last_arrival_quantity',
  'last_date', 'last_inventory_quantity', 'last_order_quantity', 'last_seen_date', 'latest',
  'lifecycle_status', 'mad', 'matched', 'max', 'maximum', 'mean', 'median', 'min', 'minimum', 'name',
  'normalized_name', 'occurrence_count', 'order_quantity', 'previous_quantity', 'product',
  'product_action_status', 'product_id', 'product_name', 'product_name_snapshot', 'product_snapshot', 'products', 'quantity',
  'prompt', 'recent', 'recent_quantities', 'recent_values', 'report', 'report_count', 'report_id',
  'request', 'request_id', 'request_status', 'review_state', 'sample_count', 'similarity', 'snapshot',
  'sort_order', 'source_version', 'spec', 'statistics', 'structured_answer', 'status', 'store_id',
  'submitted_at', 'summary', 'task', 'task_id', 'task_title', 'task_type', 'total',
  'total_quantity', 'unit', 'values', 'version', 'window_days', 'workflow', 'zero_count',
]);

const keyAliases: Record<string, string> = {
  arrivalDate: 'arrival_date',
  arrivalQuantity: 'arrival_quantity',
  candidateProductId: 'candidate_product_id',
  categoryCode: 'category_code',
  countUnit: 'count_unit',
  currentValue: 'current_value',
  entityId: 'entity_id',
  entityVersion: 'entity_version',
  expectedCountUnit: 'expected_count_unit',
  fieldType: 'field_type',
  firstDate: 'first_date',
  firstSeenDate: 'first_seen_date',
  historicalMedian: 'historical_median',
  historicalValues: 'historical_values',
  inventoryQuantity: 'inventory_quantity',
  isActive: 'is_active',
  isExtraItem: 'is_extra_item',
  isIssue: 'is_issue',
  isUnmatchedProduct: 'is_unmatched_product',
  itemCount: 'item_count',
  itemId: 'item_id',
  itemStatus: 'item_status',
  lastArrivalQuantity: 'last_arrival_quantity',
  lastDate: 'last_date',
  lastInventoryQuantity: 'last_inventory_quantity',
  lastOrderQuantity: 'last_order_quantity',
  lastSeenDate: 'last_seen_date',
  lifecycleStatus: 'lifecycle_status',
  normalizedName: 'normalized_name',
  occurrenceCount: 'occurrence_count',
  orderQuantity: 'order_quantity',
  previousQuantity: 'previous_quantity',
  productActionStatus: 'product_action_status',
  productId: 'product_id',
  productName: 'product_name',
  productNameSnapshot: 'product_name_snapshot',
  productSnapshot: 'product_snapshot',
  recentQuantities: 'recent_quantities',
  recentValues: 'recent_values',
  reportCount: 'report_count',
  reportId: 'report_id',
  requestId: 'request_id',
  requestStatus: 'request_status',
  reviewState: 'review_state',
  sampleCount: 'sample_count',
  sortOrder: 'sort_order',
  sourceVersion: 'source_version',
  storeId: 'store_id',
  structuredAnswer: 'structured_answer',
  submittedAt: 'submitted_at',
  taskId: 'task_id',
  taskTitle: 'task_title',
  taskType: 'task_type',
  totalQuantity: 'total_quantity',
  windowDays: 'window_days',
  zeroCount: 'zero_count',
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categoryPattern = /^[a-z][a-z0-9_]{0,63}$/;
const sensitiveValuePattern = /(?:https?:\/\/|www\.|\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const assertSafeScalar = (value: unknown, key: string): JsonValue => {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) throw new Error(`Unsafe numeric AI context field: ${key}`);
    return value;
  }
  if (typeof value !== 'string' || value.length > MAX_STRING_LENGTH || sensitiveValuePattern.test(value)) {
    throw new Error(`Unsafe AI context field: ${key}`);
  }
  return value;
};

const sanitizeNode = (value: unknown, depth: number, parentKey: string): JsonValue => {
  if (depth > MAX_DEPTH) throw new Error('AI review context is too deeply nested.');
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) throw new Error(`AI review context array is too large: ${parentKey}`);
    return value.map((entry) => sanitizeNode(entry, depth + 1, parentKey));
  }
  if (!value || typeof value !== 'object') return assertSafeScalar(value, parentKey);

  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = keyAliases[key.trim()] ?? key.trim().toLowerCase();
    if (forbiddenKeys.has(normalized) || !allowedKeys.has(normalized)) {
      throw new Error(`AI review context contains a non-allowlisted field: ${key}`);
    }
    result[normalized] = sanitizeNode(entry, depth + 1, normalized);
  }
  return result;
};

export const sanitizeReviewContext = (workflow: AiReviewWorkflow, value: unknown): AiReviewContext => {
  // v2_task may contain free-text answers. It remains disabled during the
  // structured-data pilot until a dedicated typed-answer schema is approved.
  if (workflow === 'v2_task') throw new Error('V2 task AI review is not enabled for the structured-data pilot.');
  const sanitized = sanitizeNode(value, 0, 'context');
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
    throw new Error('AI review context must be an object.');
  }
  const context = sanitized as Record<string, JsonValue>;
  if (context.workflow !== undefined && context.workflow !== workflow) {
    throw new Error('AI review context workflow does not match the queued job.');
  }
  context.workflow = workflow;
  const encoded = JSON.stringify(context);
  if (new TextEncoder().encode(encoded).length > MAX_CONTEXT_BYTES) {
    throw new Error('AI review context exceeds the safe size limit.');
  }
  return context as AiReviewContext;
};

const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]) => {
  const expected = new Set(allowed);
  return Object.keys(value).every((key) => expected.has(key));
};

const requiredDraftText = (value: unknown, field: string, maximum: number) => {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum || sensitiveValuePattern.test(trimmed)) {
    throw new Error(`${field} is invalid.`);
  }
  return trimmed;
};

export const parseDraftProductInput = (value: unknown): DraftProductInput => {
  const source = asRecord(value);
  if (!exactKeys(source, ['name', 'spec', 'countUnit', 'categoryCode', 'productId'])) {
    throw new Error('Product draft contains unsupported fields.');
  }
  const categoryCode = requiredDraftText(source.categoryCode, 'categoryCode', 64);
  if (!categoryPattern.test(categoryCode)) throw new Error('categoryCode is invalid.');
  const productId = source.productId === undefined ? undefined : requiredDraftText(source.productId, 'productId', 36);
  if (productId && !uuidPattern.test(productId)) throw new Error('productId is invalid.');
  return {
    categoryCode,
    countUnit: requiredDraftText(source.countUnit, 'countUnit', 40),
    name: requiredDraftText(source.name, 'name', 120),
    productId,
    spec: requiredDraftText(source.spec, 'spec', 160),
  };
};

const allowedActions: Record<AiReviewWorkflow, Set<string>> = {
  arrival_report: new Set(['review', 'replace_fields', 'use_existing_product', 'edit_quantity']),
  inventory: new Set(['review', 'edit_quantity', 'use_existing_product']),
  order: new Set(['review', 'edit_quantity', 'mark_no_order_needed']),
  product: new Set(['review', 'replace_fields', 'use_existing_product']),
  product_creation_request: new Set(['review', 'replace_fields', 'use_existing_product']),
  v2_task: new Set(['review']),
};

const allowedActionPayloadKeys: Record<string, Set<string>> = {
  edit_quantity: new Set(['item_id', 'quantity']),
  mark_no_order_needed: new Set(['item_id']),
  replace_fields: new Set(['category_code', 'count_unit', 'name', 'spec']),
  review: new Set(),
  use_existing_product: new Set(['product_id']),
};

export class AiSuggestionPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiSuggestionPolicyError';
  }
}

const isSafeSuggestionValue = (value: JsonValue, depth = 0): boolean => {
  if (depth > MAX_DEPTH) return false;
  if (typeof value === 'string') return value.length <= MAX_STRING_LENGTH && !sensitiveValuePattern.test(value);
  if (Array.isArray(value)) return value.length <= 20 && value.every((entry) => isSafeSuggestionValue(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.entries(value).length <= 10
      && Object.values(value).every((entry) => isSafeSuggestionValue(entry, depth + 1));
  }
  return true;
};

const exactPayloadKeys = (keys: string[], required: string[]) =>
  keys.length === required.length && required.every((key) => keys.includes(key));

const recordValue = (value: JsonValue | undefined): Record<string, JsonValue> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : null;

const recordValues = (value: JsonValue | undefined) => Array.isArray(value)
  ? value.map(recordValue).filter((entry): entry is Record<string, JsonValue> => entry !== null)
  : [];

const knownCatalogProductIds = (context: AiReviewContext) => new Set(
  recordValues(context.catalog)
    .map((entry) => entry.product_id)
    .filter((value): value is string => typeof value === 'string' && uuidPattern.test(value)),
);

const currentItemIds = (workflow: AiReviewWorkflow, context: AiReviewContext) => {
  const container = workflow === 'arrival_report' ? recordValue(context.arrival) : recordValue(context.task);
  return new Set(recordValues(container?.items)
    .map((entry) => entry.item_id)
    .filter((value): value is string => typeof value === 'string' && uuidPattern.test(value)));
};

const validateReplaceFields = (payload: Record<string, JsonValue>, keys: string[]) => {
  if (!keys.length) throw new AiSuggestionPolicyError('AI replace_fields action did not contain a draft patch.');
  for (const key of keys) {
    const value = payload[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new AiSuggestionPolicyError('AI replace_fields action contained an invalid draft value.');
    }
    if (key === 'category_code' && !categoryPattern.test(value)) {
      throw new AiSuggestionPolicyError('AI replace_fields action contained an invalid category.');
    }
  }
};

export const enforceSuggestionPolicy = (
  workflow: AiReviewWorkflow,
  suggestion: AiSuggestion,
  context: AiReviewContext,
): AiSuggestion => {
  if (!allowedActions[workflow].has(suggestion.action_type)) {
    throw new AiSuggestionPolicyError(`AI returned a disallowed action for ${workflow}.`);
  }
  const payloadKeys = Object.keys(suggestion.action_payload);
  if (payloadKeys.some((key) => !allowedActionPayloadKeys[suggestion.action_type]?.has(key))) {
    throw new AiSuggestionPolicyError('AI returned a non-allowlisted action payload.');
  }
  if (!isSafeSuggestionValue(suggestion.current_value) || !isSafeSuggestionValue(suggestion.suggested_value)
    || !isSafeSuggestionValue(suggestion.action_payload)) {
    throw new AiSuggestionPolicyError('AI returned unsafe suggestion content.');
  }

  const payload = suggestion.action_payload;
  if (suggestion.action_type === 'review' && payloadKeys.length) {
    throw new AiSuggestionPolicyError('AI review action must not contain a draft patch.');
  }
  if (suggestion.action_type === 'replace_fields') validateReplaceFields(payload, payloadKeys);
  if (suggestion.action_type === 'use_existing_product') {
    if (!exactPayloadKeys(payloadKeys, ['product_id']) || typeof payload.product_id !== 'string'
      || !uuidPattern.test(payload.product_id) || !knownCatalogProductIds(context).has(payload.product_id)) {
      throw new AiSuggestionPolicyError('AI existing-product action did not target an allowlisted catalog product.');
    }
  }
  if (suggestion.action_type === 'edit_quantity') {
    if (!exactPayloadKeys(payloadKeys, ['item_id', 'quantity']) || typeof payload.item_id !== 'string'
      || !uuidPattern.test(payload.item_id) || !currentItemIds(workflow, context).has(payload.item_id)
      || typeof payload.quantity !== 'number' || !Number.isFinite(payload.quantity)
      || payload.quantity < 0 || payload.quantity > 999_999_999) {
      throw new AiSuggestionPolicyError('AI quantity action did not target a current item with a safe quantity.');
    }
  }
  if (suggestion.action_type === 'mark_no_order_needed') {
    if (!exactPayloadKeys(payloadKeys, ['item_id']) || typeof payload.item_id !== 'string'
      || !uuidPattern.test(payload.item_id) || !currentItemIds(workflow, context).has(payload.item_id)) {
      throw new AiSuggestionPolicyError('AI no-order action did not target a current order item.');
    }
  }
  return suggestion;
};

export const parseWorkflow = (value: unknown): AiReviewWorkflow => {
  if (!isAiReviewWorkflow(value)) throw new Error('Unsupported AI review workflow.');
  return value;
};

export const parseUuid = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new Error(`${field} is invalid.`);
  return value;
};

export const assertExactObjectKeys = (value: unknown, allowed: readonly string[]) => {
  const source = asRecord(value);
  if (!exactKeys(source, allowed)) throw new Error('Request contains unsupported fields.');
  return source;
};
