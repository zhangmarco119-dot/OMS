import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { isCompleteArrivalItem, type ArrivalDraftItem } from '../features/arrivals/arrivalForm';
import { loadArrivalImages, type ArrivalImageWithUrl } from './arrival-images.service';
import type { Database } from '../types/database';

type Client = SupabaseClient<Database>;
export type ArrivalReportRow = Database['public']['Tables']['arrival_reports']['Row'];
export type ArrivalImageRow = Database['public']['Tables']['arrival_report_images']['Row'];
export type ProductRow = Database['public']['Tables']['products']['Row'];

const arrivalReportRpcSchema = z.object({
  arrival_date: z.string(),
  arrival_time: z.string().nullable(),
  carrier_name: z.string().nullable(),
  created_at: z.string(),
  generated_summary: z.string(),
  id: z.string().uuid(),
  note: z.string().nullable(),
  report_no: z.string(),
  reported_by: z.string().uuid(),
  reporter_name_snapshot: z.string(),
  status: z.enum(['draft', 'submitted', 'viewed', 'voided']),
  store_id: z.string().uuid(),
  store_name_snapshot: z.string(),
  submission_key: z.string().nullable(),
  submitted_at: z.string().nullable(),
  tracking_no: z.string().nullable(),
  updated_at: z.string(),
  version: z.number().int().positive(),
  viewed_at: z.string().nullable(),
  viewed_by: z.string().uuid().nullable(),
  void_reason: z.string().nullable(),
  voided_at: z.string().nullable(),
  voided_by: z.string().uuid().nullable(),
});

export interface ArrivalDraftData {
  items: ArrivalDraftItem[];
  products: ProductRow[];
  report: ArrivalReportRow;
}

export interface ArrivalReportDetail {
  images: ArrivalImageWithUrl[];
  items: Database['public']['Tables']['arrival_report_items']['Row'][];
  report: ArrivalReportRow;
}

export interface SaveArrivalDraftInput {
  arrivalDate: string;
  arrivalTime: string;
  carrierName: string;
  expectedVersion: number;
  items: ArrivalDraftItem[];
  note: string;
  reportId: string;
  trackingNo: string;
}

export const localArrivalDate = (now = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

export const localArrivalTime = (now = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

export const applyArrivalOpenedAt = <Form extends { arrivalDate: string; arrivalTime: string }>(form: Form, openedAt = new Date()): Form => ({
  ...form,
  arrivalDate: localArrivalDate(openedAt),
  arrivalTime: localArrivalTime(openedAt),
});

const toDraftItem = (
  row: Database['public']['Tables']['arrival_report_items']['Row'],
  productById: Map<string, ProductRow>,
): ArrivalDraftItem => ({
  id: row.id,
  isUnmatchedProduct: row.is_unmatched_product,
  note: row.note ?? '',
  productId: row.product_id,
  productName: row.product_name_snapshot,
  quantity: String(row.quantity),
  sortOrder: row.sort_order,
  spec: row.product_id ? productById.get(row.product_id)?.spec ?? '' : '',
  unit: row.unit,
});

export const loadOrCreateArrivalDraft = async (
  client: Client,
  storeId: string,
  profileId: string,
  reportId?: string,
): Promise<ArrivalDraftData> => {
  let existingQuery = client
    .from('arrival_reports')
    .select('*')
    .eq('store_id', storeId)
    .eq('reported_by', profileId)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (reportId) existingQuery = existingQuery.eq('id', reportId);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  let report = existing;
  if (reportId && !report) {
    throw new Error('需要修改的到货草稿不存在或无权访问。');
  }
  if (!report) {
    const { data: created, error: createError } = await client
      .from('arrival_reports')
      .insert({
        arrival_date: localArrivalDate(),
        arrival_time: localArrivalTime(),
        reported_by: profileId,
        store_id: storeId,
      })
      .select('*')
      .single();

    if (createError) {
      if (createError.code !== '23505') {
        throw new Error(createError.message);
      }
      const { data: concurrentDraft, error: concurrentError } = await client
        .from('arrival_reports')
        .select('*')
        .eq('store_id', storeId)
        .eq('reported_by', profileId)
        .eq('status', 'draft')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();
      if (concurrentError) {
        throw new Error(concurrentError.message);
      }
      report = concurrentDraft;
    } else {
      report = created;
    }
  }

  const [itemsResult, productsResult] = await Promise.all([
    client
      .from('arrival_report_items')
      .select('*')
      .eq('report_id', report.id)
      .order('sort_order', { ascending: true }),
    client
      .from('products')
      .select('*')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  ]);

  if (itemsResult.error) {
    throw new Error(itemsResult.error.message);
  }
  if (productsResult.error) {
    throw new Error(productsResult.error.message);
  }

  const products = productsResult.data ?? [];
  const productById = new Map(products.map((product) => [product.id, product]));
  return {
    items: (itemsResult.data ?? []).map((entry) => toDraftItem(entry, productById)),
    products,
    report,
  };
};

export const saveArrivalDraft = async (client: Client, input: SaveArrivalDraftInput) => {
  const completeItems = input.items.filter(isCompleteArrivalItem);
  const { data, error } = await client.rpc('save_arrival_draft', {
    p_expected_version: input.expectedVersion,
    p_fields: {
      arrival_date: input.arrivalDate,
      arrival_time: input.arrivalTime,
      carrier_name: input.carrierName,
      note: input.note,
      tracking_no: input.trackingNo,
    },
    p_items: completeItems.map((item, index) => ({
      id: item.id,
      note: item.note,
      product_id: item.productId,
      product_name_snapshot: item.productName.trim(),
      quantity: Number(item.quantity),
      sort_order: index,
      unit: item.unit.trim(),
    })),
    p_report_id: input.reportId,
  });

  if (error) {
    throw new Error(error.message);
  }
  const parsed = arrivalReportRpcSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('数据库返回的到货草稿格式无效，请刷新后重试。');
  }
  return parsed.data as ArrivalReportRow;
};

export const submitArrivalReport = async (
  client: Client,
  reportId: string,
  expectedVersion: number,
  idempotencyKey: string,
) => {
  const { data, error } = await client.rpc('submit_arrival_report', {
    p_expected_version: expectedVersion,
    p_idempotency_key: idempotencyKey,
    p_report_id: reportId,
  });

  if (error) {
    throw new Error(error.message);
  }
  return data;
};

export const loadArrivalHistory = async (client: Client, storeId: string) => {
  const { data, error } = await client
    .from('arrival_reports')
    .select('*')
    .eq('store_id', storeId)
    .neq('status', 'draft')
    .order('submitted_at', { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
};

export const loadArrivalReport = async (client: Client, reportId: string) => {
  const { data, error } = await client
    .from('arrival_reports')
    .select('*')
    .eq('id', reportId)
    .single();

  if (error) {
    throw new Error(error.message);
  }
  return data;
};

export const loadArrivalReportDetail = async (
  client: Client,
  reportId: string,
): Promise<ArrivalReportDetail> => {
  const [reportResult, itemResult, images] = await Promise.all([
    client.from('arrival_reports').select('*').eq('id', reportId).single(),
    client.from('arrival_report_items').select('*').eq('report_id', reportId).order('sort_order'),
    loadArrivalImages(client, reportId),
  ]);
  if (reportResult.error) throw new Error(reportResult.error.message);
  if (itemResult.error) throw new Error(itemResult.error.message);
  return {
    images,
    items: itemResult.data ?? [],
    report: reportResult.data,
  };
};

export const reopenVoidedArrivalReport = async (client: Client, reportId: string) => {
  const { data, error } = await client.rpc('reopen_voided_arrival_report', {
    p_report_id: reportId,
  });
  if (error) throw new Error(error.message);
  const parsed = arrivalReportRpcSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('数据库返回的到货草稿格式无效，请刷新后重试。');
  }
  return parsed.data as ArrivalReportRow;
};
