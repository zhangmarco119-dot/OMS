import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { importSopBatch, parseSopBatchWorkbook, readSopBatchImageFileNames } from './sopBatchImport';

const contentService = vi.hoisted(() => ({
  archiveSop: vi.fn(),
  createSopCategory: vi.fn(),
  createSopTextStep: vi.fn(),
  deleteArchivedSop: vi.fn(),
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
  it('reads only the unique image filenames referenced by the workbook', async () => {
    const file = workbookFile([
      { '产品名称': 'SOP A', '分类': '测试', '步骤序号': 1, '步骤图片文件名': 'a.jpg' },
      { '产品名称': 'SOP A', '分类': '测试', '步骤序号': 2, '步骤图片文件名': 'a.jpg' },
      { '产品名称': 'SOP B', '分类': '测试', '步骤序号': 1, '步骤图片文件名': 'b.png' },
      { '产品名称': 'SOP B', '分类': '测试', '步骤序号': 2, '步骤说明': '纯文字步骤' },
    ]);

    await expect(readSopBatchImageFileNames(file)).resolves.toEqual(['a.jpg', 'b.png']);
  });

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
    contentService.createSopTextStep.mockResolvedValue({ id: 'text-step', object_path: null });
    contentService.uploadSopAsset.mockImplementation(async (_client, _input, onProgress) => { onProgress?.(35); onProgress?.(100); return { id: 'image-step', object_path: 'sop/image.jpg' }; });
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
    expect(result).toEqual({ failed: 0, failures: [], imported: 1, steps: 2, total: 1 });
  });

  it('reports invalid or duplicate SOPs individually and still imports valid SOPs', async () => {
    const workbook = workbookFile([
      { '产品名称': '已存在 SOP', '分类': '已有分类', '步骤序号': 1, '步骤说明': '不会覆盖' },
      { '产品名称': '缺图 SOP', '分类': '已有分类', '步骤序号': 1, '步骤图片文件名': 'missing.jpg' },
      { '产品名称': '可导入 SOP', '分类': '已有分类', '步骤序号': 1, '步骤说明': '继续导入这一项' },
      { '产品名称': '', '分类': '已有分类', '步骤序号': 1, '步骤说明': '无法归属' },
    ]);
    const client = {
      from: vi.fn((table: string) => table === 'v2_sops'
        ? { select: vi.fn(() => ({ neq: vi.fn().mockResolvedValue({ data: [{ status: 'draft', title: '已存在 SOP' }], error: null }) })) }
        : { select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [{ name: '已有分类' }], error: null }) })) }),
    };

    const result = await importSopBatch(client as never, { imageFiles: [], profileId: 'admin-1', stores: [{ id: 'store-1', name: '测试门店' }], workbookFile: workbook });

    expect(result).toMatchObject({ failed: 3, imported: 1, steps: 1, total: 4 });
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ item: 'SOP“已存在 SOP”', reason: expect.stringContaining('同名') }),
      expect.objectContaining({ item: 'SOP“缺图 SOP”', reason: expect.stringContaining('missing.jpg') }),
      expect.objectContaining({ item: 'Excel 第 5 行', reason: expect.stringContaining('产品名称') }),
    ]));
    expect(contentService.saveSop).toHaveBeenCalledTimes(1);
    expect(contentService.saveSop).toHaveBeenCalledWith(client, expect.objectContaining({ title: '可导入 SOP' }));
  });

  it('cleans up a partially saved SOP after a step failure and continues with the next SOP', async () => {
    const workbook = workbookFile([
      { '产品名称': '失败 SOP', '分类': '已有分类', '步骤序号': 1, '步骤图片文件名': 'bad.jpg' },
      { '产品名称': '成功 SOP', '分类': '已有分类', '步骤序号': 1, '步骤图片文件名': 'good.jpg' },
    ]);
    const images = [
      new File(['bad'], 'bad.jpg', { type: 'image/jpeg' }),
      new File(['good'], 'good.jpg', { type: 'image/jpeg' }),
    ];
    contentService.saveSop.mockImplementation(async (_client, input) => ({ id: input.title === '失败 SOP' ? 'failed-id' : 'success-id' }));
    contentService.uploadSopAsset.mockImplementation(async (_client, input) => {
      if (input.sopId === 'failed-id') throw new Error('图片上传超时');
      return { id: 'good-step', object_path: 'success/good.jpg' };
    });
    const client = {
      from: vi.fn((table: string) => table === 'v2_sops'
        ? { select: vi.fn(() => ({ neq: vi.fn().mockResolvedValue({ data: [], error: null }) })) }
        : { select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [{ name: '已有分类' }], error: null }) })) }),
    };

    const result = await importSopBatch(client as never, { imageFiles: images, profileId: 'admin-1', stores: [{ id: 'store-1', name: '测试门店' }], workbookFile: workbook });

    expect(result).toMatchObject({ failed: 1, imported: 1, steps: 1, total: 2 });
    expect(result.failures[0]).toMatchObject({ item: 'SOP“失败 SOP”', reason: '图片上传超时' });
    expect(contentService.archiveSop).toHaveBeenCalledWith(client, 'failed-id');
    expect(contentService.deleteArchivedSop).toHaveBeenCalledWith(client, { assetUrls: [], id: 'failed-id' });
    expect(contentService.saveSop).toHaveBeenCalledTimes(2);
  });
});
