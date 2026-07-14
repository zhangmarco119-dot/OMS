import type { SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

import { archiveSop, createSopCategory, createSopTextStep, deleteArchivedSop, saveSop, uploadSopAsset } from '../../services/v2-content.service';
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

export interface SopBatchImportFailure {
  item: string;
  reason: string;
}

export interface SopBatchImportResult {
  failed: number;
  failures: SopBatchImportFailure[];
  imported: number;
  steps: number;
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

const uniqueReasons = (reasons: string[]) => [...new Set(reasons)].join('；');

const readSopBatchRows = async (file: File) => {
  const workbook = XLSX.read(await readFileAsArrayBuffer(file), { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('Excel 中没有可读取的 Sheet。');
  const rows = XLSX.utils.sheet_to_json<RawRow>(workbook.Sheets[firstSheet], { defval: '' });
  if (!rows.length) throw new Error('Excel 中没有 SOP 数据。');
  return rows;
};

const parseSopBatchRows = (rows: RawRow[]): { failures: SopBatchImportFailure[]; records: SopBatchRecord[] } => {
  const failures: SopBatchImportFailure[] = [];
  const groupedRows = new Map<string, Array<{ row: RawRow; rowNumber: number }>>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const title = text(row['产品名称']);
    if (!title) {
      failures.push({ item: `Excel 第 ${rowNumber} 行`, reason: '未填写产品名称，无法确定该行属于哪个 SOP。' });
      return;
    }
    groupedRows.set(title, [...(groupedRows.get(title) ?? []), { row, rowNumber }]);
  });

  const records: SopBatchRecord[] = [];
  groupedRows.forEach((entries, title) => {
    const reasons: string[] = [];
    const categories = entries.map(({ row }) => text(row['分类'])).filter(Boolean);
    const uniqueCategories = [...new Set(categories)];
    if (categories.length !== entries.length) reasons.push('每一行都必须填写分类');
    if (uniqueCategories.length > 1) reasons.push(`不能同时使用多个分类：${uniqueCategories.join('、')}`);

    let roles: Array<'staff' | 'manager'> = ['staff', 'manager'];
    const roleValue = entries.map(({ row }) => text(row['适用角色'])).find(Boolean) ?? '';
    try {
      roles = parseRoles(roleValue);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : '适用角色格式不正确');
    }

    const steps: SopBatchStep[] = [];
    entries.forEach(({ row, rowNumber }) => {
      const imageFileName = text(row['步骤图片文件名']);
      const stepText = text(row['步骤说明']);
      const parsedOrder = Number(row['步骤序号']);
      if (!imageFileName && !stepText) reasons.push(`第 ${rowNumber} 行的步骤图片文件名和步骤说明至少填写一项`);
      if (!Number.isInteger(parsedOrder) || parsedOrder < 1) reasons.push(`第 ${rowNumber} 行的步骤序号必须是大于 0 的整数`);
      if ((imageFileName || stepText) && Number.isInteger(parsedOrder) && parsedOrder > 0) {
        steps.push({ imageFileName, order: parsedOrder - 1, text: stepText });
      }
    });

    const orders = steps.map((step) => step.order);
    if (new Set(orders).size !== orders.length) reasons.push('存在重复的步骤序号');
    if (reasons.length) {
      failures.push({ item: `SOP“${title}”`, reason: `${uniqueReasons(reasons)}。` });
      return;
    }

    steps.sort((left, right) => left.order - right.order);
    records.push({
      body: entries.map(({ row }) => text(row['SOP整体说明'])).find(Boolean) ?? '',
      category: uniqueCategories[0],
      roles,
      steps,
      storeNames: splitList(entries.map(({ row }) => text(row['适用门店'])).find(Boolean) ?? ''),
      title,
    });
  });

  return { failures, records };
};

export const parseSopBatchWorkbook = async (file: File): Promise<SopBatchRecord[]> => {
  const parsed = parseSopBatchRows(await readSopBatchRows(file));
  if (parsed.failures.length) throw new Error(parsed.failures.map((failure) => `${failure.item}：${failure.reason}`).join('\n'));
  return parsed.records;
};

export const readSopBatchImageFileNames = async (file: File): Promise<string[]> => {
  const rows = await readSopBatchRows(file);
  return [...new Set(rows.map((row) => text(row['步骤图片文件名'])).filter(Boolean))];
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
  const parsed = parseSopBatchRows(await readSopBatchRows(input.workbookFile));
  const failures = [...parsed.failures];
  let records = parsed.records;
  const totalSteps = records.reduce((total, record) => total + record.steps.length, 0);
  const candidateTotal = records.length + failures.length;
  report({ completed: 0, detail: `已识别 ${candidateTotal} 个待处理项目、${totalSteps} 个有效制作步骤`, percent: 5, phase: 'validating', total: totalSteps });
  if (!records.length) {
    report({ completed: 0, detail: `导入完成：0 个成功，${failures.length} 个失败`, percent: 100, phase: 'complete', total: 0 });
    return { failed: failures.length, failures, imported: 0, steps: 0, total: failures.length } satisfies SopBatchImportResult;
  }

  const { data: existing, error } = await client.from('v2_sops').select('title,status').neq('status', 'archived');
  if (error) throw new Error(error.message);
  const existingTitles = new Set((existing ?? []).map((sop) => sop.title));

  const filesByName = new Map<string, File[]>();
  input.imageFiles.forEach((file) => {
    const key = file.name.toLowerCase();
    filesByName.set(key, [...(filesByName.get(key) ?? []), file]);
  });

  records = records.filter((record) => {
    const reasons: string[] = [];
    if (existingTitles.has(record.title)) reasons.push('系统中已存在同名且未归档的 SOP，请改名后重试');
    record.steps.forEach((step) => {
      if (!step.imageFileName) return;
      const matches = filesByName.get(step.imageFileName.toLowerCase()) ?? [];
      if (!matches.length) reasons.push(`未在所选图片文件夹中找到“${step.imageFileName}”`);
      else if (matches.length > 1) reasons.push(`图片文件夹中存在多个同名文件“${step.imageFileName}”`);
      else if (!['image/jpeg', 'image/png', 'image/webp'].includes(matches[0].type)) reasons.push(`图片“${step.imageFileName}”格式不支持`);
    });
    if (!reasons.length) return true;
    failures.push({ item: `SOP“${record.title}”`, reason: `${uniqueReasons(reasons)}。` });
    return false;
  });

  const categoryQuery = await client.from('v2_sop_categories').select('name').eq('is_active', true);
  if (categoryQuery.error) throw new Error(categoryQuery.error.message);
  const existingCategories = new Set((categoryQuery.data ?? []).map((category) => category.name));

  const totalUnits = Math.max(records.length + totalSteps, 1);
  let completedUnits = 0;
  let completedSteps = 0;
  let imported = 0;
  let importedSteps = 0;

  for (const record of records) {
    let savedId: string | null = null;
    const savedAssets: Array<Awaited<ReturnType<typeof uploadSopAsset>> | Awaited<ReturnType<typeof createSopTextStep>>> = [];
    try {
      if (!existingCategories.has(record.category)) {
        report({ completed: completedUnits, detail: `正在根据 Excel 新建分类：${record.category}`, percent: 8 + Math.round((completedUnits / totalUnits) * 10), phase: 'categories', total: records.length });
        await createSopCategory(client, { name: record.category, profileId: input.profileId });
        existingCategories.add(record.category);
      }

      const selectedStores = record.storeNames.length
        ? record.storeNames.map((name) => input.stores.find((store) => store.name === name) ?? null)
        : input.stores;
      const missingStores = record.storeNames.filter((name) => !input.stores.some((store) => store.name === name));
      if (missingStores.length) throw new Error(`门店名称不存在：${missingStores.join('、')}`);
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
      savedId = saved.id;
      completedUnits += 1;
      for (const step of record.steps) {
        const file = step.imageFileName ? filesByName.get(step.imageFileName.toLowerCase())?.[0] ?? null : null;
        if (file) {
          const asset = await uploadSopAsset(client, {
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
          savedAssets.push(asset);
        } else {
          report({
            completed: completedSteps,
            detail: `正在创建纯文字步骤 ${completedSteps + 1}/${totalSteps}`,
            percent: Math.min(95, 18 + Math.round((completedUnits / totalUnits) * 77)),
            phase: 'importing',
            total: totalSteps,
          });
          savedAssets.push(await createSopTextStep(client, { sopId: saved.id, sortOrder: step.order, stepText: step.text }));
        }
        completedSteps += 1;
        completedUnits += 1;
      }
      imported += 1;
      importedSteps += record.steps.length;
    } catch (error) {
      let reason = error instanceof Error ? error.message : '该 SOP 保存失败。';
      if (savedId) {
        try {
          await archiveSop(client, savedId);
          await deleteArchivedSop(client, { assetUrls: savedAssets, id: savedId });
        } catch (cleanupError) {
          reason += `；失败草稿未能完整清理：${cleanupError instanceof Error ? cleanupError.message : '未知清理错误'}`;
        }
      }
      failures.push({ item: `SOP“${record.title}”`, reason });
      completedUnits += 1;
      completedSteps += Math.max(0, record.steps.length - savedAssets.length);
      report({
        completed: completedSteps,
        detail: `“${record.title}”导入失败，正在继续下一项`,
        percent: Math.min(98, 18 + Math.round((completedUnits / totalUnits) * 77)),
        phase: 'importing',
        total: totalSteps,
      });
    }
  }
  report({ completed: totalSteps, detail: `导入完成：${imported} 个成功，${failures.length} 个失败`, percent: 100, phase: 'complete', total: totalSteps });
  return { failed: failures.length, failures, imported, steps: importedSteps, total: imported + failures.length } satisfies SopBatchImportResult;
};
