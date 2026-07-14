import * as XLSX from 'xlsx';

import { supabase } from '../../lib/supabase';
import type { Database, Json } from '../../types/database';
import { asProductSnapshot } from '../tasks/taskCalculations';

export type StoreRow = Database['public']['Tables']['stores']['Row'];
export type ProductRow = Database['public']['Tables']['products']['Row'];
export type ProductFeedbackRow = Database['public']['Tables']['product_feedback']['Row'];

export interface ProductFeedbackRecord {
  creatorName: string;
  feedback: ProductFeedbackRow;
  storeName: string;
}

export interface ProductDraft {
  count_unit: string;
  is_active: boolean;
  name: string;
  product_code: string;
  sort_order: number;
  spec: string;
  store_id: string;
}

export interface ProductImportRow {
  count_unit: string;
  is_active: boolean;
  name: string;
  product_code: string | null;
  row_number: number;
  sort_order: number;
  spec: string;
}

export interface ProductImportFailure {
  item: string;
  reason: string;
  rowNumber: number;
}

export interface ProductImportResult {
  failed: number;
  failures: ProductImportFailure[];
  inserted: number;
  succeeded: number;
  total: number;
  updated: number;
}

export interface ProductExportFile {
  blob: Blob;
  count: number;
  filename: string;
}

const requireClient = () => {
  if (!supabase) {
    throw new Error('Supabase 未配置');
  }
  return supabase;
};

const normalizeHeader = (value: unknown) => String(value ?? '').trim().toLowerCase();

const pick = (row: Record<string, unknown>, keys: string[]) => {
  const entries = Object.entries(row);
  for (const key of keys) {
    const found = entries.find(([candidate]) => normalizeHeader(candidate) === normalizeHeader(key));
    if (found) {
      return String(found[1] ?? '').trim();
    }
  }
  return '';
};

const toBoolean = (value: string) => {
  if (!value) {
    return true;
  }
  return !['false', '0', '否', '停用', '禁用', 'no'].includes(value.trim().toLowerCase());
};

const readFileAsArrayBuffer = (file: File) => {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取 Excel 文件失败'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Excel 文件内容格式无效'));
      }
    };
    reader.readAsArrayBuffer(file);
  });
};

export const loadAdminProductsData = async (storeId?: string) => {
  const client = requireClient();
  const { data: stores, error: storesError } = await client
    .from('stores')
    .select('*')
    .order('name', { ascending: true });

  if (storesError) {
    throw new Error(storesError.message);
  }

  const selectedStoreId = storeId || stores?.[0]?.id || '';
  const productsResult = selectedStoreId
    ? await client
        .from('products')
        .select('*')
        .eq('store_id', selectedStoreId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
    : { data: [], error: null };

  if (productsResult.error) {
    throw new Error(productsResult.error.message);
  }

  return {
    products: productsResult.data ?? [],
    selectedStoreId,
    stores: stores ?? [],
  };
};

export const createAllProductsExportFile = async (): Promise<ProductExportFile> => {
  const client = requireClient();
  const [productsResult, storesResult] = await Promise.all([
    client
      .from('products')
      .select('*')
      .order('store_id', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    client.from('stores').select('*').order('name', { ascending: true }),
  ]);

  if (productsResult.error) {
    throw new Error(productsResult.error.message);
  }
  if (storesResult.error) {
    throw new Error(storesResult.error.message);
  }

  const storeNames = new Map((storesResult.data ?? []).map((store) => [store.id, store.name]));
  const products = productsResult.data ?? [];
  const rows = products.map((product) => ({
    门店: storeNames.get(product.store_id) ?? product.store_id,
    货品名称: product.name,
    规格: product.spec,
    单位: product.count_unit,
    排序: product.sort_order,
    状态: product.is_active ? '启用' : '停用',
    创建时间: product.created_at,
    更新时间: product.updated_at,
  }));
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: ['门店', '货品名称', '规格', '单位', '排序', '状态', '创建时间', '更新时间'],
  });
  sheet['!cols'] = [
    { wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 22 }, { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, '全部货品');

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return {
    blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    count: products.length,
    filename: `全部货品_${new Date().toISOString().slice(0, 10)}.xlsx`,
  };
};

export const downloadProductExportFile = ({ blob, filename }: ProductExportFile) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const loadProductFeedbackRecords = async (): Promise<ProductFeedbackRecord[]> => {
  const client = requireClient();
  const { data: feedback, error } = await client
    .from('product_feedback')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }
  if (!feedback || feedback.length === 0) {
    return [];
  }

  const [storesResult, profilesResult] = await Promise.all([
    client.from('stores').select('*').in('id', Array.from(new Set(feedback.map((item) => item.store_id)))),
    client.from('profiles').select('*').in('id', Array.from(new Set(feedback.map((item) => item.created_by)))),
  ]);

  if (storesResult.error) {
    throw new Error(storesResult.error.message);
  }
  if (profilesResult.error) {
    throw new Error(profilesResult.error.message);
  }

  const storeNames = new Map((storesResult.data ?? []).map((store) => [store.id, store.name]));
  const creatorNames = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.display_name]));

  return feedback.map((item) => ({
    creatorName: creatorNames.get(item.created_by) ?? '未知提交人',
    feedback: item,
    storeName: storeNames.get(item.store_id) ?? '未知门店',
  }));
};

export const createProduct = async (draft: ProductDraft) => {
  const client = requireClient();
  const { error } = await client.from('products').insert({
    count_unit: draft.count_unit,
    is_active: draft.is_active,
    name: draft.name,
    product_code: draft.product_code || null,
    sort_order: draft.sort_order,
    spec: draft.spec,
    store_id: draft.store_id,
  });

  if (error) {
    throw new Error(error.message);
  }
};

export const updateProduct = async (productId: string, draft: ProductDraft) => {
  const client = requireClient();
  const { error } = await client
    .from('products')
    .update({
      count_unit: draft.count_unit,
      is_active: draft.is_active,
      name: draft.name,
      product_code: draft.product_code || null,
      sort_order: draft.sort_order,
      spec: draft.spec,
      store_id: draft.store_id,
    })
    .eq('id', productId);

  if (error) {
    throw new Error(error.message);
  }
};

export const archiveProduct = async (productId: string) => {
  const client = requireClient();
  const { error } = await client
    .from('products')
    .update({ is_active: false })
    .eq('id', productId);

  if (error) {
    throw new Error(error.message);
  }
};

export const restoreProduct = async (productId: string) => {
  const client = requireClient();
  const { error } = await client
    .from('products')
    .update({ is_active: true })
    .eq('id', productId);

  if (error) {
    throw new Error(error.message);
  }
};

export const deleteProduct = async (productId: string) => {
  const client = requireClient();
  const { error } = await client
    .from('products')
    .delete()
    .eq('id', productId);

  if (error) {
    throw new Error(error.message);
  }
};

export const parseProductImportFile = async (file: File): Promise<ProductImportRow[]> => {
  const buffer = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    throw new Error('Excel 中没有可读取的 Sheet');
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return rawRows.map((row, index) => {
    const name = pick(row, ['货品名称', '商品名称', '名称', 'name']);
    const spec = pick(row, ['规格', 'spec']);
    const countUnit = pick(row, ['单位', '计数单位', 'count_unit', 'unit']);
    const productCode = pick(row, ['货品编码', '商品编码', '编码', 'product_code', 'code']);
    const sortOrder = Number(pick(row, ['排序', 'sort_order', 'order']));
    return {
      count_unit: countUnit,
      is_active: toBoolean(pick(row, ['启用', '是否启用', 'is_active', 'active'])),
      name,
      product_code: productCode || null,
      row_number: index + 2,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      spec,
    };
  });
};

export const importProducts = async (storeId: string, rows: ProductImportRow[]): Promise<ProductImportResult> => {
  const client = requireClient();
  let inserted = 0;
  let updated = 0;
  const failures: ProductImportFailure[] = [];

  for (const row of rows) {
    const missingFields = [!row.name && '货品名称', !row.spec && '规格', !row.count_unit && '单位'].filter(Boolean);
    const item = `Excel 第 ${row.row_number} 行${row.name ? ` · ${row.name}` : ''}`;
    if (missingFields.length) {
      failures.push({ item, reason: `缺少必填字段：${missingFields.join('、')}。`, rowNumber: row.row_number });
      continue;
    }

    try {
      let existing: ProductRow | null = null;
      if (row.product_code) {
        const { data, error } = await client
          .from('products')
          .select('*')
          .eq('store_id', storeId)
          .eq('product_code', row.product_code)
          .maybeSingle();
        if (error) {
          throw new Error(error.message);
        }
        existing = data;
      }

      if (!existing) {
        const { data, error } = await client
          .from('products')
          .select('*')
          .eq('store_id', storeId)
          .eq('name', row.name)
          .eq('spec', row.spec)
          .eq('count_unit', row.count_unit)
          .maybeSingle();
        if (error) {
          throw new Error(error.message);
        }
        existing = data;
      }

      const payload = {
        count_unit: row.count_unit,
        is_active: row.is_active,
        name: row.name,
        product_code: row.product_code,
        sort_order: row.sort_order,
        spec: row.spec,
        store_id: storeId,
      };

      if (existing) {
        const { error } = await client.from('products').update(payload).eq('id', existing.id);
        if (error) {
          throw new Error(error.message);
        }
        updated += 1;
      } else {
        const { error } = await client.from('products').insert(payload);
        if (error) {
          throw new Error(error.message);
        }
        inserted += 1;
      }
    } catch (error) {
      failures.push({
        item,
        reason: error instanceof Error ? error.message : '该货品写入失败。',
        rowNumber: row.row_number,
      });
    }
  }

  return {
    failed: failures.length,
    failures,
    inserted,
    succeeded: inserted + updated,
    total: rows.length,
    updated,
  };
};

export const updateFeedbackStatus = async (
  feedbackId: string,
  values: {
    handledBy: string;
    resolutionNote?: string;
    status: ProductFeedbackRow['status'];
  },
) => {
  const client = requireClient();
  const { error } = await client
    .from('product_feedback')
    .update({
      handled_at: new Date().toISOString(),
      handled_by: values.handledBy,
      resolution_note: values.resolutionNote || null,
      status: values.status,
    })
    .eq('id', feedbackId);

  if (error) {
    throw new Error(error.message);
  }
};

export type AdminFeedbackAction = 'acknowledge' | 'confirm_delete' | 'ignore' | 'resolve' | 'revert';

export const handleProductFeedbackAction = async (
  feedbackId: string,
  action: AdminFeedbackAction,
  resolutionNote?: string,
) => {
  const client = requireClient();
  const { data, error } = await client.rpc('admin_handle_product_feedback', {
    p_feedback_id: feedbackId,
    p_action: action,
    p_resolution_note: resolutionNote || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
};

export const isAppliedProductCorrection = (feedback: ProductFeedbackRow) => {
  const changes = feedback.suggested_changes;
  return feedback.feedback_type === 'incorrect'
    && Boolean(changes && typeof changes === 'object' && !Array.isArray(changes) && typeof changes.name === 'string');
};

export const feedbackProductSnapshots = (feedback: ProductFeedbackRow) => ({
  original: asProductSnapshot(feedback.original_snapshot as Json),
  suggested: isAppliedProductCorrection(feedback)
    ? asProductSnapshot(feedback.suggested_changes as Json)
    : null,
});

export const feedbackProductText = (feedback: Pick<ProductFeedbackRow, 'original_snapshot'>) => {
  const snapshot = asProductSnapshot(feedback.original_snapshot as Json);
  return `${snapshot.name} ${snapshot.spec} ${snapshot.count_unit}`.trim();
};
