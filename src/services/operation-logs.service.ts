import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../types/database';

type Client = SupabaseClient<Database>;
type Row = Database['public']['Tables']['system_operation_logs']['Row'];
export type OperationLog = Omit<Row, 'metadata'> & { metadata: Record<string, Json | undefined> };
export type OperationLogFilters = { actorId?: string; endDate?: string; module?: string; operation?: string; search?: string; startDate?: string; storeId?: string };
export interface OperationLogActor { displayName: string; employmentType: 'full_time' | 'part_time' | null; id: string; role: 'staff' | 'manager' | 'admin' | 'system'; username: string }
export interface SystemActivityInput {
  context?: Record<string, Json | undefined>;
  module: 'auth' | 'attendance' | 'payroll';
  period?: string;
  storeId?: string;
  targetProfileId?: string;
  view: 'login' | 'month_summary' | 'month_detail' | 'estimate_summary' | 'estimate_detail' | 'payslip_list' | 'payslip_detail' | 'settings';
}
const pageSize = 30;

const metadata = (value: Json): Record<string, Json | undefined> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const objectAt = (value: Json): Record<string, Json | undefined> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export async function recordSystemActivity(client: Client, input: SystemActivityInput): Promise<void> {
  const context: Record<string, Json | undefined> = {
    ...input.context,
    pagePath: typeof window === 'undefined' ? undefined : `${window.location.pathname}${window.location.search}`,
    clientPlatform: typeof navigator === 'undefined' ? undefined : navigator.platform,
  };
  await client.rpc('record_system_activity', {
    p_module: input.module,
    p_view: input.view,
    p_period: input.period ?? null,
    p_store_id: input.storeId ?? null,
    p_target_profile_id: input.targetProfileId ?? null,
    p_context: context as Json,
  });
}

export async function loadOperationLogActors(client: Client): Promise<OperationLogActor[]> {
  const { data, error } = await client.rpc('list_system_operation_log_actors');
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map((value) => objectAt(value)).flatMap((row) => {
    if (typeof row.id !== 'string' || typeof row.display_name !== 'string') return [];
    const role = row.role;
    return [{
      displayName: row.display_name,
      employmentType: row.employment_type === 'part_time' ? 'part_time' : row.employment_type === 'full_time' ? 'full_time' : null,
      id: row.id,
      role: role === 'admin' || role === 'manager' || role === 'staff' ? role : 'system',
      username: typeof row.username === 'string' ? row.username : '',
    }];
  });
}

export async function loadOperationLogs(client: Client, filters: OperationLogFilters, offset = 0) {
  let query = client.from('system_operation_logs').select('*', { count: 'exact' }).order('occurred_at', { ascending: false }).range(offset, offset + pageSize - 1);
  if (filters.storeId) query = query.eq('store_id', filters.storeId);
  if (filters.actorId) query = query.eq('actor_id', filters.actorId);
  if (filters.module) query = query.eq('module', filters.module);
  if (filters.operation) query = query.eq('operation', filters.operation as Row['operation']);
  if (filters.startDate) query = query.gte('occurred_at', `${filters.startDate}T00:00:00+08:00`);
  if (filters.endDate) query = query.lte('occurred_at', `${filters.endDate}T23:59:59+08:00`);
  if (filters.search?.trim()) {
    const safe = filters.search.trim().replace(/[,%()]/g, ' ');
    query = query.or(`actor_name_snapshot.ilike.%${safe}%,actor_username_snapshot.ilike.%${safe}%,summary.ilike.%${safe}%`);
  }
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { items: (data ?? []).map((row) => ({ ...row, metadata: metadata(row.metadata) })) as OperationLog[], total: count ?? 0 };
}
