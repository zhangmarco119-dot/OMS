import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { parseSopBatchWorkbook } from './sopBatchImport';

const workbookFile = (rows: Array<Record<string, unknown>>) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'SOP');
  return new File([XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer], 'sops.xlsx');
};

describe('parseSopBatchWorkbook', () => {
  it('groups ordered image and text steps into one SOP', async () => {
    const records = await parseSopBatchWorkbook(workbookFile([
      { '产品名称': '芒果酸奶碗', '分类': '酸奶碗制作', '适用角色': '员工、店长', '步骤序号': 2, '步骤图片文件名': '02.jpg', '步骤说明': '摆放芒果' },
      { '产品名称': '芒果酸奶碗', '分类': '酸奶碗制作', '适用角色': '员工、店长', '步骤序号': 1, '步骤图片文件名': '01.jpg', '步骤说明': '称取酸奶' },
    ]));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ category: '酸奶碗制作', roles: ['staff', 'manager'], title: '芒果酸奶碗' });
    expect(records[0].steps.map((step) => step.imageFileName)).toEqual(['01.jpg', '02.jpg']);
  });
});
