import { describe, expect, it } from 'vitest';

import {
  generateArrivalSummary,
  getArrivalValidationIssues,
  type ArrivalDraftItem,
} from './arrivalForm';

const item = (overrides: Partial<ArrivalDraftItem> = {}): ArrivalDraftItem => ({
  id: '00000000-0000-4000-8000-000000000001',
  isUnmatchedProduct: false,
  note: '',
  productId: '00000000-0000-4000-8000-000000000101',
  productName: 'OMEGA 原味酸奶',
  quantity: '12.000',
  sortOrder: 0,
  spec: '120g/杯',
  unit: '箱',
  ...overrides,
});

describe('arrival form', () => {
  it('generates a single-product summary', () => {
    expect(generateArrivalSummary([item()])).toBe('OMEGA 原味酸奶到货 12 箱。');
  });

  it('generates a multi-product summary in item order', () => {
    expect(generateArrivalSummary([
      item(),
      item({
        id: '00000000-0000-4000-8000-000000000002',
        isUnmatchedProduct: true,
        productId: null,
        productName: '酸奶杯',
        quantity: '200',
        sortOrder: 1,
        unit: '个',
      }),
    ])).toBe('本次到货：OMEGA 原味酸奶 12 箱，酸奶杯 200 个。');
  });

  it('returns an empty summary for incomplete items', () => {
    expect(generateArrivalSummary([item({ quantity: '' })])).toBe('');
  });

  it('reports missing images, uploads and invalid quantities', () => {
    expect(getArrivalValidationIssues({
      goodsImageCount: 0,
      items: [item({ quantity: '-1' })],
      uploadCount: 1,
      waybillImageCount: 0,
    })).toEqual([
      '至少上传一张面单照片。',
      '至少上传一张拆包货品照片。',
      '还有 1 张图片正在上传。',
      '产品 1：数量必须大于 0。',
    ]);
  });
});
