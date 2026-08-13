import type { ArrivalDraftItem } from '../arrivals/arrivalForm';
import type { ArrivalCorrectionFields } from '../../services/arrivals.service';
import type { Json } from '../../types/database';
import type { AiSuggestion } from '../../services/ai-review.service';

export interface ArrivalCorrectionDraft {
  fields: ArrivalCorrectionFields;
  items: ArrivalDraftItem[];
}

export interface ArrivalAiProductOption {
  count_unit: string;
  id: string;
  name: string;
  spec: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const itemIndexFromFieldPath = (fieldPath: string | null) => {
  const match = fieldPath?.match(/items?\[(\d+)]/i);
  return match ? Number(match[1]) : null;
};

const itemTargetFromSuggestion = (suggestion: AiSuggestion, patch: Record<string, unknown>) => {
  const current = isRecord(suggestion.currentValue) ? suggestion.currentValue : {};
  const id = patch.item_id ?? patch.arrival_item_id ?? patch.itemId
    ?? current.item_id ?? current.arrival_item_id ?? current.itemId ?? current.id;
  if (typeof id === 'string' && id) return { id } as Record<string, Json>;
  const index = itemIndexFromFieldPath(suggestion.fieldPath);
  return index == null ? null : { index } as Record<string, Json>;
};

export const buildAiArrivalDraftPatch = (
  suggestion: AiSuggestion,
  patchValue: unknown,
): Record<string, Json | undefined> | null => {
  const patch = isRecord(patchValue) ? patchValue : {};
  if (Array.isArray(patch.items) || isRecord(patch.fields)) return patch as Record<string, Json | undefined>;
  const target = itemTargetFromSuggestion(suggestion, patch);
  if (suggestion.actionType === 'edit_quantity') {
    if (!target || patch.quantity === undefined) return null;
    return { items: [{ ...target, quantity: patch.quantity as Json }] };
  }
  if (suggestion.actionType === 'use_existing_product') {
    if (!target || typeof patch.product_id !== 'string' || !patch.product_id) return null;
    return { items: [{ ...target, is_unmatched_product: false, product_id: patch.product_id }] };
  }
  if (suggestion.actionType === 'replace_fields') {
    if (!target) return null;
    const itemPatch: Record<string, Json> = { ...target };
    if (patch.name !== undefined) itemPatch.product_name = patch.name as Json;
    if (patch.spec !== undefined) itemPatch.spec = patch.spec as Json;
    if (patch.count_unit !== undefined) itemPatch.unit = patch.count_unit as Json;
    return Object.keys(itemPatch).length > Object.keys(target).length ? { items: [itemPatch] } : null;
  }
  return null;
};

export const applyAiArrivalDraftPatch = (
  form: ArrivalCorrectionDraft,
  patchValue: unknown,
  modifiedValue?: Json,
  products: ArrivalAiProductOption[] = [],
): ArrivalCorrectionDraft => {
  const patch = isRecord(patchValue) ? patchValue : {};
  const fieldPatch = isRecord(patch.fields) ? patch.fields : patch;
  const nextFields = { ...form.fields };
  (['arrival_date', 'arrival_time', 'carrier_name', 'note', 'tracking_no'] as const).forEach((key) => {
    if (fieldPatch[key] !== undefined) (nextFields as unknown as Record<string, string | null>)[key] = fieldPatch[key] == null ? null : String(fieldPatch[key]);
  });

  const itemPatches = Array.isArray(patch.items)
    ? patch.items.filter(isRecord)
    : (patch.item_id ?? patch.arrival_item_id ?? patch.itemId) && patch.quantity !== undefined
      ? [patch]
      : [];
  const nextItems = form.items.map((item, index) => {
    const candidate = itemPatches.find((entry) => entry.id === item.id || entry.item_id === item.id || entry.itemId === item.id || entry.arrival_item_id === item.id || entry.index === index);
    if (!candidate) return item;
    const next = { ...item };
    const mappings = {
      is_unmatched_product: 'isUnmatchedProduct',
      note: 'note',
      product_id: 'productId',
      product_name: 'productName',
      product_name_snapshot: 'productName',
      quantity: 'quantity',
      spec: 'spec',
      specification: 'spec',
      unit: 'unit',
    } as const;
    Object.entries(mappings).forEach(([source, target]) => {
      const value = candidate[source] ?? candidate[target];
      if (value === undefined) return;
      if (target === 'isUnmatchedProduct') next.isUnmatchedProduct = Boolean(value);
      else if (target === 'productId') next.productId = value == null ? null : String(value);
      else (next as unknown as Record<string, unknown>)[target] = String(value ?? '');
    });
    return next;
  });

  if (modifiedValue !== undefined) {
    const mod = isRecord(modifiedValue) ? modifiedValue : null;
    if (mod) return applyAiArrivalDraftPatch({ fields: nextFields, items: nextItems }, mod, undefined, products);
    const patchKeys = Object.keys(fieldPatch).filter((key) => ['arrival_date', 'arrival_time', 'carrier_name', 'note', 'tracking_no'].includes(key));
    if (patchKeys.length === 1) (nextFields as unknown as Record<string, unknown>)[patchKeys[0]] = String(modifiedValue);
    else if (itemPatches.length === 1) {
      const itemIndex = nextItems.findIndex((item) => item.id === (itemPatches[0].id ?? itemPatches[0].arrival_item_id));
      const editableKeys = Object.keys(itemPatches[0]).filter((key) => ['product_name', 'product_name_snapshot', 'quantity', 'spec', 'specification', 'unit', 'note'].includes(key));
      if (itemIndex >= 0 && editableKeys.length === 1) {
        const target = ({ product_name: 'productName', product_name_snapshot: 'productName', quantity: 'quantity', spec: 'spec', specification: 'spec', unit: 'unit', note: 'note' } as Record<string, keyof ArrivalDraftItem>)[editableKeys[0]];
        (nextItems[itemIndex] as unknown as Record<string, unknown>)[target] = String(modifiedValue);
      }
    }
  }
  return {
    fields: nextFields,
    items: nextItems.map((item) => {
      if (!item.productId) return item;
      const product = products.find((entry) => entry.id === item.productId);
      return product ? {
        ...item,
        isUnmatchedProduct: false,
        productName: product.name,
        spec: product.spec,
        unit: product.count_unit,
      } : item;
    }),
  };
};
