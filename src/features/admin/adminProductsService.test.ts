import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import type { Database } from '../../types/database';
import { createRecommendedProducts, feedbackProductSnapshots, handleProductFeedbackBatch, handleProductFeedbackBatchActions, importProducts, isAppliedProductCorrection, loadProductMatchingSettings, loadRecommendedProductAdditions, parseProductImportFile, saveProductMatchingSettings } from './adminProductsService';

const database = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: database }));

type ProductFeedbackRow = Database['public']['Tables']['product_feedback']['Row'];

describe('adminProductsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses product import files with Chinese headers', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          货品名称: '原味奶酪',
          规格: '120g/杯',
          单位: '杯',
          排序: 10,
        },
      ]),
      '货品',
    );
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    const file = new File([buffer], 'products.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await expect(parseProductImportFile(file)).resolves.toEqual([
      {
        category_code: 'other_food',
        count_unit: '杯',
        name: '原味奶酪',
        product_code: null,
        row_number: 2,
        sort_order: 10,
        spec: '120g/杯',
      },
    ]);
  });

  it('continues importing after invalid rows and database failures, then returns detailed reasons', async () => {
    const filters: Record<string, unknown> = {};
    database.from.mockImplementation(() => ({
      insert: vi.fn(async (payload) => ({ error: payload.name === '写入失败货品' ? { message: '名称违反唯一约束' } : null })),
      select: vi.fn(() => {
        const query = {
          eq: vi.fn((key: string, value: unknown) => { filters[key] = value; return query; }),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        };
        return query;
      }),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    }));
    const rows = [
      { category_code: 'other_food' as const, count_unit: '杯', name: '成功货品', product_code: null, row_number: 2, sort_order: 1, spec: '100g' },
      { category_code: 'other_food' as const, count_unit: '', name: '缺少单位', product_code: null, row_number: 3, sort_order: 2, spec: '120g' },
      { category_code: 'other_food' as const, count_unit: '袋', name: '写入失败货品', product_code: null, row_number: 4, sort_order: 3, spec: '500g' },
      { category_code: 'other_food' as const, count_unit: '瓶', name: '后续成功货品', product_code: null, row_number: 5, sort_order: 4, spec: '250ml' },
    ];

    const result = await importProducts('store-1', rows);

    expect(result).toMatchObject({ failed: 2, inserted: 2, succeeded: 2, total: 4, updated: 0 });
    expect(result.failures).toEqual([
      { item: 'Excel 第 3 行 · 缺少单位', reason: '缺少必填字段：单位。', rowNumber: 3 },
      { item: 'Excel 第 4 行 · 写入失败货品', reason: '名称违反唯一约束', rowNumber: 4 },
    ]);
    expect(database.from).toHaveBeenCalledTimes(6);
    expect(filters.store_id).toBe('store-1');
  });

  it('loads and saves matching windows and creates edited recommendations through RPCs', async () => {
    database.rpc
      .mockResolvedValueOnce({ data: { historyMatchDays: 14, recommendationDays: 21, updatedAt: '2026-08-02T10:00:00Z' }, error: null })
      .mockResolvedValueOnce({ data: { historyMatchDays: 10, recommendationDays: 45, updatedAt: '2026-08-02T10:01:00Z' }, error: null })
      .mockResolvedValueOnce({ data: [{ categoryCode: 'fruit', countUnit: '个', firstArrivalDate: '2026-08-01', key: '牛油果', lastArrivalDate: '2026-08-02', name: '牛油果', reportCount: 2, reportItemCount: 3, requestCount: 1, spec: '', totalQuantity: 8 }], error: null })
      .mockResolvedValueOnce({ data: { createdCount: 1, matchedArrivalItems: 3, products: [{ id: 'product-1', matchedArrivalItems: 3, name: '牛油果' }] }, error: null });

    await expect(loadProductMatchingSettings()).resolves.toMatchObject({ historyMatchDays: 14, recommendationDays: 21 });
    await expect(saveProductMatchingSettings({ historyMatchDays: 10, recommendationDays: 45 })).resolves.toMatchObject({ historyMatchDays: 10, recommendationDays: 45 });
    await expect(loadRecommendedProductAdditions('store-1')).resolves.toEqual([expect.objectContaining({ key: '牛油果', reportItemCount: 3 })]);
    await expect(createRecommendedProducts('store-1', [{ category_code: 'fruit', count_unit: '个', name: ' 牛油果 ', spec: ' 单果 ' }])).resolves.toMatchObject({ createdCount: 1, matchedArrivalItems: 3 });

    expect(database.rpc).toHaveBeenNthCalledWith(2, 'admin_save_product_matching_settings', { p_history_match_days: 10, p_recommendation_days: 45 });
    expect(database.rpc).toHaveBeenNthCalledWith(4, 'admin_create_recommended_products', {
      p_products: [{ category_code: 'fruit', count_unit: '个', name: '牛油果', spec: '单果' }],
      p_store_id: 'store-1',
    });
  });

  it('recognizes a manager-applied product correction and exposes before/after snapshots', () => {
    const feedback: ProductFeedbackRow = {
      created_at: '2026-07-11T00:00:00.000Z',
      created_by: 'manager-1',
      feedback_type: 'incorrect',
      handled_at: null,
      handled_by: null,
      id: 'feedback-1',
      note: '规格修正',
      original_snapshot: { product_id: 'product-1', name: '原味', spec: '100g', count_unit: '杯', product_code: 'P-1' },
      product_id: 'product-1',
      resolution_note: null,
      status: 'open',
      store_id: 'store-1',
      suggested_changes: { product_id: 'product-1', name: '原味', spec: '120g', count_unit: '杯', product_code: 'P-1' },
      task_item_id: 'item-1',
    };

    expect(isAppliedProductCorrection(feedback)).toBe(true);
    expect(feedbackProductSnapshots(feedback)).toMatchObject({
      original: { spec: '100g' },
      suggested: { spec: '120g' },
    });
  });

  it('handles every selected product request and reports partial batch failures', async () => {
    database.rpc
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: '货品已被其他管理员处理' } })
      .mockResolvedValueOnce({ data: {}, error: null });

    await expect(handleProductFeedbackBatch(['feedback-1', 'feedback-2', 'feedback-3'], 'acknowledge')).resolves.toEqual({
      failed: [{ id: 'feedback-2', reason: '货品已被其他管理员处理' }],
      succeeded: 2,
      total: 3,
    });
    expect(database.rpc).toHaveBeenCalledTimes(3);
  });

  it('handles mixed new-product and correction requests in one read-all action', async () => {
    database.rpc.mockResolvedValue({ data: {}, error: null });

    await expect(handleProductFeedbackBatchActions([
      { action: 'resolve', id: 'new-product-feedback' },
      { action: 'acknowledge', id: 'correction-feedback' },
    ])).resolves.toEqual({ failed: [], succeeded: 2, total: 2 });

    expect(database.rpc).toHaveBeenNthCalledWith(1, 'admin_handle_product_feedback', {
      p_action: 'resolve',
      p_feedback_id: 'new-product-feedback',
      p_resolution_note: null,
    });
    expect(database.rpc).toHaveBeenNthCalledWith(2, 'admin_handle_product_feedback', {
      p_action: 'acknowledge',
      p_feedback_id: 'correction-feedback',
      p_resolution_note: null,
    });
  });
});
