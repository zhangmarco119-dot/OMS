import { Bot, ChevronDown, ChevronUp, ExternalLink, RefreshCw, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { AiSuggestionCard } from '../features/ai-review/AiSuggestionCard';
import { buildAiArrivalDraftPatch } from '../features/ai-review/arrivalAiDraftPatch';
import { saveAiFollowUpTaskDraft, type AiProductCreationReviewDraft } from '../features/ai-review/aiReviewDrafts';
import { useAiPilotSettings } from '../features/ai-review/useAiPilotSettings';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import {
  actOnAiSuggestion,
  listAiProviderModels,
  listAiReviews,
  loadAiProviderConfig,
  loadAiReview,
  rerunAiReview,
  saveAiProviderConfig,
  saveAiSettings,
  skipAiReview,
  type AiProviderConfig,
  type AiReviewDetail,
  type AiReviewRun,
  type AiRunStatus,
  type AiSuggestion,
  type AiWorkflow,
} from '../services/ai-review.service';
import type { Json } from '../types/database';

const workflowLabel: Record<AiWorkflow, string> = {
  arrival_report: '到货上报',
  inventory: '点货',
  order: '订货',
  product: '货品库',
  product_creation_request: '新增货品申请',
  v2_task: 'V2 任务',
};

const statusLabel: Record<AiRunStatus, string> = {
  completed: '检查完成',
  failed: '检查失败',
  queued: '等待检查',
  running: '检查中',
  skipped: '已跳过',
  stale: '结果已失效',
};

const businessHref = (run: AiReviewRun) => run.workflow === 'arrival_report'
  ? `/app/admin/arrivals/${run.entityId}`
  : ['inventory', 'order'].includes(run.workflow)
    ? `/app/history/${run.entityId}`
    : run.workflow === 'v2_task'
      ? `/app/admin/tasks/${run.entityId}`
      : run.workflow === 'product'
        ? '/app/admin/products'
        : '/app/todos';

const formatTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
};

const existingProductIdFromSuggestion = (suggestion: AiSuggestion) => (
  suggestion.actionType === 'use_existing_product' && typeof suggestion.draftPatch.product_id === 'string'
    ? suggestion.draftPatch.product_id
    : null
);

const canAdoptSuggestion = (workflow: AiWorkflow, suggestion: AiSuggestion) => {
  if (workflow === 'arrival_report') return buildAiArrivalDraftPatch(suggestion, suggestion.draftPatch) !== null;
  if (workflow === 'product' || workflow === 'product_creation_request') {
    return suggestion.actionType === 'replace_fields' || Boolean(existingProductIdFromSuggestion(suggestion));
  }
  if (workflow === 'inventory') return ['edit_quantity', 'use_existing_product'].includes(suggestion.actionType);
  if (workflow === 'order') return ['edit_quantity', 'mark_no_order_needed'].includes(suggestion.actionType);
  return false;
};

export function AdminAiReviewPage() {
  const auth = useAuth();
  const aiPilot = useAiPilotSettings();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<AiReviewRun[]>([]);
  const [total, setTotal] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [storeId, setStoreId] = useState('');
  const [workflow, setWorkflow] = useState<AiWorkflow | ''>('');
  const [status, setStatus] = useState<AiRunStatus | ''>('');
  const [risk, setRisk] = useState<'all' | 'critical' | 'warning' | 'info' | 'none'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AiReviewDetail | null>(null);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
  const [providerConfig, setProviderConfig] = useState<AiProviderConfig | null>(null);
  const [providerForm, setProviderForm] = useState<{ apiKey: string; baseUrl: string; model: string }>({ apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro' });
  const [providerMessage, setProviderMessage] = useState('');
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [savingAuto, setSavingAuto] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);

  const pilotStores = (aiPilot.settings?.pilotStores ?? []).filter((store) => store.enabled);

  const load = useCallback(async () => {
    if (!supabase || auth.profile?.role !== 'admin') return;
    setPhase('loading');
    try {
      const response = await listAiReviews(supabase, { status, storeIds: storeId ? [storeId] : undefined, workflow });
      setRuns(response.items);
      setTotal(response.total);
      setPhase('ready');
      setMessage('');
    } catch (error) {
      setPhase('error');
      setMessage(error instanceof Error ? error.message : '加载 AI 质检记录失败。');
    }
  }, [auth.profile?.role, status, storeId, workflow]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (auth.profile?.role !== 'admin' || !supabase) return;
    void loadAiProviderConfig(supabase)
      .then((config) => {
        setProviderConfig(config);
        setProviderForm((current) => ({ ...current, baseUrl: config.baseUrl, model: config.model }));
      })
      .catch(() => undefined);
  }, [auth.profile?.role]);

  const toggleAutoRun = async () => {
    const settings = aiPilot.settings;
    if (!supabase || !settings) return;
    setSavingAuto(true);
    setProviderMessage('');
    try {
      await saveAiSettings(supabase, {
        adminApplyEnabled: settings.adminApplyEnabled,
        adminVisible: settings.adminVisible,
        autoRunEnabled: !settings.autoRunEnabled,
        dailyRunLimit: settings.dailyRunLimit ?? 200,
        globalEnabled: settings.globalEnabled,
        workflowFlags: settings.workflowFlags,
      });
      await aiPilot.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存自动分析开关失败。');
    } finally {
      setSavingAuto(false);
    }
  };

  const saveProvider = async () => {
    if (!supabase) return;
    setSavingProvider(true);
    setProviderMessage('');
    try {
      const config = await saveAiProviderConfig(supabase, {
        apiKey: providerForm.apiKey.trim() || null,
        baseUrl: providerForm.baseUrl.trim(),
        model: providerForm.model,
      });
      setProviderConfig(config);
      setProviderForm((current) => ({ ...current, apiKey: '' }));
      setProviderMessage('模型与 API Key 已保存。');
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : '保存模型与 API Key 失败。');
    } finally {
      setSavingProvider(false);
    }
  };

  const clearApiKey = async () => {
    if (!supabase) return;
    setSavingProvider(true);
    setProviderMessage('');
    try {
      const config = await saveAiProviderConfig(supabase, {
        baseUrl: providerForm.baseUrl.trim(),
        clearApiKey: true,
        model: providerForm.model,
      });
      setProviderConfig(config);
      setProviderMessage('API Key 已清除。');
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : '清除 API Key 失败。');
    } finally {
      setSavingProvider(false);
    }
  };

  const fetchModels = async () => {
    if (!supabase) return;
    setLoadingModels(true);
    setProviderMessage('');
    try {
      const models = await listAiProviderModels(supabase);
      setModelOptions(models);
      setProviderForm((current) => ({ ...current, model: models.includes(current.model) ? current.model : (models[0] ?? current.model) }));
      setProviderMessage(models.length > 0 ? '已获取模型列表，请选择要使用的模型后保存。' : '该 API Key 未返回可用模型。');
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : '获取模型列表失败。');
    } finally {
      setLoadingModels(false);
    }
  };

  const visibleRuns = runs.filter((run) => risk === 'all'
    || (risk === 'none' ? run.suggestionCount === 0 : run.maxSeverity === risk));

  const openDetail = async (run: AiReviewRun) => {
    if (expandedId === run.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    if (!supabase) return;
    setExpandedId(run.id);
    setDetail(null);
    setDetailState('loading');
    try {
      setDetail(await loadAiReview(supabase, run.id));
      setDetailState('idle');
    } catch (error) {
      setDetailState('error');
      setMessage(error instanceof Error ? error.message : '加载 AI 建议失败。');
    }
  };

  const refreshDetail = async (runId: string) => {
    if (!supabase) return;
    setDetail(await loadAiReview(supabase, runId));
    await load();
  };

  const ignore = async (suggestion: AiSuggestion) => {
    if (!supabase || !detail) return;
    setBusySuggestionId(suggestion.id);
    try {
      const result = await actOnAiSuggestion(supabase, suggestion.id, 'ignore', null, suggestion.sourceHash || null);
      await refreshDetail(detail.run.id);
      if (result.status === 'stale') setMessage('原始数据已变化，这条 AI 建议已自动标记为失效。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '忽略 AI 建议失败。'); }
    finally { setBusySuggestionId(null); }
  };

  const adopt = async (suggestion: AiSuggestion, modifiedValue?: Json) => {
    if (!supabase || !detail) return;
    const run = detail.run;
    const existingProductId = existingProductIdFromSuggestion(suggestion);
    if (existingProductId && (run.workflow === 'product' || run.workflow === 'product_creation_request')) {
      navigate('/app/admin/products', {
        state: {
          aiCancelNewDraft: run.workflow === 'product_creation_request' || !run.entityId,
          aiExistingProductId: existingProductId,
          aiSourceWorkflow: run.workflow,
          aiSuggestionId: suggestion.id,
          aiStoreId: run.storeId,
        },
      });
      return;
    }
    setBusySuggestionId(suggestion.id);
    try {
      const result = await actOnAiSuggestion(supabase, suggestion.id, 'apply_to_draft', modifiedValue === undefined ? null : JSON.stringify({ modified_value: modifiedValue }), suggestion.sourceHash || null);
      if (result.status === 'stale') {
        await refreshDetail(detail.run.id);
        setMessage('原始数据已变化，这条 AI 建议已失效，请重新检查后再采纳。');
        return;
      }
      if (result.status !== 'applied_to_draft') throw new Error('AI 建议未能安全写入草稿，请刷新后重试。');
      if (run.workflow === 'arrival_report') {
        navigate(`/app/arrivals/${run.entityId}/correct`, { state: { aiDraftPatch: result.draftPatch, aiModifiedValue: modifiedValue, aiSuggestionId: suggestion.id } });
        return;
      }
      if (['inventory', 'order', 'v2_task'].includes(run.workflow)) {
        saveAiFollowUpTaskDraft({
          actionType: suggestion.actionType,
          currentValue: suggestion.currentValue,
          draftPatch: result.draftPatch,
          entityId: run.entityId,
          fieldPath: suggestion.fieldPath,
          rationale: suggestion.rationale,
          sourceWorkflow: run.workflow as 'inventory' | 'order' | 'v2_task',
          storeId: run.storeId,
          storeName: run.storeName,
          suggestionId: suggestion.id,
          suggestedValue: modifiedValue ?? suggestion.suggestedValue,
          title: suggestion.title,
        });
        navigate('/app/admin/tasks/publish?source=ai-review');
        return;
      }
      if (run.workflow === 'product') {
        navigate('/app/admin/products', { state: { aiDraftPatch: result.draftPatch, aiEntityId: run.entityId, aiModifiedValue: modifiedValue, aiSuggestionId: suggestion.id, aiStoreId: run.storeId } });
        return;
      }
      if (run.workflow === 'product_creation_request') {
        const aiProductCreationReview: AiProductCreationReviewDraft = {
          draftPatch: result.draftPatch,
          requestId: run.entityId,
          storeId: run.storeId,
          suggestionId: suggestion.id,
        };
        navigate('/app/todos', { state: { aiProductCreationReview } });
        return;
      }
      await refreshDetail(run.id);
      setMessage('已记录采纳，但当前流程没有可安全写入的草稿；正式数据未被修改。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '采纳 AI 建议失败。'); }
    finally { setBusySuggestionId(null); }
  };

  const retry = async (run: AiReviewRun) => {
    if (!supabase) return;
    try {
      const next = await rerunAiReview(supabase, run.id);
      if (expandedId === run.id && next.id) await refreshDetail(next.id);
      else await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '重新检查失败。'); }
  };

  const skip = async (run: AiReviewRun) => {
    if (!supabase) return;
    try { await skipAiReview(supabase, run.id); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '跳过等待失败。'); }
  };

  return <PageShell eyebrow="门店运营系统 · 管理员试点" title="AI 质检中心" backTo="/app/workbench" contentGapClassName="gap-3">
    <section className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm leading-6 text-violet-900">
      <b>结构化数据试点</b><p>仅五道口和西直门，图片暂不参与检查。员工和店长看不到本页面；AI 只提供提醒，所有正式操作仍走原业务流程。</p>
    </section>
    <section className="ui-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">AI 自动分析</p>
          <p className="mt-1 text-xs text-slate-500">关闭后自动分析不再调用模型 API；管理员仍可手动重新检查。</p>
        </div>
        <button
          aria-pressed={aiPilot.settings?.autoRunEnabled === true}
          className={`min-h-9 shrink-0 rounded-full px-3 text-xs font-bold ${aiPilot.settings?.autoRunEnabled ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`}
          disabled={savingAuto || !aiPilot.settings}
          onClick={() => void toggleAutoRun()}
          type="button"
        >{aiPilot.settings?.autoRunEnabled ? '已开启' : '已关闭'}</button>
      </div>

      <label className="mt-3 block text-xs font-semibold text-slate-600">接口地址 Base URL
        <input className="ui-input mt-1" onChange={(event) => setProviderForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.deepseek.com" value={providerForm.baseUrl} />
      </label>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600">模型
          <select className="ui-input mt-1 min-h-10 text-sm" onChange={(event) => setProviderForm((current) => ({ ...current, model: event.target.value }))} value={providerForm.model}>
            {modelOptions.length === 0 ? <option value={providerForm.model}>{providerForm.model}</option> : modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">API Key
          <input className="ui-input mt-1" onChange={(event) => setProviderForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder={providerConfig?.apiKeyConfigured ? `已配置，尾号 ${providerConfig.apiKeyLast4}` : '请输入 API Key'} type="password" value={providerForm.apiKey} />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className="ui-button-primary min-h-9 px-3 text-xs" disabled={savingProvider} onClick={() => void saveProvider()} type="button">保存 Key 与地址</button>
        <button className="ui-button-secondary min-h-9 px-3 text-xs" disabled={savingProvider || loadingModels} onClick={() => void fetchModels()} type="button">{loadingModels ? '获取中…' : '获取模型列表'}</button>
        {providerConfig?.apiKeyConfigured ? <button className="ui-button-secondary min-h-9 px-3 text-xs" disabled={savingProvider} onClick={() => void clearApiKey()} type="button">清除 Key</button> : null}
        {providerMessage ? <span className="text-xs text-slate-500">{providerMessage}</span> : null}
      </div>
    </section>
    <section className="ui-card p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs font-semibold text-slate-600">门店<select className="ui-input mt-1 min-h-10 text-sm" onChange={(event) => setStoreId(event.target.value)} value={storeId}><option value="">全部试点门店</option>{pilotStores.map((store) => <option key={store.storeId} value={store.storeId}>{store.storeName}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">流程<select className="ui-input mt-1 min-h-10 text-sm" onChange={(event) => setWorkflow(event.target.value as AiWorkflow | '')} value={workflow}><option value="">全部流程</option>{Object.entries(workflowLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">风险<select className="ui-input mt-1 min-h-10 text-sm" onChange={(event) => setRisk(event.target.value as typeof risk)} value={risk}><option value="all">全部风险</option><option value="critical">高风险</option><option value="warning">需复核</option><option value="info">提示</option><option value="none">未发现异常</option></select></label>
        <label className="text-xs font-semibold text-slate-600">状态<select className="ui-input mt-1 min-h-10 text-sm" onChange={(event) => setStatus(event.target.value as AiRunStatus | '')} value={status}><option value="">全部状态</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <div className="mt-3 flex items-center justify-between"><p className="text-xs text-slate-500">共 {total} 次检查，当前显示 {visibleRuns.length} 次</p><button aria-label="刷新 AI 质检记录" className="ui-icon-button" onClick={() => void load()} type="button"><RefreshCw className="h-4 w-4" /></button></div>
    </section>
    {aiPilot.loading ? <section className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">正在加载数据库中的 AI 试点范围…</section> : null}
    {aiPilot.error ? <section className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">AI 试点范围暂时不可用：{aiPilot.error}</section> : null}
    {message ? <section className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{message}</section> : null}
    {phase === 'loading' ? <LoadingState label="正在加载 AI 质检记录" /> : null}
    {phase === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
    {phase === 'ready' && visibleRuns.length === 0 ? <EmptyState icon={Bot} title="暂无 AI 质检记录" description="试点门店产生新的结构化业务记录后，会自动在这里显示。" /> : null}
    {phase === 'ready' ? <section className="space-y-3">{visibleRuns.map((run) => <article className="ui-card p-4" key={run.id}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold text-violet-700">{run.storeName} · {workflowLabel[run.workflow]}</p><h2 className="mt-1 font-bold text-slate-900">{run.summary}</h2><p className="mt-1 text-xs text-slate-500">{formatTime(run.createdAt)} · {run.suggestionCount} 条建议</p></div><StatusBadge tone={run.status === 'failed' || run.maxSeverity === 'critical' ? 'danger' : run.maxSeverity === 'warning' ? 'warning' : run.status === 'completed' ? 'success' : 'neutral'}>{run.maxSeverity === 'critical' ? '高风险' : statusLabel[run.status]}</StatusBadge></div>
      <div className="mt-3 flex flex-wrap gap-2"><button className="ui-button-secondary min-h-9 px-3 text-xs" onClick={() => void openDetail(run)} type="button">{expandedId === run.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}{expandedId === run.id ? '收起建议' : '查看建议'}</button><Link className="ui-button-secondary min-h-9 px-3 text-xs" to={businessHref(run)}><ExternalLink className="h-4 w-4" />打开业务详情</Link>{['queued', 'running'].includes(run.status) ? <button className="ui-button-secondary min-h-9 px-3 text-xs" onClick={() => void skip(run)} type="button"><SkipForward className="h-4 w-4" />跳过等待</button> : null}{['failed', 'skipped', 'stale'].includes(run.status) ? <button className="ui-button-secondary min-h-9 px-3 text-xs" onClick={() => void retry(run)} type="button"><RefreshCw className="h-4 w-4" />重新检查</button> : null}</div>
      {expandedId === run.id ? <div className="mt-3 border-t border-slate-100 pt-3">{detailState === 'loading' ? <p className="text-sm text-slate-500">正在加载建议…</p> : null}{detailState === 'error' ? <p className="text-sm text-red-700">建议加载失败，可收起后重试。</p> : null}{detail?.run.id === run.id && detail.suggestions.length === 0 ? <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">本次检查没有发现明显异常。</p> : null}{detail?.run.id === run.id ? <div className="space-y-2">{detail.suggestions.map((suggestion) => {
        const adoptable = canAdoptSuggestion(run.workflow, suggestion);
        const opensExistingProduct = Boolean(existingProductIdFromSuggestion(suggestion)
          && (run.workflow === 'product' || run.workflow === 'product_creation_request'));
        return <AiSuggestionCard
          actionUnavailableReason={!adoptable ? '此建议无法安全映射到现有草稿，请打开业务详情人工处理。' : undefined}
          allowModify={!opensExistingProduct}
          busy={busySuggestionId === suggestion.id}
          key={suggestion.id}
          onApply={adoptable ? (modified) => void adopt(suggestion, modified) : undefined}
          onIgnore={() => void ignore(suggestion)}
          primaryAction={opensExistingProduct ? 'open' : 'apply'}
          primaryLabel={opensExistingProduct
            ? run.workflow === 'product_creation_request' ? '仅查看已有货品（申请仍待处理）' : '仅打开已有货品'
            : run.workflow === 'arrival_report'
              ? '带入更正草稿'
              : ['inventory', 'order', 'v2_task'].includes(run.workflow)
                ? '创建复核任务草稿'
                : run.workflow === 'product_creation_request'
                  ? '带入审核草稿'
                  : '带入货品草稿'}
          suggestion={suggestion}
        />;
      })}</div> : null}</div> : null}
    </article>)}</section> : null}
  </PageShell>;
}
