import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { buildTaskWorkbook, makeTaskFilename } from './taskExport';
import type { Database } from '../../types/database';

type TaskRow = Database['public']['Tables']['tasks']['Row'];
type TaskItemRow = Database['public']['Tables']['task_items']['Row'];

const task: TaskRow = {
  created_at: '2026-07-11T00:00:00.000Z',
  created_by: 'user-1',
  export_meta: {},
  id: 'task-1',
  inventory_category_codes: ['fruit', 'frozen', 'other_food', 'packaging', 'consumable', 'non_consumable'],
  linked_v2_task_id: null,
  started_at: '2026-07-11T00:00:00.000Z',
  status: 'submitted',
  store_id: 'store-1',
  submitted_at: '2026-07-11T01:02:00',
  task_type: 'inventory',
  updated_at: '2026-07-11T01:02:00.000Z',
};

const item: TaskItemRow = {
  created_at: '2026-07-11T00:00:00.000Z',
  id: 'item-1',
  is_extra_item: false,
  product_action_status: null,
  product_id: 'product-1',
  product_snapshot: {
    product_id: 'product-1',
    name: '原味奶酪',
    spec: '120g/杯',
    count_unit: '杯',
    product_code: 'BZ-WDK-001',
  },
  quantity: 8,
  sort_order: 1,
  staff_note: null,
  status: 'completed',
  store_id: 'store-1',
  task_id: 'task-1',
  updated_at: '2026-07-11T00:00:00.000Z',
};

describe('taskExport', () => {
  it('builds a workbook with summary and item sheets', () => {
    const workbook = buildTaskWorkbook({
      items: [item],
      store: { name: '宝珠奶酪（五道口店）', shortName: '五道口店' },
      task,
    });

    expect(workbook.SheetNames).toEqual(['单据信息', '盘点单']);
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['盘点单'], { header: 1 });
    expect(rows[0]).toContain('货品名称');
    expect(rows[0]).not.toContain('货品编码');
    expect(rows[1]).toContain('原味奶酪');
    expect(rows[1]).not.toContain('BZ-WDK-001');
    expect(rows[1]).toContain(8);
  });

  it('uses store name, task type and submitted time in filename', () => {
    expect(makeTaskFilename(task, { name: '宝珠奶酪（五道口店）', shortName: '五道口店' })).toBe('五道口店-盘点单-20260711-0102.xlsx');
  });
});
