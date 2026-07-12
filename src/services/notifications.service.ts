import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../types/database';

type Client = SupabaseClient<Database>;
export type UserNotification = Database['public']['Tables']['notifications']['Row'];

export const loadNotifications = async (client: Client, limit = 5) => {
  const { data, error } = await client.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
};

export const markNotificationRead = async (client: Client, id: string) => {
  const { error } = await client.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
};
