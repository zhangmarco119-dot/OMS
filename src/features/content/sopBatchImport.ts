import type { SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

import { createSopCategory, saveSop, uploadSopAsset } from '../../services/v2-content.service';
import type { Database } from '../../types/database';

export interface SopBatchStep {
  imageFileName: string;
  order: number;
  text: string;
}

export interface SopBatchRecord {
  body: string;
  category: string;
  roles: Array<'staff' | 'manager'>;
  steps: SopBatchStep[];
  storeNames: string[];
  title: string;
}

type RawRow = Record<string, unknown>;

const text = (value: unknown) => String(value ?? '').trim();
const splitList = (value: unknown) => text(value).split(/[、,，;；\n]+/).map((entry) => entry.trim()).filter(Boolean);
const readFileAsArrayBuffer = (file: File) => {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取 SOP Excel 文件失败。'));
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('SOP Excel 文件内容格式无效。'));
    reader.readAsArrayBuffer(file);
  });
};

const parseRoles = (value: unknown): Array<'staff' | 'manager'> => {
  const entries = splitList(value);
  if (!entries.length) return ['staff', 'manager'];
  const roles = new Set<'staff' | 'manager'>();
  entries.forEach((entry) => {
    const normalized = entry.toLowerCase();
    if (['员工', 'staff'].includes(normalized)) roles.add('staff');
    else if (['店长', 'manager'].includes(normalized)) roles.add('manager');
    else throw new Error(`无法识别适用角色“${entry}”，请填写员工或店长。`);
  });
  return [...roles];
};

export const parseSopBatchWorkbook = async (file: File): Promise<SopBatchRecord[]> => {
  const workbook = XLSX.read(await readFileAsArrayBuffer(file), { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('Excel 中没有可读取的 Sheet。');
  const rows = XLSX.utils.sheet_to_json<RawRow>(workbook.Sheets[firstSheet], { defval: '' });
  if (!rows.length) throw new Error('Excel 中没有 SOP 数据。');

  const records = new Map<string, SopBatchRecord>();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const title = text(row['产品名称']);
    const category = text(row['分类']);
    const imageFileName = text(row['步骤图片文件名']);
    const stepText = text(row['步骤说明']);
    const parsedOrder = Number(row['步骤序号']);
    if (!title || !category || !imageFileName || !stepText) {
      throw new Error(`Excel 第 ${rowNumber} 行必须填写产品名称、分类、步骤图片文件名和步骤说明。`);
    }
    if (!Number.isInteger(parsedOrder) || parsedOrder < 1) throw new Error(`Excel 第 ${rowNumber} 行的步骤序号必须是大于 0 的整数。`);

    const current = records.get(title);
    if (current && current.category !== category) throw new Error(`同一 SOP“${title}”不能同时使用多个分类。`);
    const record = current ?? {
      body: text(row['SOP整体说明']),
      category,
      roles: parseRoles(row['适用角色']),
      steps: [],
      storeNames: splitList(row['适用门店']),
      title,
    };
    record.steps.push({ imageFileName, order: parsedOrder - 1, text: stepText });
    records.set(title, record);
  });

  const result = [...records.values()];
  result.forEach((record) => {
    record.steps.sort((left, right) => left.order - right.order);
    const orders = record.steps.map((step) => step.order);
    if (new Set(orders).size !== orders.length) throw new Error(`SOP“${record.title}”存在重复的步骤序号。`);
  });
  return result;
};

export const createSopBatchTemplate = () => {
  const rows = [
    { '产品名称': '芒果酸奶碗', '分类': '酸奶碗制作', 'SOP整体说明': '标准版芒果酸奶碗', '适用门店': '', '适用角色': '员工、店长', '步骤序号': 1, '步骤图片文件名': 'mango-01.jpg', '步骤说明': '称取酸奶基底 180 克，平整铺入碗底。' },
    { '产品名称': '芒果酸奶碗', '分类': '酸奶碗制作', 'SOP整体说明': '', '适用门店': '', '适用角色': '', '步骤序号': 2, '步骤图片文件名': 'mango-02.jpg', '步骤说明': '加入芒果 60 克，按参考图均匀摆放。' },
  ];
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 28 }, { wch: 24 }, { wch: 18 }, { wch: 10 }, { wch: 24 }, { wch: 48 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'SOP批量导入');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
};

export const importSopBatch = async (
  client: SupabaseClient<Database>,
  input: { imageFiles: File[]; profileId: string; stores: Array<{ id: string; name: string }>; workbookFile: File },
) => {
  const records = await parseSopBatchWorkbook(input.workbookFile);
  const { data: existing, error } = await client.from('v2_sops').select('title,status').neq('status', 'archived');
  if (error) throw new Error(error.message);
  const existingTitles = new Set((existing ?? []).map((sop) => sop.title));
  const duplicates = records.filter((record) => existingTitles.has(record.title)).map((record) => record.title);
  if (duplicates.length) throw new Error(`已存在同名 SOP：${duplicates.join('、')}。请改名后重试。`);

  const fileMap = new Map<string, File>();
  input.imageFiles.forEach((file) => {
    const key = file.name.toLowerCase();
    if (fileMap.has(key)) throw new Error(`选择的图片中存在重名文件：${file.name}`);
    fileMap.set(key, file);
  });
  records.flatMap((record) => record.steps).forEach((step) => {
    const file = fileMap.get(step.imageFileName.toLowerCase());
    if (!file) throw new Error(`未选择 Excel 中指定的图片：${step.imageFileName}`);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`步骤图片格式不支持：${file.name}`);
  });

  for (const record of records) {
    const selectedStores = record.storeNames.length
      ? record.storeNames.map((name) => input.stores.find((store) => store.name === name) ?? null)
      : input.stores;
    const missingStores = record.storeNames.filter((name) => !input.stores.some((store) => store.name === name));
    if (missingStores.length) throw new Error(`SOP“${record.title}”中的门店名称不存在：${missingStores.join('、')}`);
    await createSopCategory(client, { name: record.category, profileId: input.profileId });
    const saved = await saveSop(client, {
      body: record.body,
      category: record.category,
      effectiveAt: '',
      id: null,
      roles: record.roles,
      storeIds: selectedStores.filter((store): store is { id: string; name: string } => store !== null).map((store) => store.id),
      taskTemplateId: null,
      title: record.title,
    });
    for (const step of record.steps) {
      await uploadSopAsset(client, {
        file: fileMap.get(step.imageFileName.toLowerCase())!,
        profileId: input.profileId,
        sopId: saved.id,
        sortOrder: step.order,
        stepText: step.text,
      });
    }
  }
  return { imported: records.length, steps: records.reduce((total, record) => total + record.steps.length, 0) };
};
