import { Bot, RefreshCw, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FeedbackBanner, StatusBadge } from '../../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../../components/ui/Surface';
import { supabase } from '../../lib/supabase';
import {
  actOnAiSuggestion,
  ensureAiReview,
  loadAiReview,
  rerunAiReview,
  skipAiReview,
  type AiReviewDetail,
  type AiSuggestion,
  type AiSuggestionActionResult,
  type AiWorkflow,
} from '../../services/ai-review.service';
import type { Json } from '../../types/database';
import { AiSuggestionCard } from './AiSuggestionCard';

const statusLabel = {
  completed: '检查完成',
  failed: '检查失败',
  queued: '等待检查',
  running: '检查中',
  skipped: '已跳过',
  stale: '结果已失效',
} as const;

export function AiEntityReviewPanel({
  applyLabel,
  autoRunEnabled = true,
  canAdopt,
  enabled = true,
  entityId,
  onAdopt,
  storeId,
  title = 'AI 结构化数据质检',
  workflow,
}: {
  applyLabel?: string;
  autoRunEnabled?: boolean;
  canAdopt?: (suggestion: AiSuggestion) => boolean;
  enabled?: boolean;
  entityId: string;
  onAdopt?: (suggestion: AiSuggestion, result: AiSuggestionActionResult, modifiedValue?: Json) => Promise<void> | void;
  storeId: string;
  title?: string;
  workflow: AiWorkflow;
}) {
  const [detail, setDetail] = useState<AiReviewDetail | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
  const sequence = useRef(0);

  const refreshRun = useCallback(async (runId: string) => {
    if (!supabase) throw new Error('AI 质检服务尚未配置。');
    const next = await loadAiReview(supabase, runId);
    setDetail(next);
    setPhase('ready');
    return next;
  }, []);

  const load = useCallback(async () => {
    if (!enabled || !autoRunEnabled || !supabase || !entityId || !storeId) return;
    const currentSequence = ++sequence.current;
    setPhase('loading');
    setMessage(null);
    try {
      const ensured = await ensureAiReview(supabase, { entityId, storeId, workflow });
      if (currentSequence !== sequence.current) return;
      if (!ensured.id) throw new Error('AI 检查已排队，但未返回检查编号。');
      await refreshRun(ensured.id);
    } catch (error) {
      if (currentSequence !== sequence.current) return;
      setPhase('error');
      setMessage(error instanceof Error ? error.message : 'AI 质检暂时不可用。');
    }
  }, [autoRunEnabled, enabled, entityId, refreshRun, storeId, workflow]);

  useEffect(() => { void load(); return () => { sequence.current += 1; }; }, [load]);

  useEffect(() => {
    if (!enabled || !detail || !['queued', 'running'].includes(detail.run.status)) return undefined;
    const timer = window.setTimeout(() => void refreshRun(detail.run.id).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : '刷新 AI 检查状态失败。');
    }), 2500);
    return () => window.clearTimeout(timer);
  }, [detail, enabled, refreshRun]);

  if (!enabled) return null;

  if (!autoRunEnabled) {
    return <SectionCard className="p-4" data-testid="ai-entity-review">
      <SectionHeader description="AI 只检查结构化字段，不会影响原业务记录。" icon={Bot} title={title} />
      <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">AI 自动分析已关闭，本次打开不会发起 AI 检查。</p>
    </SectionCard>;
  }

  const act = async (suggestion: AiSuggestion, action: 'apply_to_draft' | 'ignore' | 'restore', modifiedValue?: Json) => {
    if (!supabase) return;
    setBusySuggestionId(suggestion.id);
    setMessage(null);
    try {
      const note = modifiedValue === undefined ? null : JSON.stringify({ modified_value: modifiedValue });
      const result = await actOnAiSuggestion(supabase, suggestion.id, action, note, suggestion.sourceHash || null);
      if (result.status === 'stale') {
        if (detail) await refreshRun(detail.run.id);
        setMessage('这条 AI 建议对应的原始数据已变化，结果已失效，请重新检查后再采纳。');
        return;
      }
      if (action === 'apply_to_draft' && result.status !== 'applied_to_draft') {
        throw new Error('AI 建议未能安全写入草稿，请刷新后重试。');
      }
      if (action === 'apply_to_draft') await onAdopt?.(suggestion, result, modifiedValue);
      if (detail) await refreshRun(detail.run.id);
      setMessage(action === 'ignore' ? '已忽略此建议。' : action === 'restore' ? '建议已恢复为待处理。' : '建议已采纳到草稿；原正式记录没有被 AI 直接修改。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '处理 AI 建议失败。');
    } finally {
      setBusySuggestionId(null);
    }
  };

  const rerun = async () => {
    if (!supabase || !detail) return;
    setMessage(null);
    try {
      const run = await rerunAiReview(supabase, detail.run.id);
      if (run.id) await refreshRun(run.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : '重新检查失败。'); }
  };

  const skip = async () => {
    if (!supabase || !detail) return;
    setMessage(null);
    try {
      const run = await skipAiReview(supabase, detail.run.id);
      setDetail((current) => current ? { ...current, run: { ...current.run, ...run } } : current);
      setMessage('已跳过等待；原业务流程不受影响。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '跳过等待失败。'); }
  };

  return <SectionCard className="p-4" data-testid="ai-entity-review">
    <SectionHeader description="只检查结构化字段，不读取或分析图片；AI 失败不会影响原业务记录。" icon={Bot} title={title} action={detail ? <StatusBadge tone={detail.run.status === 'failed' ? 'danger' : detail.run.status === 'completed' ? 'success' : 'neutral'}>{statusLabel[detail.run.status]}</StatusBadge> : null} />
    {phase === 'loading' ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-600">AI 正在后台准备检查，页面其他内容可正常使用。</p> : null}
    {phase === 'error' ? <FeedbackBanner className="mt-3" title="AI 质检暂时不可用" tone="warning"><p>{message}</p><button className="ui-button-secondary mt-2 min-h-9 px-3 text-xs" onClick={() => void load()} type="button"><RefreshCw className="h-4 w-4" />重试</button></FeedbackBanner> : null}
    {phase === 'ready' && detail ? <>
      {message ? <FeedbackBanner className="mt-3" tone="info">{message}</FeedbackBanner> : null}
      {['queued', 'running'].includes(detail.run.status) ? <div className="mt-3 rounded-lg bg-slate-50 p-3"><p className="text-sm text-slate-600">检查仍在后台运行。您可以继续人工处理，也可以跳过本次等待。</p><button className="ui-button-secondary mt-2 min-h-9 px-3 text-xs" onClick={() => void skip()} type="button"><SkipForward className="h-4 w-4" />跳过等待</button></div> : null}
      {detail.run.status === 'failed' ? <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"><p>{detail.run.errorMessage || '本次 AI 检查失败，原业务数据未受影响。'}</p><button className="ui-button-secondary mt-2 min-h-9 px-3 text-xs" onClick={() => void rerun()} type="button"><RefreshCw className="h-4 w-4" />重新检查</button></div> : null}
      {detail.run.status === 'skipped' ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">本次检查已跳过。需要时可重新运行。</p> : null}
      {detail.run.status === 'skipped' || detail.run.status === 'stale' ? <button className="ui-button-secondary mt-2 min-h-9 px-3 text-xs" onClick={() => void rerun()} type="button"><RefreshCw className="h-4 w-4" />重新检查</button> : null}
      {detail.run.status === 'completed' && detail.suggestions.length === 0 ? <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">未发现明显的结构化数据异常。</p> : null}
      {detail.suggestions.length ? <div className="mt-3 space-y-3">{detail.suggestions.map((suggestion) => {
        const adoptable = Boolean(onAdopt && (canAdopt?.(suggestion) ?? true));
        return <AiSuggestionCard actionUnavailableReason={!adoptable && onAdopt ? '此建议无法安全映射到当前业务草稿，请打开业务详情人工处理。' : undefined} busy={busySuggestionId === suggestion.id} key={suggestion.id} onApply={adoptable ? (modified) => void act(suggestion, 'apply_to_draft', modified) : undefined} onIgnore={() => void act(suggestion, 'ignore')} onRestore={() => void act(suggestion, 'restore')} primaryLabel={applyLabel} suggestion={suggestion} />;
      })}</div> : null}
    </> : null}
  </SectionCard>;
}
