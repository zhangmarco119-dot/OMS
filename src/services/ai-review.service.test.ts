import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../types/database';
import {
  actOnAiSuggestion,
  checkAiProductDraft,
  listAiReviews,
  loadAiPilotSettings,
  normalizeAiReviewRun,
  normalizeAiSuggestion,
} from './ai-review.service';

const clientWithRpc = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient<Database>;
const clientWithAiFunction = (invoke: ReturnType<typeof vi.fn>, rpc: ReturnType<typeof vi.fn>) => ({ functions: { invoke }, rpc }) as unknown as SupabaseClient<Database>;

describe('ai review service', () => {
  it('loads pilot UUID scope from database settings', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { admin_apply_enabled: true, admin_visible: true, auto_run_enabled: true, global_enabled: true, pilot_stores: [{ enabled: true, store_id: 'prod-store-uuid', store_name: '试点甲店', workflow_flags: { product: true } }], workflow_flags: { product: true } }, error: null });
    const settings = await loadAiPilotSettings(clientWithRpc(rpc));
    expect(rpc).toHaveBeenCalledWith('admin_get_ai_settings', undefined);
    expect(settings.pilotStores).toEqual([{ enabled: true, storeId: 'prod-store-uuid', storeName: '试点甲店', workflowFlags: { product: true } }]);
  });

  it('keeps critical suggestions as high risk instead of downgrading them', () => {
    expect(normalizeAiSuggestion({
      action_type: 'edit_quantity',
      confidence: 0.93,
      current_value: 12,
      field_path: 'arrival.items[0].quantity',
      id: 'suggestion-1',
      issue_type: 'quantity_outlier',
      rationale: '高于历史中位数十倍',
      severity: 'critical',
      status: 'pending',
      suggested_value: 12,
      title: '数量疑似多填一位',
    })).toMatchObject({ actionType: 'edit_quantity', fieldPath: 'arrival.items[0].quantity', severity: 'critical' });
    expect(normalizeAiReviewRun({ id: 'run-1', max_severity: 'critical', status: 'completed' }).maxSeverity).toBe('critical');
  });

  it('passes administrator filters to the list RPC and normalizes its payload', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { items: [{ entity_id: 'report-1', id: 'run-1', status: 'completed', store_id: 'store-1', store_name: '五道口店', suggestion_count: 1, workflow: 'arrival_report' }], total: 1 },
      error: null,
    });
    const result = await listAiReviews(clientWithRpc(rpc), { status: 'completed', storeIds: ['store-1'], workflow: 'arrival_report' });
    expect(rpc).toHaveBeenCalledWith('admin_ai_list_reviews', expect.objectContaining({ p_status: 'completed', p_store_ids: ['store-1'], p_workflow: 'arrival_report' }));
    expect(result.items[0]).toMatchObject({ entityId: 'report-1', storeName: '五道口店', workflow: 'arrival_report' });
  });

  it('checks an unsaved product draft without writing the product', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { runId: 'run-2', status: 'succeeded' }, error: null });
    const rpc = vi.fn().mockResolvedValue({ data: { run: { id: 'run-2', status: 'completed', store_id: 'store-1', workflow: 'product' }, suggestions: [] }, error: null });
    await checkAiProductDraft(clientWithAiFunction(invoke, rpc), { draft: { category_code: 'dairy', count_unit: '瓶', name: '原味酸奶', spec: '500ml' }, storeId: 'store-1' });
    expect(invoke).toHaveBeenCalledWith('ai-review', { body: { action: 'check-draft', storeId: 'store-1', structured: { categoryCode: 'dairy', countUnit: '瓶', name: '原味酸奶', spec: '500ml' }, workflow: 'product' } });
    expect(rpc).toHaveBeenCalledWith('admin_ai_get_review', { p_run_id: 'run-2' });
  });

  it('records adoption while returning only a draft patch', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { action_type: 'replace_fields', draft_patch: { name: '草莓果泥' }, run_id: 'run-1', status: 'applied_to_draft', suggestion_id: 'suggestion-1', target: { entity_id: 'product-1', source_hash: 'hash-1', store_id: 'store-1', workflow: 'product' } }, error: null });
    const result = await actOnAiSuggestion(clientWithRpc(rpc), 'suggestion-1', 'apply_to_draft', null, 'hash-1');
    expect(rpc).toHaveBeenCalledWith('admin_ai_act_on_suggestion', { p_action: 'apply_to_draft', p_expected_source_hash: 'hash-1', p_note: null, p_suggestion_id: 'suggestion-1' });
    expect(result).toMatchObject({ draftPatch: { name: '草莓果泥' }, runId: 'run-1', sourceHash: 'hash-1', status: 'applied_to_draft', suggestionId: 'suggestion-1', targetEntityId: 'product-1', targetEntityType: 'product', targetStoreId: 'store-1' });
  });

  it('preserves a stale action response so callers cannot adopt an empty draft patch', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { draft_patch: {}, run_id: 'run-1', status: 'stale', suggestion_id: 'suggestion-1' }, error: null });
    const result = await actOnAiSuggestion(clientWithRpc(rpc), 'suggestion-1', 'apply_to_draft', null, 'hash-1');
    expect(result).toMatchObject({ actionType: null, draftPatch: {}, runId: 'run-1', status: 'stale', suggestionId: 'suggestion-1' });
  });
  it('keeps the Supabase client method bound when calling an RPC', async () => {
    class RpcClient {
      capturedThis: unknown = null;
      rpc() {
        this.capturedThis = this;
        return Promise.resolve({
          data: {
            admin_apply_enabled: true,
            admin_visible: true,
            auto_run_enabled: true,
            global_enabled: true,
            pilot_stores: [],
            workflow_flags: {},
          },
          error: null,
        });
      }
    }
    const raw = new RpcClient();
    const client = raw as unknown as SupabaseClient<Database>;
    await loadAiPilotSettings(client);
    expect(raw.capturedThis).toBe(raw);
  });

});
