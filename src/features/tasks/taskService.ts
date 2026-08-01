import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '../../types/database';
import type { TaskType } from '../../types/domain';
import { asProductSnapshot, type ProductSnapshot } from './taskCalculations';

type Client = SupabaseClient<Database>;
type ProductRow = Database['public']['Tables']['products']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type TaskRow = Database['public']['Tables']['tasks']['Row'];
type TaskItemRow = Database['public']['Tables']['task_items']['Row'];
type ProductFeedbackRow = Database['public']['Tables']['product_feedback']['Row'];
export type InventoryTemplate = Database['public']['Functions']['list_store_inventory_templates']['Returns'][number];

export interface TaskSessionData {
  task: TaskRow;
  items: TaskItemRow[];
}

export interface TaskWithItems {
  feedback: ProductFeedbackRow[];
  items: TaskItemRow[];
  task: TaskRow;
}

const productToSnapshot = (product: ProductRow): ProductSnapshot => ({
  category_code: product.category_code,
  product_id: product.id,
  name: product.name,
  spec: product.spec,
  count_unit: product.count_unit,
  product_code: product.product_code,
});

export const findMissingDraftProductIds = (
  activeProductIds: string[],
  existingItemProductIds: Array<string | null>,
) => {
  const existingIds = new Set(existingItemProductIds.filter((id): id is string => Boolean(id)));
  return activeProductIds.filter((id) => !existingIds.has(id));
};

export const findStaleDraftItemIds = (
  items: Array<Pick<TaskItemRow, 'id' | 'product_action_status' | 'product_snapshot'>>,
  activeProductIds: string[],
) => {
  const activeIds = new Set(activeProductIds);

  return items
    .filter((item) => {
      const snapshotProductId = asProductSnapshot(item.product_snapshot).product_id;
      return item.product_action_status === 'deletion_approved'
        || (snapshotProductId !== null && !activeIds.has(snapshotProductId));
    })
    .map((item) => item.id);
};

export const loadTaskItems = async (client: Client, taskId: string) => {
  const { data, error } = await client
    .from('task_items')
    .select('*')
    .eq('task_id', taskId)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
};

export const loadTaskFeedback = async (client: Client, itemIds: string[]) => {
  if (itemIds.length === 0) {
    return [];
  }

  const { data, error } = await client
    .from('product_feedback')
    .select('*')
    .in('task_item_id', itemIds)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
};

export const loadTaskWithItems = async (client: Client, taskId: string): Promise<TaskWithItems> => {
  const { data: task, error } = await client
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const items = await loadTaskItems(client, task.id);
  const feedback = await loadTaskFeedback(client, items.map((item) => item.id));

  return { feedback, items, task };
};

export const loadDraftTask = async (
  client: Client,
  profile: ProfileRow,
  taskType: TaskType,
  linkedV2TaskId?: string | null,
): Promise<TaskSessionData | null> => {
  let query = client
    .from('tasks')
    .select('*')
    .eq('store_id', profile.store_id)
    .eq('created_by', profile.id)
    .eq('task_type', taskType)
    .eq('status', 'draft');
  query = linkedV2TaskId
    ? query.eq('linked_v2_task_id', linkedV2TaskId)
    : query.is('linked_v2_task_id', null);
  const { data: task, error } = await query
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!task) {
    return null;
  }

  const items = await loadTaskItems(client, task.id);
  return {
    task,
    items: await syncDraftTaskProducts(client, task, items),
  };
};

const syncDraftTaskProducts = async (
  client: Client,
  task: TaskRow,
  items: TaskItemRow[],
) => {
  let productQuery = client
    .from('products')
    .select('*')
    .eq('store_id', task.store_id)
    .eq('is_active', true);
  if (task.task_type === 'inventory') productQuery = productQuery.in('category_code', task.inventory_category_codes);
  const { data: products, error: productsError } = await productQuery
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (productsError) {
    throw new Error(productsError.message);
  }

  const activeProductIds = (products ?? []).map((product) => product.id);
  const staleItemIds = findStaleDraftItemIds(items, activeProductIds);
  const staleItemIdSet = new Set(staleItemIds);

  if (staleItemIds.length > 0) {
    const { error: deleteError } = await client
      .from('task_items')
      .delete()
      .eq('task_id', task.id)
      .in('id', staleItemIds);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  const retainedItems = items.filter((item) => !staleItemIdSet.has(item.id));

  const missingProductIds = new Set(findMissingDraftProductIds(
    activeProductIds,
    retainedItems.map((item) => item.product_id),
  ));
  const missingProducts = (products ?? []).filter((product) => missingProductIds.has(product.id));

  if (missingProducts.length === 0) {
    return retainedItems;
  }

  const { data: inserted, error: insertError } = await client
    .from('task_items')
    .insert(missingProducts.map((product, index) => ({
      task_id: task.id,
      store_id: task.store_id,
      product_id: product.id,
      product_snapshot: productToSnapshot(product) as unknown as Json,
      quantity: null,
      status: 'pending' as const,
      is_extra_item: false,
      sort_order: product.sort_order || retainedItems.length + index + 1,
    })))
    .select('*');

  if (insertError) {
    throw new Error(insertError.message);
  }

  return [...retainedItems, ...(inserted ?? [])].sort((left, right) => left.sort_order - right.sort_order);
};

export const createDraftTask = async (
  client: Client,
  profile: ProfileRow,
  taskType: TaskType,
  linkedV2TaskId?: string | null,
): Promise<TaskSessionData> => {
  if (taskType === 'inventory' && linkedV2TaskId) {
    const { data: linkedTask, error: linkedError } = await client.rpc('create_linked_inventory_task', { p_v2_task_id: linkedV2TaskId });
    if (linkedError) throw new Error(linkedError.message);
    return { task: linkedTask, items: await loadTaskItems(client, linkedTask.id) };
  }
  const { data: products, error: productError } = await client
    .from('products')
    .select('*')
    .eq('store_id', profile.store_id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (productError) {
    throw new Error(productError.message);
  }

  if (!products || products.length === 0) {
    throw new Error('当前门店没有启用货品，无法创建任务。');
  }

  const { data: task, error: taskError } = await client
    .from('tasks')
    .insert({
      store_id: profile.store_id,
      created_by: profile.id,
      task_type: taskType,
      status: 'draft',
    })
    .select('*')
    .single();

  if (taskError) {
    throw new Error(taskError.message);
  }

  const itemPayload = products.map((product, index) => ({
    task_id: task.id,
    store_id: profile.store_id,
    product_id: product.id,
    product_snapshot: productToSnapshot(product) as unknown as Json,
    status: 'pending' as const,
    quantity: null,
    sort_order: product.sort_order || index + 1,
  }));

  const { data: items, error: itemError } = await client
    .from('task_items')
    .insert(itemPayload)
    .select('*')
    .order('sort_order', { ascending: true });

  if (itemError) {
    throw new Error(itemError.message);
  }

  return {
    task,
    items: items ?? [],
  };
};

export const updateInventoryTaskCategories = async (
  client: Client,
  taskId: string,
  categoryCodes: string[],
): Promise<TaskSessionData> => {
  const { data: task, error } = await client.rpc('set_inventory_task_categories', {
    p_category_codes: categoryCodes,
    p_task_id: taskId,
  });
  if (error) throw new Error(error.message);
  return { task, items: await loadTaskItems(client, task.id) };
};

export const submitTask = async (
  client: Client,
  task: TaskRow,
  exportMeta: Record<string, Json> = {},
) => {
  const submittedAt = new Date().toISOString();
  const nextExportMeta = {
    ...(typeof task.export_meta === 'object' && task.export_meta && !Array.isArray(task.export_meta) ? task.export_meta : {}),
    ...exportMeta,
    last_exported_at: submittedAt,
  };
  const { error } = await client
    .from('tasks')
    .update({
      status: 'submitted',
      submitted_at: submittedAt,
      export_meta: nextExportMeta,
    })
    .eq('id', task.id);

  if (error) {
    throw new Error(error.message);
  }

  // Do not require UPDATE ... RETURNING to expose one readable row. Under RLS,
  // the update can succeed while PostgREST returns no row for `.single()`.
  return {
    ...task,
    export_meta: nextExportMeta,
    status: 'submitted' as const,
    submitted_at: submittedAt,
    updated_at: submittedAt,
  };
};

export const updateTaskItemQuantity = async (
  client: Client,
  item: TaskItemRow,
  quantity: number | null,
) => {
  const { data, error } = await client
    .from('task_items')
    .update({
      quantity,
      status: quantity === null ? 'pending' : 'completed',
    })
    .eq('id', item.id)
    .eq('store_id', item.store_id)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
};

export const markTaskItemNoOrderNeeded = async (
  client: Client,
  item: TaskItemRow,
) => {
  const { data, error } = await client
    .from('task_items')
    .update({
      quantity: null,
      status: 'no_order_needed',
    })
    .eq('id', item.id)
    .eq('store_id', item.store_id)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
};

export interface ExtraTaskItemInput {
  name: string;
  spec: string;
  countUnit: string;
  quantity: number;
  note?: string;
}

export const addExtraTaskItem = async (
  client: Client,
  task: TaskRow,
  input: ExtraTaskItemInput,
) => {
  const { data, error } = await client
    .from('task_items')
    .insert({
      task_id: task.id,
      store_id: task.store_id,
      product_id: null,
      product_snapshot: {
        product_id: null,
        name: input.name,
        spec: input.spec,
        count_unit: input.countUnit,
        product_code: null,
      },
      quantity: input.quantity,
      status: 'completed',
      staff_note: input.note ?? null,
      is_extra_item: true,
      sort_order: 100000,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
};

export interface ManagerAddProductInput extends ExtraTaskItemInput {
  productCode?: string;
}

export const managerAddProductFromTask = async (
  client: Client,
  task: TaskRow,
  input: ManagerAddProductInput,
) => {
  const { data, error } = await client.rpc('manager_add_product_from_task', {
    p_task_id: task.id,
    p_name: input.name,
    p_spec: input.spec,
    p_count_unit: input.countUnit,
    p_quantity: input.quantity,
    p_product_code: input.productCode || null,
    p_note: input.note || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (
    !data
    || typeof data !== 'object'
    || Array.isArray(data)
    || typeof data.task_item_id !== 'string'
    || typeof data.product_id !== 'string'
  ) {
    throw new Error('新增货品结果格式无效');
  }

  const [itemResult, productResult] = await Promise.all([
    client.from('task_items').select('*').eq('id', data.task_item_id).single(),
    client.from('products').select('id').eq('id', data.product_id).eq('store_id', task.store_id).eq('is_active', true).single(),
  ]);

  if (itemResult.error) {
    throw new Error(itemResult.error.message);
  }
  if (productResult.error || !productResult.data) {
    throw new Error(productResult.error?.message ?? '货品未成功写入数据库');
  }

  return itemResult.data;
};

export interface ProductFeedbackInput {
  feedbackType: 'discontinued' | 'incorrect' | 'new';
  note?: string;
  suggestedChanges?: Record<string, string>;
}

export const reportProductFeedback = async (
  client: Client,
  item: TaskItemRow,
  createdBy: string,
  input: ProductFeedbackInput,
) => {
  const { error } = await client
    .from('product_feedback')
    .insert({
      store_id: item.store_id,
      task_item_id: item.id,
      product_id: item.product_id,
      feedback_type: input.feedbackType,
      original_snapshot: item.product_snapshot,
      suggested_changes: input.suggestedChanges ?? {},
      note: input.note ?? null,
      created_by: createdBy,
    });

  if (error) {
    throw new Error(error.message);
  }
};

export interface ManagerProductCorrectionInput {
  countUnit: string;
  name: string;
  note?: string;
  productCode?: string;
  spec: string;
}

export const managerUpdateProductFromTask = async (
  client: Client,
  item: TaskItemRow,
  input: ManagerProductCorrectionInput,
) => {
  const { data, error } = await client.rpc('manager_update_product_from_task', {
    p_task_item_id: item.id,
    p_name: input.name,
    p_spec: input.spec,
    p_count_unit: input.countUnit,
    p_product_code: input.productCode || null,
    p_note: input.note || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data) || !('product_snapshot' in data)) {
    throw new Error('货品修改结果格式无效');
  }

  return asProductSnapshot(data.product_snapshot as Json);
};

export const managerRequestProductDeletion = async (
  client: Client,
  item: TaskItemRow,
  note?: string,
) => {
  const { data, error } = await client.rpc('manager_request_product_deletion', {
    p_task_item_id: item.id,
    p_note: note || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  const { data: updatedItem, error: itemError } = await client
    .from('task_items')
    .select('*')
    .eq('id', item.id)
    .single();

  if (itemError) {
    throw new Error(itemError.message);
  }

  return { feedbackId: data, item: updatedItem };
};

export const loadInventoryTemplates = async (client: Client, limit = 30) => {
  const { data, error } = await client.rpc('list_store_inventory_templates', { p_limit: limit });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
};

export const importInventoryTask = async (
  client: Client,
  targetTaskId: string,
  sourceTaskId: string,
) => {
  const { error } = await client.rpc('import_inventory_task', {
    p_target_task_id: targetTaskId,
    p_source_task_id: sourceTaskId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return loadTaskItems(client, targetTaskId);
};
