import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';

import {
  createOvertimeImportTemplate,
  importAdminOvertimeRows,
  parseOvertimeImportFile,
  type OvertimeImportProfile,
  type OvertimeImportRow,
} from './overtimeBatchImport';

const profiles: OvertimeImportProfile[] = [{
  display_name: '刘成跃',
  employment_type: 'full_time',
  id: 'profile-1',
  is_active: true,
  role: 'staff',
  store_id: 'store-1',
  username: 'liuchengyue',
}];

describe('employee overtime batch import', () => {
  it('builds a template with data, employee, store, and instruction sheets', async () => {
    const blob = createOvertimeImportTemplate(profiles, [{ id: 'store-1', name: 'OMEGA酸奶（西直门店）', short_name: '西直门店' }]);
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('template read failed'));
      reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('invalid template'));
      reader.readAsArrayBuffer(blob);
    });
    const workbook = XLSX.read(buffer, { type: 'array' });

    expect(workbook.SheetNames).toEqual(['加班工时导入', '员工参考', '门店参考', '填写说明']);
    expect(XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['加班工时导入'], { header: 1 })[0]).toEqual(['员工账号', '员工姓名', '门店', '加班日期', '加班工时', '登记说明']);
    expect(XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets['员工参考'])[0]).toMatchObject({ 员工账号: 'liuchengyue', 员工姓名: '刘成跃' });
  });

  it('parses the standard Excel columns and preserves their actual row numbers', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['员工账号', '员工姓名', '门店', '加班日期', '加班工时', '登记说明'],
      ['liuchengyue', '刘成跃', 'OMEGA酸奶（西直门店）', '2026-07-18', 2.5, '闭店盘点'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, '加班工时导入');
    const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    const rows = await parseOvertimeImportFile(new File([data], 'overtime.xlsx'));

    expect(rows).toEqual([expect.objectContaining({
      hours: 2.5,
      overtimeDate: '2026-07-18',
      reason: '闭店盘点',
      rowNumber: 2,
      username: 'liuchengyue',
    })]);
  });

  it('continues after invalid rows and reports every failure reason', async () => {
    const rows: OvertimeImportRow[] = [
      { employeeName: '刘成跃', hours: 2, overtimeDate: '2026-07-18', reason: '', rowNumber: 2, storeName: '西直门店', username: 'liuchengyue' },
      { employeeName: '未知员工', hours: 1, overtimeDate: '2026-07-18', reason: '', rowNumber: 3, storeName: '西直门店', username: 'missing' },
      { employeeName: '刘成跃', hours: 1.2, overtimeDate: '2026-07-18', reason: '', rowNumber: 4, storeName: '西直门店', username: 'liuchengyue' },
      { employeeName: '刘成跃', hours: 1, overtimeDate: '2026-07-20', reason: '', rowNumber: 5, storeName: '西直门店', username: 'liuchengyue' },
    ];
    const recordOvertime = vi.fn().mockResolvedValue({ status: 'approved' });
    const onProgress = vi.fn();
    const result = await importAdminOvertimeRows({
      onProgress,
      profiles,
      recordOvertime,
      rows,
      stores: [{ id: 'store-1', name: 'OMEGA酸奶（西直门店）', short_name: '西直门店' }],
      today: '2026-07-19',
    });

    expect(result).toMatchObject({ failed: 3, succeeded: 1, total: 4 });
    expect(result.failures.map((failure) => failure.reason)).toEqual(expect.arrayContaining([
      expect.stringContaining('未找到员工账号'),
      expect.stringContaining('0.5–6 小时'),
      expect.stringContaining('不能晚于今天'),
    ]));
    expect(recordOvertime).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'profile-1', storeId: 'store-1', hours: 2 }));
    expect(onProgress).toHaveBeenLastCalledWith(4, 4);
  });
});
