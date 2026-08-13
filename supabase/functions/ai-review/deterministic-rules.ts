import type { AiReviewContext, AiReviewWorkflow, DeterministicFinding, JsonValue } from './types.ts';

type RecordValue = Record<string, JsonValue>;

const asRecord = (value: JsonValue | undefined): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;

const recordArray = (value: JsonValue | undefined) => Array.isArray(value)
  ? value.map((entry) => asRecord(entry)).filter((entry): entry is RecordValue => entry !== null)
  : [];

const cleanName = (value: JsonValue | undefined) => typeof value === 'string'
  ? value.trim().toLocaleLowerCase('zh-CN').replace(/[\s\-_（）()]/g, '')
  : '';
const text = (value: JsonValue | undefined) => typeof value === 'string' ? value.trim() : '';
const number = (value: JsonValue | undefined) => typeof value === 'number' && Number.isFinite(value) ? value : null;

const finding = (
  code: string,
  severity: DeterministicFinding['severity'],
  title: string,
  explanation: string,
  fieldPath: string,
  currentValue: JsonValue,
  suggestedValue: JsonValue = null,
  actionType = 'review',
  actionPayload: Record<string, JsonValue> = {},
  confidence = 0.9,
): DeterministicFinding => ({
  action_payload: actionPayload,
  action_type: actionType,
  code,
  confidence,
  current_value: currentValue,
  explanation,
  field_path: fieldPath,
  severity,
  source: 'rule',
  suggested_value: suggestedValue,
  title,
});

const productRules = (context: AiReviewContext) => {
  const result: DeterministicFinding[] = [];
  const product = asRecord(context.product) ?? asRecord(context.request);
  if (!product) return result;
  const name = text(product.name ?? product.label);
  const spec = text(product.spec);
  const countUnit = text(product.count_unit);
  if (/\d+(?:\.\d+)?\s*(?:kg|g|克|千克|ml|毫升|l|升|个|只|袋|盒|瓶|箱)(?:\s*[x×*]\s*\d+)?/i.test(name)) {
    result.push(finding('spec_embedded_in_name', 'info', '名称中可能混入规格', '建议将包装或容量信息放在规格字段，保持货品名称稳定。', 'product.name', name, null, 'review', {}, 0.86));
  }
  if (/[\d/×*]/.test(countUnit) || countUnit.length > 8) {
    result.push(finding('invalid_count_unit_shape', 'warning', '点货单位可能不是最小单位', '点货单位通常应是单个简短单位，包装换算信息应写入规格。', 'product.count_unit', countUnit, null, 'review', {}, 0.94));
  }
  if (!spec) {
    result.push(finding('missing_product_spec', 'warning', '规格为空', '货品规格缺失，后续到货和点货时容易发生单位混淆。', 'product.spec', '', null, 'review', {}, 1));
  }

  const normalized = cleanName(name);
  const currentProductId = text(product.id) || text(product.product_id);
  for (const candidate of recordArray(context.catalog).slice(0, 200)) {
    const candidateId = text(candidate.id) || text(candidate.product_id);
    if (currentProductId && candidateId === currentProductId) continue;
    const candidateLabel = candidate.name ?? candidate.label;
    if (normalized && cleanName(candidateLabel) === normalized) {
      result.push(finding(
        'duplicate_product_exact', 'critical', '发现同名货品',
        `当前名称与已有货品“${text(candidateLabel)}”标准化后相同，应优先使用已有货品。`,
        'product.name', name, candidateLabel ?? null,
        candidateId ? 'use_existing_product' : 'review', candidateId ? { product_id: candidateId } : {}, 1,
      ));
      break;
    }
    const similarity = number(candidate.similarity);
    if (similarity !== null && similarity >= 0.9) {
      result.push(finding(
        'duplicate_product_similar', 'warning', '发现高度疑似重复货品',
        `已有货品“${text(candidateLabel)}”与当前草稿高度相似，请确认是否为同一货品。`,
        'product.name', name, candidateLabel ?? null, 'review', {}, Math.min(0.99, similarity),
      ));
      break;
    }
  }
  return result;
};

const medianOf = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const quantityOutlier = (current: number | null, values: number[], path: string, label: string) => {
  const median = values.length >= 3 ? medianOf(values) : null;
  if (current === null || median === null || median <= 0) return [];
  const ratio = current / median;
  return ratio >= 5 || ratio <= 0.2
    ? [finding(
      `${label}_quantity_outlier`, 'warning', '数量与近期历史差异较大',
      `当前数量 ${current}，近期中位数 ${median}，建议人工复核单位或录入值。`,
      path, current, null, 'review', {}, 0.9,
    )]
    : [];
};

const sameProduct = (left: RecordValue, right: RecordValue) => {
  const leftId = text(left.product_id);
  const rightId = text(right.product_id);
  return leftId && rightId ? leftId === rightId : cleanName(left.label) !== '' && cleanName(left.label) === cleanName(right.label);
};

const arrivalRules = (context: AiReviewContext) => {
  const result: DeterministicFinding[] = [];
  const arrival = asRecord(context.arrival);
  const items = recordArray(arrival?.items);
  const history = recordArray(context.history);
  const catalog = recordArray(context.catalog);
  const seen = new Map<string, number>();

  items.forEach((item, index) => {
    const identity = text(item.product_id) || cleanName(item.label);
    if (identity && seen.has(identity)) {
      result.push(finding(
        'duplicate_arrival_item', 'warning', '同一到货单可能重复填写货品',
        '同一货品在本次到货中出现多次，请确认是否应合并。',
        `arrival.items[${index}]`, identity, null, 'review', {}, 0.98,
      ));
    } else if (identity) seen.set(identity, index);

    const catalogProduct = catalog.find((candidate) => sameProduct(item, candidate));
    const unit = text(item.unit);
    const expectedUnit = text(catalogProduct?.count_unit);
    if (unit && expectedUnit && unit !== expectedUnit) {
      result.push(finding(
        'arrival_unit_mismatch', 'warning', '到货单位与货品单位不一致',
        `本次单位为“${unit}”，货品库单位为“${expectedUnit}”，请确认是否发生包装单位混淆。`,
        `arrival.items[${index}].unit`, unit, expectedUnit, 'review', {}, 0.96,
      ));
    }

    const historicalValues = history.filter((entry) => sameProduct(item, entry))
      .map((entry) => number(entry.quantity)).filter((value): value is number => value !== null);
    result.push(...quantityOutlier(number(item.quantity), historicalValues, `arrival.items[${index}].quantity`, 'arrival'));
  });
  return result.slice(0, 30);
};

const taskRules = (workflow: 'inventory' | 'order', context: AiReviewContext) => {
  const result: DeterministicFinding[] = [];
  const task = asRecord(context.task);
  const items = recordArray(task?.items);
  const history = recordArray(context.history);

  items.forEach((item, index) => {
    const historicalValues = history
      .filter((entry) => sameProduct(item, entry) && text(entry.task_type) === workflow)
      .map((entry) => number(entry.quantity)).filter((value): value is number => value !== null);
    result.push(...quantityOutlier(number(item.quantity), historicalValues, `task.items[${index}].quantity`, workflow));

    if (workflow === 'order' && item.item_status === 'no_order_needed') {
      const latestInventory = history.find((entry) =>
        sameProduct(item, entry) && text(entry.task_type) === 'inventory' && entry.item_status === 'completed');
      const inventory = number(latestInventory?.quantity);
      if (inventory !== null && inventory <= 0) {
        result.push(finding(
          'no_order_with_zero_inventory', 'warning', '零库存但标记无需订货',
          '最近库存为零，请确认“无需订货”是否正确。',
          `task.items[${index}].item_status`, 'no_order_needed', null, 'review', {}, 0.95,
        ));
      }
    }
  });

  const completed = items.map((item) => number(item.quantity)).filter((value): value is number => value !== null);
  if (completed.length >= 8 && new Set(completed).size === 1) {
    result.push(finding(
      `${workflow}_uniform_quantities`, 'info', '多项货品填写了完全相同的数量',
      `本单 ${completed.length} 项货品的数量均为 ${completed[0]}，建议抽查是否为批量机械填写。`,
      'task.items', completed[0], null, 'review', {}, 0.84,
    ));
  }
  return result.slice(0, 30);
};

export const runDeterministicRules = (workflow: AiReviewWorkflow, context: AiReviewContext): DeterministicFinding[] => {
  if (workflow === 'product' || workflow === 'product_creation_request') return productRules(context);
  if (workflow === 'arrival_report') return arrivalRules(context);
  if (workflow === 'inventory' || workflow === 'order') return taskRules(workflow, context);
  return [];
};

export const mergeSuggestions = (
  rules: DeterministicFinding[],
  model: Omit<DeterministicFinding, 'source'>[],
) => {
  const seen = new Set<string>();
  return [...rules, ...model].filter((entry) => {
    const key = `${entry.code}|${entry.field_path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 50).map(({ ...entry }) => {
    const copy = { ...entry } as Record<string, unknown>;
    delete copy.source;
    return copy;
  });
};
