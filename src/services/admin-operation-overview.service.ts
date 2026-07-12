import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../types/database';

export interface AdminOperationOverview {
  arrival_pending: number;
  arrival_today: number;
  inventory_completed_today: number;
  inventory_pending: number;
  v2_task_active: number;
  v2_task_completed: number;
}

export const loadAdminOperationOverview = async (client: SupabaseClient<Database>): Promise<AdminOperationOverview> => {
  const { data, error } = await client.rpc('admin_operation_overview');
  if (error) throw new Error(error.message);
  return data?.[0] ?? { arrival_pending: 0, arrival_today: 0, inventory_completed_today: 0, inventory_pending: 0, v2_task_active: 0, v2_task_completed: 0 };
};
