import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../types/database';

type Client = SupabaseClient<Database>;
export type SystemDocumentRow = Database['public']['Tables']['v2_system_documents']['Row'];

export const systemDocumentSlugs = ['staff-manager-guide', 'admin-guide'] as const;
export type SystemDocumentSlug = (typeof systemDocumentSlugs)[number];

export const isSystemDocumentSlug = (value: string): value is SystemDocumentSlug =>
  systemDocumentSlugs.includes(value as SystemDocumentSlug);

export const loadSystemDocument = async (client: Client, slug: SystemDocumentSlug): Promise<SystemDocumentRow> => {
  const { data, error } = await client
    .from('v2_system_documents')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error('说明文档加载失败，请稍后重试。');
  if (!data || !data.content_html.trim()) throw new Error('说明文档尚未上传，请联系管理员。');
  return data;
};
