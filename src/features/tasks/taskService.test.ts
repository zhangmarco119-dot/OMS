import { describe, expect, it } from 'vitest';

import { findMissingDraftProductIds, findStaleDraftItemIds } from './taskService';

describe('taskService draft product synchronization', () => {
  it('finds active products that were added after a draft was created', () => {
    expect(findMissingDraftProductIds(
      ['product-1', 'product-2', 'product-3'],
      ['product-1', null, 'product-2'],
    )).toEqual(['product-3']);
  });

  it('does not duplicate products already present in the draft', () => {
    expect(findMissingDraftProductIds(
      ['product-1', 'product-2'],
      ['product-1', 'product-2'],
    )).toEqual([]);
  });

  it('removes catalog items that were deleted after the draft was created', () => {
    expect(findStaleDraftItemIds([
      {
        id: 'item-deleted',
        product_action_status: 'deletion_approved',
        product_snapshot: { product_id: 'product-deleted', name: '旧商品', spec: '', count_unit: '件', product_code: null },
      },
      {
        id: 'item-active',
        product_action_status: null,
        product_snapshot: { product_id: 'product-active', name: '在售商品', spec: '', count_unit: '件', product_code: null },
      },
    ], ['product-active'])).toEqual(['item-deleted']);
  });

  it('keeps temporary items that do not have a catalog product id', () => {
    expect(findStaleDraftItemIds([
      {
        id: 'item-temporary',
        product_action_status: null,
        product_snapshot: { product_id: null, name: '临时商品', spec: '', count_unit: '件', product_code: null },
      },
    ], [])).toEqual([]);
  });
});
