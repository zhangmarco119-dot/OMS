import type { SupabaseClient } from '@supabase/supabase-js';

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
  itemSummary: string;
  productTypeCount: number;
  thumbnailUrl: string | null;
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
  const { data, error } = await client.storage.from(imageBucket).createSignedUrl(objectPath, 3600);
  throwIfError(error);
  return data?.signedUrl ?? null;
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

  return Promise.all(rows.flatMap((notification) => {
    const report = reportById.get(notification.entity_id);
    if (!report) return [];
    const image = firstImageByReport.get(report.id);
    return [{
      notification,
      report,
      thumbnailUrl: image ? createSignedUrl(client, image.object_path) : Promise.resolve(null),
    }];
  }).map(async (message) => ({ ...message, thumbnailUrl: await message.thumbnailUrl })));
};

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

export const loadAdminArrivalList = async (client: Client, filters: AdminArrivalListFilters) => {
  const pageSize = filters.pageSize ?? 20;
  const from = Math.max(0, filters.page - 1) * pageSize;
  let query = client
    .from('arrival_reports')
    .select('*', { count: 'exact' })
    .neq('status', 'draft')
    .order('submitted_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (filters.storeId) query = query.eq('store_id', filters.storeId);
  if (filters.dateFrom) query = query.gte('arrival_date', filters.dateFrom);
  if (filters.dateTo) query = query.lte('arrival_date', filters.dateTo);
  if (filters.status !== 'all') query = query.eq('status', filters.status);

  const { data, error, count } = await query;
  throwIfError(error);
  const reports = data ?? [];
  if (!reports.length) return { count: count ?? 0, reports: [] as AdminArrivalListItem[] };
  const reportIds = reports.map((report) => report.id);
  const [itemsResult, imagesResult] = await Promise.all([
    client.from('arrival_report_items').select('report_id,product_name_snapshot,quantity,unit').in('report_id', reportIds).order('sort_order'),
    client.from('arrival_report_images').select('*').in('report_id', reportIds).order('created_at'),
  ]);
  throwIfError(itemsResult.error);
  throwIfError(imagesResult.error);
  const itemsByReport = new Map<string, typeof itemsResult.data>();
  for (const item of itemsResult.data ?? []) itemsByReport.set(item.report_id, [...(itemsByReport.get(item.report_id) ?? []), item]);
  const firstImageByReport = new Map<string, AdminArrivalImage>();
  for (const image of imagesResult.data ?? []) {
    const existing = firstImageByReport.get(image.report_id);
    if (!existing || existing.image_type === 'waybill' && image.image_type === 'goods') firstImageByReport.set(image.report_id, image);
  }
  const listItems = await Promise.all(reports.map(async (report): Promise<AdminArrivalListItem> => {
    const items = itemsByReport.get(report.id) ?? [];
    const productTypes = new Set(items.map((item) => `${item.product_name_snapshot}\u0000${item.unit}`));
    const quantityByUnit = items.reduce((summary, item) => {
      const unit = item.unit?.trim() || '件';
      summary.set(unit, (summary.get(unit) ?? 0) + Number(item.quantity ?? 0));
      return summary;
    }, new Map<string, number>());
    const quantity = [...quantityByUnit.entries()].map(([unit, value]) => `${Number(value.toFixed(2))}${unit}`).join(' / ');
    const image = firstImageByReport.get(report.id);
    return {
      ...report,
      itemSummary: `${productTypes.size} 种${quantity ? ` · ${quantity}` : ''}`,
      productTypeCount: productTypes.size,
      thumbnailUrl: image ? await createSignedUrl(client, image.object_path) : null,
    };
  }));
  return { count: count ?? 0, reports: listItems };
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

  const images = await Promise.all((imageResult.data ?? []).map(async (image) => ({
    ...image,
    signedUrl: (await createSignedUrl(client, image.object_path)) ?? '',
  })));
  return {
    auditLogs: auditResult.data ?? [],
    images,
    items: itemResult.data ?? [],
    report: reportResult.data,
  };
};

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
