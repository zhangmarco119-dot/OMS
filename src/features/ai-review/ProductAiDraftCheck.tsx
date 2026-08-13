import { Bot, RefreshCw, SkipForward } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ProductDraft } from '../admin/adminProductsService';
import { useAuth } from '../auth/AuthContext';
import { FeedbackBanner, StatusBadge } from '../../components/ui/Feedback';
import { supabase } from '../../lib/supabase';
import {
  actOnAiSuggestion,
  checkAiProductDraft,
  loadAiReview,
  rerunAiReview,
  skipAiReview,
  type AiReviewDetail,
  type AiSuggestion,
} from '../../services/ai-review.service';
import type { Json } from '../../types/database';
import { AiSuggestionCard } from './AiSuggestionCard';

const allowedFields = ['category_code', 'count_unit', 'name', 'product_code', 'sort_order', 'spec'] as const;
type AllowedField = typeof allowedFields[number];

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const inferField = (suggestion: AiSuggestion): AllowedField | null => {
  const hint = `${suggestion.issueType} ${suggestion.title}`.toLowerCase();
  if (hint.includes('name') || hint.includes('名称') || hint.includes('同名') || hint.includes('重复')) return 'name';
  if (hint.includes('spec') || hint.includes('规格')) return 'spec';
  if (hint.includes('unit') || hint.includes('单位')) return 'count_unit';
  if (hint.includes('category') || hint.includes('分类')) return 'category_code';
  if (hint.includes('code') || hint.includes('编码')) return 'product_code';
  return null;
};

const productDraftPatchFromSuggestion = (
  suggestion: AiSuggestion,
  actionPatch: Record<string, Json | undefined>,
  modifiedValue?: Json,
): Partial<ProductDraft> => {
  const patchSource = Object.keys(actionPatch).length ? actionPatch : suggestion.draftPatch;
  const nested = isRecord(patchSource.fields) ? patchSource.fields : isRecord(patchSource.product) ? patchSource.product : patchSource;
  const result: Partial<ProductDraft> = {};
  allowedFields.forEach((field) => {
    const value = nested[field];
    if (value === undefined || value === null) return;
    if (field === 'sort_order') {
      const number = Number(value);
      if (Number.isFinite(number)) result.sort_order = number;
    } else {
      (result as Record<string, unknown>)[field] = String(value);
    }
  });
  if (modifiedValue !== undefined) {
    if (isRecord(modifiedValue)) {
      allowedFields.forEach((field) => {
        const value = modifiedValue[field];
        if (value !== undefined && value !== null) (result as Record<string, unknown>)[field] = field === 'sort_order' ? Number(value) : String(value);
      });
    } else {
      const field = inferField(suggestion);
      if (field) (result as Record<string, unknown>)[field] = field === 'sort_order' ? Number(modifiedValue) : String(modifiedValue);
    }
  }
  return result;
};

const canApplyProductSuggestion = (suggestion: AiSuggestion) => suggestion.actionType === 'replace_fields';
const existingProductIdFromSuggestion = (suggestion: AiSuggestion) => (
  suggestion.actionType === 'use_existing_product' && typeof suggestion.draftPatch.product_id === 'string'
    ? suggestion.draftPatch.product_id
    : null
);

export function ProductAiDraftCheck({
  draft,
  enabled,
  onApply,
  onSkipAndSave,
  onUseExistingProduct,
  productId = null,
  storeId,
}: {
  draft: ProductDraft;
  enabled: boolean;
  onApply: (patch: Partial<ProductDraft>) => void;
  onSkipAndSave?: () => void;
  onUseExistingProduct?: (existingProductId: string, suggestion: AiSuggestion) => void;
  productId?: string | null;
  storeId: string;
}) {
  const auth = useAuth();
  const [detail, setDetail] = useState<AiReviewDetail | null>(null);
  const [state, setState] = useState<'idle' | 'waiting' | 'ready' | 'failed' | 'skipped'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
  const generation = useRef(0);
  const reviewedFingerprint = useRef<string | null>(null);
  const fingerprint = useMemo(() => JSON.stringify({
    category_code: draft.category_code,
    count_unit: draft.count_unit.trim(),
    name: draft.name.trim(),
    product_code: draft.product_code?.trim() || null,
    sort_order: draft.sort_order,
    spec: draft.spec.trim(),
  }), [draft]);
  const complete = Boolean(storeId && draft.name.trim() && draft.spec.trim() && draft.count_unit.trim());

  useEffect(() => {
    if (auth.profile?.role !== 'admin' || !supabase || !enabled || !complete) {
      setState('idle');
      setDetail(null);
      reviewedFingerprint.current = null;
      return undefined;
    }
    const current = ++generation.current;
    setState('waiting');
    setDetail(null);
    setMessage(null);
    reviewedFingerprint.current = null;
    const timer = window.setTimeout(() => {
      void checkAiProductDraft(supabase!, {
        draft: JSON.parse(fingerprint) as Record<string, Json | undefined>,
        productId,
        storeId,
      }).then((next) => {
        if (current !== generation.current) return;
        setDetail(next);
        reviewedFingerprint.current = fingerprint;
        setState('ready');
      }).catch((error: unknown) => {
        if (current !== generation.current) return;
        setState('failed');
        setMessage(error instanceof Error ? error.message : 'AI 草稿检查失败。');
      });
    }, 1000);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [auth.profile?.role, complete, enabled, fingerprint, productId, storeId]);

  useEffect(() => {
    if (auth.profile?.role !== 'admin' || !enabled || !detail || !supabase || !['queued', 'running'].includes(detail.run.status) || state === 'skipped') return undefined;
    const client = supabase;
    const current = generation.current;
    const timer = window.setTimeout(() => void loadAiReview(client, detail.run.id).then((next) => {
      if (current !== generation.current) return;
      setDetail(next);
      setState('ready');
    }).catch((error: unknown) => {
      if (current !== generation.current) return;
      setState('failed');
      setMessage(error instanceof Error ? error.message : '刷新 AI 草稿检查失败。');
    }), 2500);
    return () => window.clearTimeout(timer);
  }, [auth.profile?.role, detail, enabled, state]);

  if (auth.profile?.role !== 'admin' || !enabled || !complete) return null;

  const act = async (suggestion: AiSuggestion, action: 'apply_to_draft' | 'ignore' | 'restore', modifiedValue?: Json) => {
    if (!supabase) return;
    if (reviewedFingerprint.current !== fingerprint) {
      setMessage('货品草稿已变化，旧的 AI 建议已失效；请等待本次自动检查完成。');
      return;
    }
    setBusySuggestionId(suggestion.id);
    setMessage(null);
    try {
      const response = await actOnAiSuggestion(supabase, suggestion.id, action, modifiedValue === undefined ? null : JSON.stringify({ modified_value: modifiedValue }), suggestion.sourceHash || null);
      if (response.status === 'stale') {
        if (detail) setDetail(await loadAiReview(supabase, detail.run.id));
        setMessage('这条 AI 建议已失效，请等待重新检查后再采纳。');
        return;
      }
      if (action === 'apply_to_draft' && response.status !== 'applied_to_draft') {
        throw new Error('AI 建议未能安全写入草稿，请重新检查后再试。');
      }
      if (action === 'apply_to_draft') onApply(productDraftPatchFromSuggestion(suggestion, response.draftPatch, modifiedValue));
      if (detail) setDetail(await loadAiReview(supabase, detail.run.id));
      setMessage(action === 'ignore' ? '已忽略此建议。' : action === 'restore' ? '建议已恢复。' : '建议已填入货品草稿，请检查后点击原“保存货品”按钮。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '处理 AI 建议失败。'); }
    finally { setBusySuggestionId(null); }
  };

  const skip = async () => {
    generation.current += 1;
    setState('skipped');
    if (supabase && detail?.run.id) void skipAiReview(supabase, detail.run.id).catch(() => undefined);
    onSkipAndSave?.();
  };

  const retry = async () => {
    if (!supabase || !detail?.run.id) {
      setState('idle');
      return;
    }
    try {
      const run = await rerunAiReview(supabase, detail.run.id);
      setDetail(await loadAiReview(supabase, run.id));
      setState('ready');
      setMessage(null);
    } catch (error) { setState('failed'); setMessage(error instanceof Error ? error.message : '重新检查失败。'); }
  };

  const openExistingProduct = (suggestion: AiSuggestion, existingProductId: string) => {
    if (reviewedFingerprint.current !== fingerprint) {
      setMessage('货品草稿已变化，旧的 AI 建议已失效；请等待本次自动检查完成。');
      return;
    }
    onUseExistingProduct?.(existingProductId, suggestion);
    setMessage('仅已定位已有货品；没有写入 product_id、没有保存当前草稿，也没有把此建议标记为已采纳。');
  };

  return <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/40 p-3" data-testid={`product-ai-check-${productId ?? 'new'}`}>
    <div className="flex items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-bold text-violet-900"><Bot className="h-4 w-4" />AI 草稿检查</p><StatusBadge tone={state === 'failed' ? 'danger' : state === 'ready' && detail?.run.status === 'completed' ? 'success' : 'neutral'}>{state === 'waiting' || ['queued', 'running'].includes(detail?.run.status ?? '') ? '自动检查中' : state === 'skipped' ? '已跳过' : state === 'failed' ? '检查失败' : '检查完成'}</StatusBadge></div>
    {message ? <FeedbackBanner className="mt-2" tone={state === 'failed' ? 'warning' : 'info'}>{message}</FeedbackBanner> : null}
    {(state === 'waiting' || ['queued', 'running'].includes(detail?.run.status ?? '')) && state !== 'skipped' ? <div className="mt-2"><p className="text-xs leading-5 text-slate-600">字段稳定 1 秒后已自动运行。AI 较慢时仍可直接保存。</p><button className="ui-button-secondary mt-2 min-h-9 px-3 text-xs" onClick={() => void skip()} type="button"><SkipForward className="h-4 w-4" />跳过本次检查并继续保存</button></div> : null}
    {state === 'skipped' ? <p className="mt-2 text-xs text-slate-600">{onSkipAndSave ? '已跳过本次 AI 检查，正在按原流程保存。' : '已跳过本次 AI 检查，原创建或保存按钮仍可正常使用。'}</p> : null}
    {state === 'failed' || detail?.run.status === 'failed' ? <button className="ui-button-secondary mt-2 min-h-9 px-3 text-xs" onClick={() => void retry()} type="button"><RefreshCw className="h-4 w-4" />重试 AI 检查</button> : null}
    {detail?.run.status === 'completed' && detail.suggestions.length === 0 ? <p className="mt-2 text-xs font-semibold text-emerald-700">未发现明显异常，仍请人工确认后保存。</p> : null}
    {detail?.suggestions.length ? <div className="mt-3 space-y-2">{detail.suggestions.map((suggestion) => {
      const adoptable = canApplyProductSuggestion(suggestion);
      const existingProductId = existingProductIdFromSuggestion(suggestion);
      const canOpenExisting = Boolean(existingProductId && existingProductId !== productId && onUseExistingProduct);
      return <AiSuggestionCard
        actionUnavailableReason={!adoptable && !canOpenExisting ? 'AI 建议指向已有货品，但当前页面无法安全定位该货品；请到货品库人工核对，当前草稿不会写入 product_id。' : undefined}
        allowModify={adoptable}
        busy={busySuggestionId === suggestion.id}
        key={suggestion.id}
        onApply={adoptable
          ? (modified) => void act(suggestion, 'apply_to_draft', modified)
          : canOpenExisting && existingProductId
            ? () => openExistingProduct(suggestion, existingProductId)
            : undefined}
        onIgnore={() => void act(suggestion, 'ignore')}
        onRestore={() => void act(suggestion, 'restore')}
        primaryAction={adoptable ? 'apply' : 'open'}
        primaryLabel={adoptable ? '采纳到草稿' : '仅打开已有货品'}
        suggestion={suggestion}
      />;
    })}</div> : null}
  </div>;
}
