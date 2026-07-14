import type { SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

import { createSopCategory, createSopTextStep, saveSop, uploadSopAsset } from '../../services/v2-content.service';
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

export interface SopBatchImportProgress {
  completed: number;
  detail: string;
  percent: number;
  phase: 'validating' | 'categories' | 'importing' | 'uploading' | 'complete';
  total: number;
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
    if (!title || !category) {
      throw new Error(`Excel 第 ${rowNumber} 行必须填写产品名称和分类。`);
    }
    if (!imageFileName && !stepText) {
      throw new Error(`Excel 第 ${rowNumber} 行的步骤图片文件名和步骤说明至少填写一项。`);
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
    { '产品名称': '芒果酸奶碗', '分类': '酸奶碗制作', 'SOP整体说明': '', '适用门店': '', '适用角色': '', '步骤序号': 2, '步骤图片文件名': '', '步骤说明': '纯文字步骤示例：检查芒果成熟度并去除不合格果肉。' },
    { '产品名称': '芒果酸奶碗', '分类': '酸奶碗制作', 'SOP整体说明': '', '适用门店': '', '适用角色': '', '步骤序号': 3, '步骤图片文件名': 'mango-03.jpg', '步骤说明': '' },
  ];
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 28 }, { wch: 24 }, { wch: 18 }, { wch: 10 }, { wch: 24 }, { wch: 48 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'SOP批量导入');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
};

export const importSopBatch = async (
  client: SupabaseClient<Database>,
  input: {
    imageFiles: File[];
    onProgress?: (progress: SopBatchImportProgress) => void;
    profileId: string;
    stores: Array<{ id: string; name: string }>;
    workbookFile: File;
  },
) => {
  const report = (progress: SopBatchImportProgress) => input.onProgress?.(progress);
  report({ completed: 0, detail: '正在读取并校验 Excel 清单', percent: 2, phase: 'validating', total: 1 });
  const records = await parseSopBatchWorkbook(input.workbookFile);
  const totalSteps = records.reduce((total, record) => total + record.steps.length, 0);
  report({ completed: 0, detail: `已识别 ${records.length} 个 SOP、${totalSteps} 个制作步骤`, percent: 5, phase: 'validating', total: totalSteps });
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
    if (!step.imageFileName) return;
    const file = fileMap.get(step.imageFileName.toLowerCase());
    if (!file) throw new Error(`未选择 Excel 中指定的图片：${step.imageFileName}`);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`步骤图片格式不支持：${file.name}`);
  });

  const categoryNames = Array.from(new Set(records.map((record) => record.category)));
  const categoryQuery = await client.from('v2_sop_categories').select('name').eq('is_active', true);
  if (categoryQuery.error) throw new Error(categoryQuery.error.message);
  const existingCategories = new Set((categoryQuery.data ?? []).map((category) => category.name));
  const missingCategories = categoryNames.filter((name) => !existingCategories.has(name));
  for (let index = 0; index < missingCategories.length; index += 1) {
    const name = missingCategories[index];
    report({
      completed: index,
      detail: `正在根据 Excel 新建分类：${name}`,
      percent: 8 + Math.round((index / Math.max(missingCategories.length, 1)) * 10),
      phase: 'categories',
      total: missingCategories.length,
    });
    await createSopCategory(client, { name, profileId: input.profileId });
  }

  const totalUnits = Math.max(records.length + totalSteps, 1);
  let completedUnits = 0;
  let completedSteps = 0;

  for (const record of records) {
    const selectedStores = record.storeNames.length
      ? record.storeNames.map((name) => input.stores.find((store) => store.name === name) ?? null)
      : input.stores;
    const missingStores = record.storeNames.filter((name) => !input.stores.some((store) => store.name === name));
    if (missingStores.length) throw new Error(`SOP“${record.title}”中的门店名称不存在：${missingStores.join('、')}`);
    report({ completed: completedUnits, detail: `正在创建 SOP 草稿：${record.title}`, percent: 18 + Math.round((completedUnits / totalUnits) * 77), phase: 'importing', total: totalUnits });
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
    completedUnits += 1;
    for (const step of record.steps) {
      const file = step.imageFileName ? fileMap.get(step.imageFileName.toLowerCase())! : null;
      if (file) {
        await uploadSopAsset(client, {
          file,
          profileId: input.profileId,
          sopId: saved.id,
          sortOrder: step.order,
          stepText: step.text,
        }, (fileProgress) => {
          report({
            completed: completedSteps,
            detail: `正在处理步骤 ${completedSteps + 1}/${totalSteps}：${file.name}`,
            percent: Math.min(95, 18 + Math.round(((completedUnits + fileProgress / 100) / totalUnits) * 77)),
            phase: 'uploading',
            total: totalSteps,
          });
        });
      } else {
        report({
          completed: completedSteps,
          detail: `正在创建纯文字步骤 ${completedSteps + 1}/${totalSteps}`,
          percent: Math.min(95, 18 + Math.round((completedUnits / totalUnits) * 77)),
          phase: 'importing',
          total: totalSteps,
        });
        await createSopTextStep(client, { sopId: saved.id, sortOrder: step.order, stepText: step.text });
      }
      completedSteps += 1;
      completedUnits += 1;
    }
  }
  report({ completed: totalSteps, detail: `已完成 ${records.length} 个 SOP 和 ${totalSteps} 个制作步骤`, percent: 100, phase: 'complete', total: totalSteps });
  return { imported: records.length, steps: records.reduce((total, record) => total + record.steps.length, 0) };
};
