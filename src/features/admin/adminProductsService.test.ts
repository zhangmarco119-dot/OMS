import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import type { Database } from '../../types/database';
import { feedbackProductSnapshots, isAppliedProductCorrection, parseProductImportFile } from './adminProductsService';

type ProductFeedbackRow = Database['public']['Tables']['product_feedback']['Row'];

describe('adminProductsService', () => {
  it('parses product import files with Chinese headers', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          货品名称: '原味奶酪',
          规格: '120g/杯',
          单位: '杯',
          货品编码: 'BZ-WDK-001',
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
        product_code: 'BZ-WDK-001',
        sort_order: 10,
        spec: '120g/杯',
      },
    ]);
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
