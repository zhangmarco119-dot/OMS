import { supabase } from '../../lib/supabase';
import type { Database, Json } from '../../types/database';
import type { ProductCategoryCode } from '../products/productCategories';
import type { TaskAudience, V2TaskRecipient } from '../../services/v2-tasks.service';

const STORAGE_KEY = 'storehub:product-correction-task-draft';

export interface ProductCorrectionTaskItem {
  category_code: ProductCategoryCode;
  count_unit: string;
  name: string;
  product_action: 'create' | 'update';
  product_id?: string;
  source_key?: string;
  spec: string;
}

export interface ProductCorrectionTaskDraft {
  items: ProductCorrectionTaskItem[];
  storeId: string;
  storeName: string;
}

const requireClient = () => {
  if (!supabase) throw new Error('Supabase 未配置');
  return supabase;
};

export const saveProductCorrectionTaskDraft = (draft: ProductCorrectionTaskDraft) => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
};

export const loadProductCorrectionTaskDraft = (): ProductCorrectionTaskDraft | null => {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null') as ProductCorrectionTaskDraft | null;
    return value?.storeId && Array.isArray(value.items) && value.items.length ? value : null;
  } catch {
    return null;
  }
};

export const clearProductCorrectionTaskDraft = () => window.sessionStorage.removeItem(STORAGE_KEY);

export const loadProductCorrectionRecipients = async (storeId: string): Promise<V2TaskRecipient[]> => {
  const client = requireClient();
  const [profilesResult, accessResult] = await Promise.all([
    client.from('profiles').select('id,username,display_name,employment_type,role,store_id').in('role', ['staff', 'manager']).eq('is_active', true).is('deleted_at', null).order('display_name'),
    client.from('profile_store_access').select('profile_id').eq('store_id', storeId),
  ]);
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (accessResult.error) throw new Error(accessResult.error.message);
  const accessibleIds = new Set((accessResult.data ?? []).map((row) => row.profile_id));
  return (profilesResult.data ?? []).filter((profile) => profile.store_id === storeId || accessibleIds.has(profile.id));
};

export const publishProductCorrectionTasks = async (input: {
  dueAt: string;
  items: ProductCorrectionTaskItem[];
  managerReviewEnabled: boolean;
  profileIds: string[];
  publishAt: string;
  storeId: string;
  targetAudiences: TaskAudience[];
}) => {
  const client = requireClient();
  const { data, error } = await client.rpc('publish_product_correction_tasks', {
    p_due_at: input.dueAt,
    p_items: input.items as unknown as Json,
    p_manager_review_enabled: input.managerReviewEnabled,
    p_profile_ids: input.profileIds,
    p_publish_at: input.publishAt,
    p_store_id: input.storeId,
    p_target_audiences: input.targetAudiences,
  });
  if (error) throw new Error(error.message);
  return data as Database['public']['Tables']['v2_tasks']['Row'][];
};
