import { describe, expect, it } from 'vitest';

import { applyAiArrivalDraftPatch, buildAiArrivalDraftPatch } from './arrivalAiDraftPatch';

describe('applyAiArrivalDraftPatch', () => {
  const form = {
    fields: { arrival_date: '2026-08-13', arrival_time: '10:00', carrier_name: '配送方', note: null, tracking_no: 'NO-1' },
    items: [{ id: 'item-1', isUnmatchedProduct: false, note: '', productId: 'product-1', productName: '原味酸奶', quantity: '120', sortOrder: 0, spec: '500ml', unit: '瓶' }],
  };

  it('applies allowed AI values to a correction draft without touching the submitted entity', () => {
    const next = applyAiArrivalDraftPatch(form, { fields: { note: '请复核数量' }, items: [{ id: 'item-1', quantity: 12 }] });
    expect(next.fields.note).toBe('请复核数量');
    expect(next.items[0].quantity).toBe('12');
    expect(form.fields.note).toBeNull();
    expect(form.items[0].quantity).toBe('120');
  });

  it('converts a top-level edit_quantity action into the correction items shape', () => {
    const patch = buildAiArrivalDraftPatch({ actionType: 'edit_quantity', currentValue: 120, draftPatch: { item_id: 'item-1', quantity: 12 }, fieldPath: 'arrival.items[0].quantity' } as unknown as Parameters<typeof buildAiArrivalDraftPatch>[0], { item_id: 'item-1', quantity: 12 });
    expect(patch).toEqual({ items: [{ id: 'item-1', quantity: 12 }] });
    expect(applyAiArrivalDraftPatch(form, patch).items[0].quantity).toBe('12');
  });

  it('hydrates a use-existing-product patch from the selected catalog product', () => {
    const patch = buildAiArrivalDraftPatch({ actionType: 'use_existing_product', currentValue: { item_id: 'item-1' }, draftPatch: { product_id: 'product-2' }, fieldPath: 'arrival.items[0].product_id' } as unknown as Parameters<typeof buildAiArrivalDraftPatch>[0], { product_id: 'product-2' });
    const next = applyAiArrivalDraftPatch(form, patch, undefined, [{ count_unit: '盒', id: 'product-2', name: '标准酸奶', spec: '200g' }]);
    expect(next.items[0]).toMatchObject({ isUnmatchedProduct: false, productId: 'product-2', productName: '标准酸奶', spec: '200g', unit: '盒' });
  });
});
