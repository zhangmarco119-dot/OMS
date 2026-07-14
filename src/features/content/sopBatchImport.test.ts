import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { importSopBatch, parseSopBatchWorkbook } from './sopBatchImport';

const contentService = vi.hoisted(() => ({
  createSopCategory: vi.fn(),
  createSopTextStep: vi.fn(),
  saveSop: vi.fn(),
  uploadSopAsset: vi.fn(),
}));

vi.mock('../../services/v2-content.service', () => contentService);

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

  it('accepts pure-text and pure-image rows but rejects an empty step', async () => {
    const records = await parseSopBatchWorkbook(workbookFile([
      { '产品名称': '混合步骤 SOP', '分类': '测试分类', '步骤序号': 1, '步骤图片文件名': '', '步骤说明': '这是纯文字步骤' },
      { '产品名称': '混合步骤 SOP', '分类': '测试分类', '步骤序号': 2, '步骤图片文件名': 'only-image.jpg', '步骤说明': '' },
    ]));
    expect(records[0].steps).toEqual([
      { imageFileName: '', order: 0, text: '这是纯文字步骤' },
      { imageFileName: 'only-image.jpg', order: 1, text: '' },
    ]);

    await expect(parseSopBatchWorkbook(workbookFile([
      { '产品名称': '无效 SOP', '分类': '测试分类', '步骤序号': 1, '步骤图片文件名': '', '步骤说明': '' },
    ]))).rejects.toThrow('至少填写一项');
  });
});

describe('importSopBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contentService.saveSop.mockResolvedValue({ id: 'sop-1' });
    contentService.uploadSopAsset.mockImplementation(async (_client, _input, onProgress) => { onProgress?.(35); onProgress?.(100); });
  });

  it('imports pure-text and pure-image steps while matching only referenced folder images', async () => {
    const workbook = workbookFile([
      { '产品名称': '芒果酸奶碗', '分类': 'Excel 新分类', '步骤序号': 1, '步骤图片文件名': '', '步骤说明': '称取酸奶' },
      { '产品名称': '芒果酸奶碗', '分类': 'Excel 新分类', '步骤序号': 2, '步骤图片文件名': '02.png', '步骤说明': '' },
    ]);
    const imageFiles = [new File(['two'], '02.png', { type: 'image/png' })];
    const progress = vi.fn();
    const client = {
      from: vi.fn((table: string) => table === 'v2_sops'
        ? { select: vi.fn(() => ({ neq: vi.fn().mockResolvedValue({ data: [], error: null }) })) }
        : { select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [{ name: '已有分类' }], error: null }) })) }),
    };

    const result = await importSopBatch(client as never, { imageFiles, onProgress: progress, profileId: 'admin-1', stores: [{ id: 'store-1', name: '测试门店' }], workbookFile: workbook });

    expect(contentService.createSopCategory).toHaveBeenCalledTimes(1);
    expect(contentService.createSopCategory).toHaveBeenCalledWith(client, { name: 'Excel 新分类', profileId: 'admin-1' });
    expect(contentService.createSopTextStep).toHaveBeenCalledWith(client, { sopId: 'sop-1', sortOrder: 0, stepText: '称取酸奶' });
    expect(contentService.uploadSopAsset).toHaveBeenCalledTimes(1);
    expect(contentService.uploadSopAsset).toHaveBeenCalledWith(client, expect.objectContaining({ file: imageFiles[0], sortOrder: 1, stepText: '' }), expect.any(Function));
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 2, percent: 100, phase: 'complete', total: 2 }));
    expect(result).toEqual({ imported: 1, steps: 2 });
  });
});
