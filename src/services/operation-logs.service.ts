import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../types/database';

type Client = SupabaseClient<Database>;
type Row = Database['public']['Tables']['system_operation_logs']['Row'];
export type OperationLog = Omit<Row, 'metadata'> & { metadata: Record<string, string> };
export type OperationLogFilters = { endDate?: string; module?: string; operation?: string; search?: string; startDate?: string; storeId?: string };
const pageSize = 30;

const metadata = (value: Json): Record<string, string> => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item == null ? '' : String(item)])) : {};

export async function loadOperationLogs(client: Client, filters: OperationLogFilters, offset = 0) {
  let query = client.from('system_operation_logs').select('*', { count: 'exact' }).order('occurred_at', { ascending: false }).range(offset, offset + pageSize - 1);
  if (filters.storeId) query = query.eq('store_id', filters.storeId);
  if (filters.module) query = query.eq('module', filters.module);
  if (filters.operation) query = query.eq('operation', filters.operation as Row['operation']);
  if (filters.startDate) query = query.gte('occurred_at', `${filters.startDate}T00:00:00+08:00`);
  if (filters.endDate) query = query.lte('occurred_at', `${filters.endDate}T23:59:59+08:00`);
  if (filters.search?.trim()) {
    const safe = filters.search.trim().replace(/[,%()]/g, ' ');
    query = query.or(`actor_name_snapshot.ilike.%${safe}%,summary.ilike.%${safe}%`);
  }
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { items: (data ?? []).map((row) => ({ ...row, metadata: metadata(row.metadata) })) as OperationLog[], total: count ?? 0 };
}
