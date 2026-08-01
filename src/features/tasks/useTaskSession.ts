import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { supabase } from '../../lib/supabase';
import type { Json } from '../../types/database';
import type { TaskType } from '../../types/domain';
import { useAuth } from '../auth/AuthContext';
import { updateProductCategory, type ProductCategoryCode } from '../products/productCategories';
import {
  findNextPendingIndex,
  getCompletionStats,
  isItemProcessed,
  normalizeQuantityInput,
  quantityToInputValue,
  type TaskItemRow,
} from './taskCalculations';
import {
  addExtraTaskItem,
  createDraftTask,
  importInventoryTask,
  loadInventoryTemplates,
  loadDraftTask,
  managerAddProductFromTask,
  managerRequestProductDeletion,
  managerUpdateProductFromTask,
  markTaskItemNoOrderNeeded,
  reportProductFeedback,
  submitTask as submitTaskSession,
  updateTaskItemQuantity,
  updateInventoryTaskCategories,
  type ExtraTaskItemInput,
  type ManagerProductCorrectionInput,
  type ManagerAddProductInput,
  type InventoryTemplate,
  type ProductFeedbackInput,
  type TaskSessionData,
} from './taskService';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

const emptyItems: TaskItemRow[] = [];
const localDraftKey = (taskId: string, itemId: string) => `task-draft:${taskId}:${itemId}`;

export const useTaskSession = (taskType: TaskType, options: { linkedV2TaskId?: string | null } = {}) => {
  const auth = useAuth();
  const [sessionData, setSessionData] = useState<TaskSessionData | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [quantityInput, setQuantityInput] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const initializedItemKeyRef = useRef<string | null>(null);
  const saveGenerationRef = useRef(new Map<string, number>());

  const items = sessionData?.items ?? emptyItems;
  const currentItem = items[currentIndex] ?? null;
  const currentItemRef = useRef(currentItem);
  currentItemRef.current = currentItem;
  const stats = useMemo(() => getCompletionStats(items), [items]);
  const processedItems = useMemo(() => items.filter(isItemProcessed), [items]);
  const pendingItems = useMemo(() => items.filter((item) => !isItemProcessed(item)), [items]);

  const replaceItem = useCallback((updated: TaskItemRow) => {
    setSessionData((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        items: current.items.map((item) => (item.id === updated.id ? updated : item)),
        task: { ...current.task, updated_at: updated.updated_at },
      };
    });
  }, []);

  const updateQuantityInput = useCallback((value: string) => {
    setQuantityInput(value);

    if (!sessionData?.task || !currentItem) {
      return;
    }

    window.localStorage.setItem(localDraftKey(sessionData.task.id, currentItem.id), value);

    try {
      const quantity = normalizeQuantityInput(value);
      replaceItem({
        ...currentItem,
        quantity,
        status: quantity === null ? 'pending' : 'completed',
      });
    } catch {
      // Keep the typed value visible while validation feedback is handled by the save effect.
    }
  }, [currentItem, replaceItem, sessionData?.task]);

  const loadOrCreate = useCallback(async (forceCreate = false) => {
    const client = supabase;
    if (!client || !auth.profile) {
      setStatus('empty');
      setMessage('需要先配置 Supabase 并登录。');
      return;
    }

    setStatus('loading');
    setMessage(null);

    try {
      const existing = forceCreate ? null : await loadDraftTask(client, auth.profile, taskType, options.linkedV2TaskId);
      const loaded = existing ?? await createDraftTask(client, auth.profile, taskType, options.linkedV2TaskId);
      setSessionData(loaded);
      setCurrentIndex(0);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '加载任务失败');
    }
  }, [auth.profile, options.linkedV2TaskId, taskType]);

  const setInventoryCategories = useCallback(async (categoryCodes: string[]) => {
    const client = supabase;
    if (!client || !sessionData?.task || taskType !== 'inventory') throw new Error('当前没有可调整范围的点货草稿');
    const next = await updateInventoryTaskCategories(client, sessionData.task.id, categoryCodes);
    setSessionData(next);
    setCurrentIndex(0);
    setQuantityInput('');
    setMessage('本次点货范围已更新。');
  }, [sessionData?.task, taskType]);

  useEffect(() => {
    void loadOrCreate(false);
  }, [loadOrCreate]);

  useEffect(() => {
    if (!currentItem) {
      initializedItemKeyRef.current = null;
      setQuantityInput('');
      return;
    }

    if (!sessionData?.task) {
      return;
    }

    const itemKey = localDraftKey(sessionData.task.id, currentItem.id);
    if (initializedItemKeyRef.current === itemKey) {
      return;
    }

    initializedItemKeyRef.current = itemKey;
    const fallback = window.localStorage.getItem(itemKey);
    setQuantityInput(fallback ?? quantityToInputValue(currentItem.quantity));
  }, [currentItem, sessionData?.task]);

  useEffect(() => {
    const client = supabase;
    const item = currentItemRef.current;
    if (!client || !sessionData?.task || !item) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      if (
        (item.product_action_status === 'deletion_requested'
          || item.product_action_status === 'deletion_approved')
        && quantityInput.trim() === ''
      ) {
        setSaveStatus('saved');
        return;
      }

      if (item.status === 'no_order_needed' && quantityInput.trim() === '') {
        setSaveStatus('saved');
        return;
      }

      let quantity: number | null;
      try {
        quantity = normalizeQuantityInput(quantityInput);
      } catch (error) {
        setSaveStatus('error');
        setMessage(error instanceof Error ? error.message : '数量格式错误');
        return;
      }

      const localKey = localDraftKey(sessionData.task.id, item.id);
      const saveGeneration = (saveGenerationRef.current.get(item.id) ?? 0) + 1;
      saveGenerationRef.current.set(item.id, saveGeneration);
      window.localStorage.setItem(localKey, quantityInput);
      setSaveStatus(navigator.onLine ? 'saving' : 'offline');

      updateTaskItemQuantity(client, item, quantity)
        .then((updated) => {
          if (saveGenerationRef.current.get(item.id) !== saveGeneration) {
            return;
          }
          window.localStorage.removeItem(localKey);
          replaceItem(updated);
          setSaveStatus('saved');
          setMessage(null);
        })
        .catch((error: unknown) => {
          setSaveStatus(navigator.onLine ? 'error' : 'offline');
          setMessage(error instanceof Error ? error.message : '自动保存失败，已保留本地草稿。');
        });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [
    currentItem?.id,
    currentItem?.product_action_status,
    currentItem?.status,
    quantityInput,
    replaceItem,
    sessionData?.task,
  ]);

  const addExtraItem = useCallback(async (input: ExtraTaskItemInput) => {
    const client = supabase;
    if (!client || !sessionData?.task) {
      throw new Error('需要先登录并创建任务');
    }

    const created = await addExtraTaskItem(client, sessionData.task, input);
    setSessionData((current) => current ? { ...current, items: [...current.items, created] } : current);
    setCurrentIndex(items.length);
  }, [items.length, sessionData?.task]);

  const addManagerProduct = useCallback(async (input: ManagerAddProductInput) => {
    const client = supabase;
    if (!client || !sessionData?.task) {
      throw new Error('需要先登录并创建任务');
    }

    const created = await managerAddProductFromTask(client, sessionData.task, input);
    setSessionData((current) => current ? { ...current, items: [...current.items, created] } : current);
    setCurrentIndex(items.length);
    setMessage('货品已新增到数据库，管理员已收到通知。');
    return created;
  }, [items.length, sessionData?.task]);

  const reportFeedback = useCallback(async (input: ProductFeedbackInput) => {
    const client = supabase;
    if (!client || !currentItem || !auth.profile) {
      throw new Error('需要先登录并选择货品');
    }

    await reportProductFeedback(client, currentItem, auth.profile.id, input);
    setMessage('货品反馈已保存。');
  }, [auth.profile, currentItem]);

  const correctCurrentProduct = useCallback(async (input: ManagerProductCorrectionInput) => {
    const client = supabase;
    if (!client || !currentItem) {
      throw new Error('需要先登录并选择货品');
    }

    const productSnapshot = await managerUpdateProductFromTask(client, currentItem, input);
    replaceItem({
      ...currentItem,
      product_snapshot: productSnapshot as unknown as Json,
      updated_at: new Date().toISOString(),
    });
    setMessage('货品信息已修改，管理员已收到通知。');
    return productSnapshot;
  }, [currentItem, replaceItem]);

  const changeCurrentProductCategory = useCallback(async (categoryCode: ProductCategoryCode) => {
    const client = supabase;
    if (!client || !currentItem?.product_id) throw new Error('当前货品无法修改分类');
    await updateProductCategory(client, currentItem.product_id, categoryCode);
    const snapshot = currentItem.product_snapshot && typeof currentItem.product_snapshot === 'object' && !Array.isArray(currentItem.product_snapshot)
      ? { ...currentItem.product_snapshot, category_code: categoryCode }
      : currentItem.product_snapshot;
    replaceItem({ ...currentItem, product_snapshot: snapshot, updated_at: new Date().toISOString() });
    setMessage('货品分类已更新。');
  }, [currentItem, replaceItem]);

  const requestCurrentProductDeletion = useCallback(async (note?: string) => {
    const client = supabase;
    if (!client || !currentItem) {
      throw new Error('需要先登录并选择货品');
    }

    const result = await managerRequestProductDeletion(client, currentItem, note);
    replaceItem(result.item);
    setQuantityInput('');
    setMessage('已提交删除此货品，等待管理员确认。');
    return result.feedbackId;
  }, [currentItem, replaceItem]);

  const getInventoryTemplates = useCallback(async (): Promise<InventoryTemplate[]> => {
    const client = supabase;
    if (!client || taskType !== 'inventory') {
      return [];
    }
    return loadInventoryTemplates(client);
  }, [taskType]);

  const importFromInventoryTask = useCallback(async (sourceTaskId: string) => {
    const client = supabase;
    if (!client || !sessionData?.task || taskType !== 'inventory') {
      throw new Error('当前没有可导入的盘点草稿');
    }

    const importedItems = await importInventoryTask(client, sessionData.task.id, sourceTaskId);
    importedItems.forEach((item) => window.localStorage.removeItem(localDraftKey(sessionData.task.id, item.id)));
    setSessionData((current) => current ? { ...current, items: importedItems } : current);
    const firstPending = findNextPendingIndex(importedItems, -1);
    const nextIndex = firstPending === -1 ? 0 : firstPending;
    setCurrentIndex(nextIndex);
    const nextItem = importedItems[nextIndex];
    if (nextItem) {
      initializedItemKeyRef.current = localDraftKey(sessionData.task.id, nextItem.id);
      setQuantityInput(quantityToInputValue(nextItem.quantity));
    }
    setMessage('已导入历史盘点单，可以继续盘点。');
    return importedItems;
  }, [sessionData?.task, taskType]);

  const markNoOrderNeeded = useCallback(async () => {
    const client = supabase;
    if (!client || !currentItem) {
      throw new Error('需要先选择货品');
    }

    const updated = await markTaskItemNoOrderNeeded(client, currentItem);
    replaceItem(updated);
    setQuantityInput('');
    setMessage('已标记为无需订货。');
  }, [currentItem, replaceItem]);

  const saveCurrentQuantityNow = useCallback(async () => {
    const client = supabase;
    if (!client || !currentItem) {
      return null;
    }

    if (currentItem.status === 'no_order_needed' && quantityInput.trim() === '') {
      return currentItem;
    }

    if (
      (currentItem.product_action_status === 'deletion_requested'
        || currentItem.product_action_status === 'deletion_approved')
      && quantityInput.trim() === ''
    ) {
      return currentItem;
    }

    const quantity = normalizeQuantityInput(quantityInput);
    setSaveStatus('saving');
    const updated = await updateTaskItemQuantity(client, currentItem, quantity);
    replaceItem(updated);
    setSaveStatus('saved');
    setMessage(null);
    return updated;
  }, [currentItem, quantityInput, replaceItem]);

  const goToIndex = useCallback((index: number) => {
    if (index < 0 || index >= items.length || index === currentIndex) {
      return;
    }

    void saveCurrentQuantityNow().catch((error: unknown) => {
      setSaveStatus(navigator.onLine ? 'error' : 'offline');
      setMessage(error instanceof Error ? error.message : '自动保存失败，已保留本地草稿。');
    });
    setCurrentIndex(index);
  }, [currentIndex, items.length, saveCurrentQuantityNow]);

  const goNextPending = useCallback(() => {
    const next = findNextPendingIndex(items, currentIndex);
    if (next === -1) {
      setMessage('所有货品均已处理。');
      return;
    }
    goToIndex(next);
  }, [currentIndex, goToIndex, items]);

  const submitCurrentTask = useCallback(async (exportMeta?: Record<string, Json>) => {
    const client = supabase;
    if (!client || !sessionData?.task) {
      throw new Error('需要先登录并创建任务');
    }

    const updated = await submitTaskSession(client, sessionData.task, exportMeta);
    setSessionData((current) => current ? { ...current, task: updated } : current);
    return updated;
  }, [sessionData?.task]);

  return {
    currentIndex,
    currentItem,
    addExtraItem,
    addManagerProduct,
    correctCurrentProduct,
    changeCurrentProductCategory,
    goNextPending,
    goToIndex,
    getInventoryTemplates,
    items,
    loadOrCreate,
    message,
    markNoOrderNeeded,
    pendingItems,
    processedItems,
    quantityInput,
    saveStatus,
    saveCurrentQuantityNow,
    setCurrentIndex: goToIndex,
    setQuantityInput: updateQuantityInput,
    sessionData,
    stats,
    status,
    reportFeedback,
    requestCurrentProductDeletion,
    setInventoryCategories,
    importFromInventoryTask,
    submitCurrentTask,
  };
};
