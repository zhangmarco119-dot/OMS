import type { SupabaseClient } from '@supabase/supabase-js';

import { loadStorageImageResource } from '../lib/imageResourceCache';
import type { Database } from '../types/database';

type Client = SupabaseClient<Database>;
export type AdminArrivalReport = Database['public']['Tables']['arrival_reports']['Row'];
export type AdminArrivalItem = Database['public']['Tables']['arrival_report_items']['Row'];
export type AdminArrivalImage = Database['public']['Tables']['arrival_report_images']['Row'];
export type AdminArrivalNotification = Database['public']['Tables']['notifications']['Row'];
export type AdminArrivalAuditLog = Database['public']['Tables']['audit_logs']['Row'];
export type ArrivalDetailRow = Database['public']['Views']['arrival_daily_detail_view']['Row'];
export type ArrivalProductSummaryRow = Database['public']['Views']['arrival_daily_product_summary_view']['Row'];

export interface AdminArrivalMessage {
  notification: AdminArrivalNotification;
  report: AdminArrivalReport;
  thumbnailObjectPath: string | null;
  thumbnailUrl: string | null;
}

export interface AdminArrivalDashboardData {
  messages: AdminArrivalMessage[];
  metrics: {
    reportCount: number;
    storeCount: number;
    productCount: number;
    unreadCount: number;
  };
}

export interface AdminArrivalListFilters {
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize?: number;
  status: 'all' | AdminArrivalReport['status'];
  storeId: string;
}

export type AdminArrivalListItem = AdminArrivalReport & {
  allProductsMatched: boolean;
  itemSummary: string;
  productTypeCount: number;
  thumbnailObjectPath: string | null;
};

export interface AdminArrivalDetail {
  auditLogs: AdminArrivalAuditLog[];
  images: Array<AdminArrivalImage & { signedUrl: string }>;
  items: AdminArrivalItem[];
  report: AdminArrivalReport;
}

export interface AdminArrivalSummary {
  details: ArrivalDetailRow[];
  products: ArrivalProductSummaryRow[];
}

const imageBucket = 'arrival-report-images';

const throwIfError = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

const createSignedUrl = async (client: Client, objectPath: string) => {
  try {
    return await loadStorageImageResource(client, imageBucket, objectPath, {
      scope: 'session',
      variant: 'arrival',
    });
  } catch {
    return null;
  }
};

export const loadAdminArrivalThumbnail = async (client: Client, objectPath: string) => {
  try {
    return await loadStorageImageResource(client, imageBucket, objectPath, {
      scope: 'device',
      transform: { height: 160, quality: 55, resize: 'cover', width: 160 },
      variant: 'arrival-thumbnail',
      version: 'v1',
    });
  } catch {
    return null;
  }
};

export const localIsoDate = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

export const loadAdminArrivalMessages = async (client: Client, limit = 12): Promise<AdminArrivalMessage[]> => {
  const { data: notifications, error } = await client
    .from('notifications')
    .select('*')
    .eq('recipient_role', 'admin')
    .eq('entity_type', 'arrival_report')
    .eq('type', 'arrival_submitted')
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  throwIfError(error);

  const rows = notifications ?? [];
  if (rows.length === 0) return [];
  const reportIds = rows.map((item) => item.entity_id);
  const [{ data: reports, error: reportError }, { data: images, error: imageError }] = await Promise.all([
    client.from('arrival_reports').select('*').in('id', reportIds).eq('status', 'submitted'),
    client
      .from('arrival_report_images')
      .select('*')
      .in('report_id', reportIds)
      .eq('image_type', 'waybill')
      .order('created_at', { ascending: true }),
  ]);
  throwIfError(reportError);
  throwIfError(imageError);

  const reportById = new Map((reports ?? []).map((report) => [report.id, report]));
  const firstImageByReport = new Map<string, AdminArrivalImage>();
  (images ?? []).forEach((image) => {
    if (!firstImageByReport.has(image.report_id)) firstImageByReport.set(image.report_id, image);
  });

  return rows.flatMap((notification) => {
    const report = reportById.get(notification.entity_id);
    if (!report) return [];
    const image = firstImageByReport.get(report.id);
    return [{
      notification,
      report,
      thumbnailObjectPath: image?.object_path ?? null,
      thumbnailUrl: null,
    }];
  });
};

export const loadAdminArrivalMessageThumbnails = async (
  client: Client,
  messages: AdminArrivalMessage[],
): Promise<Record<string, string>> => Object.fromEntries(await Promise.all(messages.flatMap((message) => message.thumbnailObjectPath ? [[
  message,
]] : []).map(async ([message]) => [
  message.notification.id,
  (await loadAdminArrivalThumbnail(client, message.thumbnailObjectPath!)) ?? '',
])));

export const loadAdminArrivalDashboard = async (
  client: Client,
  date = localIsoDate(),
): Promise<AdminArrivalDashboardData> => {
  const [messages, unreadResult, reportsResult, detailsResult] = await Promise.all([
    loadAdminArrivalMessages(client, 6),
    client
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_role', 'admin')
      .eq('entity_type', 'arrival_report')
      .eq('type', 'arrival_submitted')
      .eq('is_read', false),
    client
      .from('arrival_reports')
      .select('id,store_id')
      .eq('arrival_date', date)
      .in('status', ['submitted', 'viewed']),
    client
      .from('arrival_daily_detail_view')
      .select('product_id,product_name_snapshot,unit')
      .eq('arrival_date', date),
  ]);
  throwIfError(unreadResult.error);
  throwIfError(reportsResult.error);
  throwIfError(detailsResult.error);

  const reports = reportsResult.data ?? [];
  const products = new Set((detailsResult.data ?? []).map((item) =>
    item.product_id ?? `${item.product_name_snapshot ?? ''}\u0000${item.unit ?? ''}`));
  return {
    messages,
    metrics: {
      productCount: products.size,
      reportCount: reports.length,
      storeCount: new Set(reports.map((report) => report.store_id)).size,
      unreadCount: unreadResult.count ?? 0,
    },
  };
};

export const loadAdminArrivalList = async (
  client: Client,
  filters: AdminArrivalListFilters,
  options: { signal?: AbortSignal } = {},
) => {
  const request = client.rpc('list_admin_arrivals_v1', {
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null,
    p_page: filters.page,
    p_page_size: filters.pageSize ?? 20,
    p_status: filters.status,
    p_store_id: filters.storeId || null,
  });
  const { data, error } = await (options.signal ? request.abortSignal(options.signal) : request);
  if (options.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
  throwIfError(error);
  const payload = data && typeof data === 'object' && !Array.isArray(data)
    ? data as { count?: unknown; reports?: unknown }
    : {};
  return {
    count: typeof payload.count === 'number' ? payload.count : 0,
    reports: Array.isArray(payload.reports) ? payload.reports as unknown as AdminArrivalListItem[] : [],
  };
};

export const loadAdminArrivalDetail = async (client: Client, reportId: string): Promise<AdminArrivalDetail> => {
  const [reportResult, itemResult, imageResult, auditResult] = await Promise.all([
    client.from('arrival_reports').select('*').eq('id', reportId).single(),
    client.from('arrival_report_items').select('*').eq('report_id', reportId).order('sort_order'),
    client.from('arrival_report_images').select('*').eq('report_id', reportId).order('created_at'),
    client
      .from('audit_logs')
      .select('*')
      .eq('entity_table', 'arrival_reports')
      .eq('entity_id', reportId)
      .order('created_at', { ascending: true }),
  ]);
  throwIfError(reportResult.error);
  throwIfError(itemResult.error);
  throwIfError(imageResult.error);
  throwIfError(auditResult.error);
  if (!reportResult.data) throw new Error('到货记录不存在或无权查看。');

  return {
    auditLogs: auditResult.data ?? [],
    images: (imageResult.data ?? []).map((image) => ({ ...image, signedUrl: '' })),
    items: itemResult.data ?? [],
    report: reportResult.data,
  };
};

export const loadAdminArrivalImageUrls = async (
  client: Client,
  images: AdminArrivalDetail['images'],
): Promise<Record<string, string>> => Object.fromEntries(await Promise.all(images.map(async (image) => [
  image.id,
  (await createSignedUrl(client, image.object_path)) ?? '',
])));

export const markAdminArrivalViewed = async (client: Client, reportId: string) => {
  const { data, error } = await client.rpc('mark_arrival_viewed', { p_report_id: reportId });
  throwIfError(error);
  return data;
};

export const voidAdminArrival = async (client: Client, reportId: string, reason: string) => {
  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error('请填写作废原因。');
  const { data, error } = await client.rpc('void_arrival_report', {
    p_reason: cleanReason,
    p_report_id: reportId,
  });
  throwIfError(error);
  return data;
};

export const loadAdminArrivalSummary = async (
  client: Client,
  range: { dateFrom: string; dateTo: string },
  storeId = '',
): Promise<AdminArrivalSummary> => {
  let detailQuery = client
    .from('arrival_daily_detail_view')
    .select('*')
    .gte('arrival_date', range.dateFrom)
    .lte('arrival_date', range.dateTo)
    .order('arrival_time', { ascending: true });
  let productQuery = client
    .from('arrival_daily_product_summary_view')
    .select('*')
    .gte('arrival_date', range.dateFrom)
    .lte('arrival_date', range.dateTo)
    .order('store_name_snapshot')
    .order('product_name_snapshot');
  if (storeId) {
    detailQuery = detailQuery.eq('store_id', storeId);
    productQuery = productQuery.eq('store_id', storeId);
  }
  const [details, products] = await Promise.all([detailQuery, productQuery]);
  throwIfError(details.error);
  throwIfError(products.error);
  const productRows = products.data ?? [];
  const mergedProducts = [...productRows.reduce((merged, row) => {
    const key = `${row.store_id ?? ''}:${row.product_name_snapshot ?? ''}:${row.unit ?? ''}`;
    const current = merged.get(key);
    merged.set(key, current ? {
      ...current,
      report_count: (current.report_count ?? 0) + (row.report_count ?? 0),
      total_quantity: (current.total_quantity ?? 0) + (row.total_quantity ?? 0),
    } : row);
    return merged;
  }, new Map<string, ArrivalProductSummaryRow>()).values()];
  return { details: details.data ?? [], products: mergedProducts };
};
