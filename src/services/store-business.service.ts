import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

export type StoreClosure = Database['public']['Tables']['store_business_closures']['Row'];
export async function loadStoreClosures(client: SupabaseClient<Database>) {
  const { data, error } = await client.from('store_business_closures').select('*').order('closed_from');
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function setStoreOperating(client: SupabaseClient<Database>, storeId: string, operating: boolean, effectiveDate: string) {
  const { error } = await client.rpc('admin_set_store_operating', { p_store_id: storeId, p_operating: operating, p_effective_date: effectiveDate });
  if (error) throw new Error(error.message);
}
export const storeOperatesOn = (closures: StoreClosure[], storeId: string, date: string) => !closures.some((row) => row.store_id === storeId && row.closed_from <= date && (!row.reopened_from || row.reopened_from > date));
