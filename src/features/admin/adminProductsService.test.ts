import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import type { Database } from '../../types/database';
import { feedbackProductSnapshots, importProducts, isAppliedProductCorrection, parseProductImportFile } from './adminProductsService';

const database = vi.hoisted(() => ({ from: vi.fn() }));
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
          启用: '是',
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
        count_unit: '杯',
        is_active: true,
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
      { count_unit: '杯', is_active: true, name: '成功货品', product_code: null, row_number: 2, sort_order: 1, spec: '100g' },
      { count_unit: '', is_active: true, name: '缺少单位', product_code: null, row_number: 3, sort_order: 2, spec: '120g' },
      { count_unit: '袋', is_active: true, name: '写入失败货品', product_code: null, row_number: 4, sort_order: 3, spec: '500g' },
      { count_unit: '瓶', is_active: true, name: '后续成功货品', product_code: null, row_number: 5, sort_order: 4, spec: '250ml' },
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
});
