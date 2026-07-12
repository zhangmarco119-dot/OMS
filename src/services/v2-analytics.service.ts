import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '../types/database';

export interface AnalyticsTrendPoint { count: number; date: string; }
export interface StoreCompletionRate { approved: number; rate: number; store_id: string; store_name: string; total: number; }
export interface FrequentIssue { count: number; label: string; }
export interface V2Analytics {
  arrival: { pending: number; product_kinds: number; quantity_total: number; stores: number; today: number; trend: AnalyticsTrendPoint[] };
  inspection: { correction_completion_rate: number; frequent_issues: FrequentIssue[]; issue_count: number };
  tasks: { approved: number; completion_rate: number; overdue: number; pending: number; rejected: number; store_rates: StoreCompletionRate[]; submitted: number };
  v1: { inventory_submissions: number; open_inventory: number; order_submissions: number };
}

const numberAt = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const arrayAt = (value: unknown) => Array.isArray(value) ? value : [];
const objectAt = (value: Json | null): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const parseV2Analytics = (raw: Json | null): V2Analytics => {
  const root = objectAt(raw);
  const arrival = objectAt(root.arrival as Json);
  const tasks = objectAt(root.tasks as Json);
  const inspection = objectAt(root.inspection as Json);
  const v1 = objectAt(root.v1 as Json);
  return {
    arrival: {
      pending: numberAt(arrival.pending), product_kinds: numberAt(arrival.product_kinds), quantity_total: numberAt(arrival.quantity_total), stores: numberAt(arrival.stores), today: numberAt(arrival.today),
      trend: arrayAt(arrival.trend).map((point) => { const entry = objectAt(point as Json); return { count: numberAt(entry.count), date: typeof entry.date === 'string' ? entry.date : '' }; }),
    },
    inspection: {
      correction_completion_rate: numberAt(inspection.correction_completion_rate), issue_count: numberAt(inspection.issue_count),
      frequent_issues: arrayAt(inspection.frequent_issues).map((issue) => { const entry = objectAt(issue as Json); return { count: numberAt(entry.count), label: typeof entry.label === 'string' ? entry.label : '未命名项目' }; }),
    },
    tasks: {
      approved: numberAt(tasks.approved), completion_rate: numberAt(tasks.completion_rate), overdue: numberAt(tasks.overdue), pending: numberAt(tasks.pending), rejected: numberAt(tasks.rejected), submitted: numberAt(tasks.submitted),
      store_rates: arrayAt(tasks.store_rates).map((rate) => { const entry = objectAt(rate as Json); return { approved: numberAt(entry.approved), rate: numberAt(entry.rate), store_id: typeof entry.store_id === 'string' ? entry.store_id : '', store_name: typeof entry.store_name === 'string' ? entry.store_name : '未知门店', total: numberAt(entry.total) }; }),
    },
    v1: { inventory_submissions: numberAt(v1.inventory_submissions), open_inventory: numberAt(v1.open_inventory), order_submissions: numberAt(v1.order_submissions) },
  };
};

export const loadV2Analytics = async (client: SupabaseClient<Database>, days = 7) => {
  const { data, error } = await client.rpc('admin_v2_analytics', { p_days: days });
  if (error) throw new Error(error.message);
  return parseV2Analytics(data);
};
