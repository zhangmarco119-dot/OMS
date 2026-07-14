import type { Database, Json } from '../../types/database';

export type TaskItemRow = Database['public']['Tables']['task_items']['Row'];

export interface ProductSnapshot {
  product_id: string | null;
  name: string;
  spec: string;
  count_unit: string;
  product_code: string | null;
}

export interface CompletionStats {
  total: number;
  processed: number;
  pending: number;
  percent: number;
}

export const asProductSnapshot = (value: Json): ProductSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      product_id: null,
      name: '未知货品',
      spec: '',
      count_unit: '',
      product_code: null,
    };
  }

  const record = value as Record<string, Json | undefined>;

  return {
    product_id: typeof record.product_id === 'string' ? record.product_id : null,
    name: typeof record.name === 'string' ? record.name : '未知货品',
    spec: typeof record.spec === 'string' ? record.spec : '',
    count_unit: typeof record.count_unit === 'string' ? record.count_unit : '',
    product_code: typeof record.product_code === 'string' ? record.product_code : null,
  };
};

export const isItemProcessed = (item: Pick<TaskItemRow, 'status' | 'quantity'>) =>
  item.status !== 'pending' || item.quantity !== null;

export const getCompletionStats = (items: Pick<TaskItemRow, 'status' | 'quantity'>[]): CompletionStats => {
  const total = items.length;
  const processed = items.filter(isItemProcessed).length;
  const pending = total - processed;
  const percent = total === 0 ? 0 : Math.round((processed / total) * 100);

  return { total, processed, pending, percent };
};

export const findNextPendingIndex = (
  items: Pick<TaskItemRow, 'status' | 'quantity'>[],
  currentIndex: number,
) => {
  if (items.length === 0) {
    return -1;
  }

  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (currentIndex + offset) % items.length;
    if (!isItemProcessed(items[index])) {
      return index;
    }
  }

  return -1;
};

export const normalizeQuantityInput = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('数量必须是非负数字');
  }

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error('数量最多保留两位小数');
  }

  return parsed;
};

export const quantityToInputValue = (quantity: number | null) =>
  quantity === null ? '' : String(quantity);
