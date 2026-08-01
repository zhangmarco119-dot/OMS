import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../types/database';

export const PRODUCT_CATEGORIES = [
  { code: 'fruit', label: '水果' },
  { code: 'frozen', label: '冷冻食材' },
  { code: 'other_food', label: '其他食材' },
  { code: 'packaging', label: '包材' },
  { code: 'consumable', label: '耗材' },
  { code: 'non_consumable', label: '非消耗性物品' },
] as const;

export type ProductCategoryCode = typeof PRODUCT_CATEGORIES[number]['code'];

export const DEFAULT_PRODUCT_CATEGORY: ProductCategoryCode = 'other_food';

export const productCategoryLabel = (code: string | null | undefined) => (
  PRODUCT_CATEGORIES.find((category) => category.code === code)?.label ?? '其他食材'
);

export const isProductCategoryCode = (value: string): value is ProductCategoryCode => (
  PRODUCT_CATEGORIES.some((category) => category.code === value)
);

export const loadProductCategories = async (client: SupabaseClient<Database>) => {
  const { data, error } = await client
    .from('product_categories')
    .select('*')
    .order('sort_order');
  if (error) throw new Error(error.message);
  return data ?? [];
};

export const updateProductCategory = async (
  client: SupabaseClient<Database>,
  productId: string,
  categoryCode: ProductCategoryCode,
) => {
  const { data, error } = await client.rpc('update_product_category', {
    p_category_code: categoryCode,
    p_product_id: productId,
  });
  if (error) throw new Error(error.message);
  return data;
};
