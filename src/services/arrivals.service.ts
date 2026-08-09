import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { isCompleteArrivalItem, type ArrivalDraftItem } from '../features/arrivals/arrivalForm';
import { loadArrivalImageMetadata, type ArrivalImageWithUrl } from './arrival-images.service';
import type { Database } from '../types/database';

type Client = SupabaseClient<Database>;
export type ArrivalReportRow = Database['public']['Tables']['arrival_reports']['Row'];
export type ArrivalImageRow = Database['public']['Tables']['arrival_report_images']['Row'];
export type ProductRow = Database['public']['Tables']['products']['Row'];
export type ArrivalCorrectionRequestRow = Database['public']['Tables']['arrival_report_correction_requests']['Row'];

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

const correctionFieldsSchema = z.object({
  arrival_date: z.string(),
  arrival_time: z.string().nullable(),
  carrier_name: z.string().nullable(),
  note: z.string().nullable(),
  tracking_no: z.string().nullable(),
});

const correctionItemSchema = z.object({
  id: z.string().uuid(),
  is_unmatched_product: z.boolean(),
  note: z.string().nullable(),
  product_id: z.string().uuid().nullable(),
  product_name_snapshot: z.string(),
  quantity: z.number().positive(),
  sort_order: z.number().int().nonnegative(),
  unit: z.string(),
});

const correctionRequestSchema = z.object({
  created_at: z.string(),
  id: z.string().uuid(),
  original_version: z.number().int().positive(),
  proposed_fields: correctionFieldsSchema,
  proposed_items: z.array(correctionItemSchema),
  report_id: z.string().uuid(),
  requested_by: z.string().uuid(),
  requester_role: z.enum(['staff', 'manager']),
  review_note: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  reviewed_by: z.string().uuid().nullable(),
  status: z.enum(['pending', 'approved', 'rejected']),
  store_id: z.string().uuid(),
  updated_at: z.string(),
});

export type ArrivalCorrectionFields = z.infer<typeof correctionFieldsSchema>;
export type ArrivalCorrectionItem = z.infer<typeof correctionItemSchema>;
export type ArrivalCorrectionRequest = z.infer<typeof correctionRequestSchema>;

export interface ArrivalCorrectionListItem {
  report: ArrivalReportRow;
  request: ArrivalCorrectionRequest;
  requesterName: string;
}

export interface ArrivalCorrectionEditorData {
  items: ArrivalDraftItem[];
  products: ProductRow[];
  report: ArrivalReportRow;
}

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

export interface ArrivalProductCreationRequestInput {
  arrivalItemId: string;
  categoryCode: Database['public']['Tables']['products']['Row']['category_code'];
  countUnit: string;
  name: string;
  specification: string;
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

export const resetArrivalDraft = async (client: Client, reportId: string, expectedVersion: number) => {
  const { data, error } = await client.rpc('reset_arrival_draft', {
    p_expected_version: expectedVersion,
    p_report_id: reportId,
  });
  if (error) throw new Error(error.message);
  const parsed = arrivalReportRpcSchema.safeParse(data);
  if (!parsed.success) throw new Error('数据库返回的空白到货草稿格式无效，请刷新后重试。');
  return parsed.data as ArrivalReportRow;
};

export const submitArrivalReport = async (
  client: Client,
  reportId: string,
  expectedVersion: number,
  idempotencyKey: string,
  requests: ArrivalProductCreationRequestInput[] = [],
) => {
  const { data, error } = await client.rpc('submit_arrival_report_with_product_requests', {
    p_expected_version: expectedVersion,
    p_idempotency_key: idempotencyKey,
    p_requests: requests.map((request) => ({
      arrival_item_id: request.arrivalItemId,
      category_code: request.categoryCode,
      count_unit: request.countUnit.trim(),
      name: request.name.trim(),
      spec: request.specification.trim(),
    })),
    p_report_id: reportId,
  });

  if (error) {
    throw new Error(error.message);
  }
  return data;
};

export const requestArrivalProductCreation = async (
  client: Client,
  reportId: string,
  requests: ArrivalProductCreationRequestInput[],
) => {
  if (requests.length === 0) return [];
  const { data, error } = await client.rpc('request_arrival_product_creation', {
    p_report_id: reportId,
    p_requests: requests.map((request) => ({
      arrival_item_id: request.arrivalItemId,
      category_code: request.categoryCode,
      count_unit: request.countUnit.trim(),
      name: request.name.trim(),
      spec: request.specification.trim(),
    })),
  });
  if (error) throw new Error(error.message);
  return data ?? [];
};

export const loadArrivalHistory = async (client: Client, storeId: string, dateFrom?: string, dateTo?: string) => {
  let query = client
    .from('arrival_reports')
    .select('*')
    .eq('store_id', storeId)
    .neq('status', 'draft');
  if (dateFrom) query = query.gte('arrival_date', dateFrom);
  if (dateTo) query = query.lte('arrival_date', dateTo);
  const { data, error } = await query.order('submitted_at', { ascending: false }).limit(200);

  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
};

export const loadArrivalCorrectionEditor = async (
  client: Client,
  reportId: string,
): Promise<ArrivalCorrectionEditorData> => {
  const reportResult = await client.from('arrival_reports').select('*').eq('id', reportId).single();
  if (reportResult.error) throw new Error(reportResult.error.message);
  const [itemResult, productResult] = await Promise.all([
    client.from('arrival_report_items').select('*').eq('report_id', reportId).order('sort_order'),
    client.from('products').select('*').eq('store_id', reportResult.data.store_id).eq('is_active', true).order('sort_order').order('name'),
  ]);
  if (itemResult.error) throw new Error(itemResult.error.message);
  if (productResult.error) throw new Error(productResult.error.message);
  const products = productResult.data ?? [];
  const productById = new Map(products.map((product) => [product.id, product]));
  return {
    items: (itemResult.data ?? []).map((item) => toDraftItem(item, productById)),
    products,
    report: reportResult.data,
  };
};

const parseCorrectionRequest = (value: unknown) => {
  const parsed = correctionRequestSchema.safeParse(value);
  if (!parsed.success) throw new Error('数据库返回的到货更正申请格式无效，请刷新后重试。');
  return parsed.data;
};

export const submitArrivalCorrectionRequest = async (
  client: Client,
  reportId: string,
  fields: ArrivalCorrectionFields,
  items: ArrivalDraftItem[],
) => {
  const { data, error } = await client.rpc('submit_arrival_correction_request', {
    p_fields: fields,
    p_items: items.map((item, index) => ({
      id: item.id,
      note: item.note,
      product_id: item.productId,
      product_name_snapshot: item.productName.trim(),
      quantity: Number(item.quantity),
      sort_order: index,
      unit: item.unit.trim(),
    })),
    p_report_id: reportId,
  });
  if (error) throw new Error(error.message);
  return parseCorrectionRequest(data);
};

export const adminUpdateArrivalReport = async (
  client: Client,
  reportId: string,
  fields: ArrivalCorrectionFields,
  items: ArrivalDraftItem[],
) => {
  const { data, error } = await client.rpc('admin_update_arrival_report', {
    p_fields: fields,
    p_items: items.map((item, index) => ({
      id: item.id,
      note: item.note,
      product_id: item.productId,
      product_name_snapshot: item.productName.trim(),
      quantity: Number(item.quantity),
      sort_order: index,
      unit: item.unit.trim(),
    })),
    p_report_id: reportId,
  });
  if (error) throw new Error(error.message);
  const parsed = arrivalReportRpcSchema.safeParse(data);
  if (!parsed.success) throw new Error('数据库返回的到货记录格式无效，请刷新后重试。');
  return parsed.data as ArrivalReportRow;
};

export const loadLatestArrivalCorrection = async (client: Client, reportId: string) => {
  const { data, error } = await client
    .from('arrival_report_correction_requests')
    .select('*')
    .eq('report_id', reportId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? parseCorrectionRequest(data) : null;
};

export const loadPendingArrivalCorrections = async (client: Client): Promise<ArrivalCorrectionListItem[]> => {
  const { data, error } = await client
    .from('arrival_report_correction_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const requests = (data ?? []).map(parseCorrectionRequest);
  if (requests.length === 0) return [];
  const [reportsResult, profilesResult] = await Promise.all([
    client.from('arrival_reports').select('*').in('id', requests.map((request) => request.report_id)),
    client.from('profiles').select('id, display_name').in('id', requests.map((request) => request.requested_by)),
  ]);
  if (reportsResult.error) throw new Error(reportsResult.error.message);
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  const reportById = new Map((reportsResult.data ?? []).map((report) => [report.id, report]));
  const nameById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.display_name]));
  return requests.flatMap((request) => {
    const report = reportById.get(request.report_id);
    return report ? [{ report, request, requesterName: nameById.get(request.requested_by) ?? '提交人' }] : [];
  });
};

export const loadArrivalCorrectionRequest = async (client: Client, requestId: string) => {
  const { data, error } = await client
    .from('arrival_report_correction_requests')
    .select('*')
    .eq('id', requestId)
    .single();
  if (error) throw new Error(error.message);
  const request = parseCorrectionRequest(data);
  const [reportResult, profileResult] = await Promise.all([
    client.from('arrival_reports').select('*').eq('id', request.report_id).single(),
    client.from('profiles').select('id, display_name').eq('id', request.requested_by).single(),
  ]);
  if (reportResult.error) throw new Error(reportResult.error.message);
  if (profileResult.error) throw new Error(profileResult.error.message);
  return { report: reportResult.data, request, requesterName: profileResult.data.display_name };
};

export const reviewArrivalCorrectionRequest = async (
  client: Client,
  requestId: string,
  approve: boolean,
  note: string,
) => {
  const { data, error } = await client.rpc('review_arrival_correction_request', {
    p_approve: approve,
    p_note: note.trim() || null,
    p_request_id: requestId,
  });
  if (error) throw new Error(error.message);
  return parseCorrectionRequest(data);
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
    loadArrivalImageMetadata(client, reportId),
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
