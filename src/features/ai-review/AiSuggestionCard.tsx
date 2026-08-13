import { Check, ExternalLink, Pencil, Undo2, X } from 'lucide-react';
import { useState } from 'react';

import { StatusBadge } from '../../components/ui/Feedback';
import type { AiSuggestion } from '../../services/ai-review.service';
import type { Json } from '../../types/database';

const displayValue = (value: Json) => {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
};

const parseModifiedValue = (value: string, original: Json): Json => {
  if (typeof original === 'string') return value;
  if (typeof original === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  try { return JSON.parse(value) as Json; } catch { return value; }
};

export function AiSuggestionCard({
  actionUnavailableReason,
  allowModify = true,
  busy = false,
  onApply,
  onIgnore,
  onRestore,
  primaryAction = 'apply',
  primaryLabel = '采纳到草稿',
  suggestion,
}: {
  actionUnavailableReason?: string;
  allowModify?: boolean;
  busy?: boolean;
  onApply?: (modifiedValue?: Json) => void;
  onIgnore?: () => void;
  onRestore?: () => void;
  primaryAction?: 'apply' | 'open';
  primaryLabel?: string;
  suggestion: AiSuggestion;
}) {
  const [editing, setEditing] = useState(false);
  const [modified, setModified] = useState(() => displayValue(suggestion.suggestedValue));
  const handled = suggestion.status !== 'pending';

  return <article className={`rounded-xl border p-3 ${suggestion.severity === 'critical' ? 'border-red-200 bg-red-50/40' : suggestion.severity === 'warning' ? 'border-amber-200 bg-amber-50/40' : 'border-sky-200 bg-sky-50/40'}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-xs font-bold text-slate-500">{suggestion.issueType}</p><h3 className="mt-0.5 font-bold text-slate-900">{suggestion.title}</h3></div>
      <StatusBadge tone={suggestion.severity === 'critical' ? 'danger' : suggestion.severity === 'warning' ? 'warning' : 'info'}>{suggestion.severity === 'critical' ? '高风险' : suggestion.severity === 'warning' ? '需复核' : '提示'}</StatusBadge>
    </div>
    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
      <div className="rounded-lg bg-white/80 p-2"><dt className="text-xs font-semibold text-slate-500">当前值</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-800">{displayValue(suggestion.currentValue)}</dd></div>
      <div className="rounded-lg bg-white/80 p-2"><dt className="text-xs font-semibold text-slate-500">AI 建议值</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-800">{displayValue(suggestion.suggestedValue)}</dd></div>
    </dl>
    <p className="mt-2 text-sm leading-6 text-slate-600">依据：{suggestion.rationale}</p>
    <p className="mt-1 text-xs text-slate-500">{suggestion.confidence == null ? '置信度未提供' : `置信度 ${Math.round(suggestion.confidence * (suggestion.confidence <= 1 ? 100 : 1))}%`} · AI 仅作辅助提醒</p>
    {!handled && !onApply && actionUnavailableReason ? <p className="mt-2 rounded-lg bg-white/80 px-2 py-1.5 text-xs font-semibold text-slate-600">{actionUnavailableReason}</p> : null}
    {editing ? <div className="mt-3 rounded-lg border border-brand-200 bg-white p-2"><label className="text-xs font-bold text-slate-600">修改建议后采纳<textarea aria-label="修改后的建议" className="ui-input mt-1 min-h-20 py-2 font-mono text-xs" onChange={(event) => setModified(event.target.value)} value={modified} /></label><div className="mt-2 grid grid-cols-2 gap-2"><button className="ui-button-secondary min-h-9 text-xs" onClick={() => setEditing(false)} type="button">取消</button><button className="ui-button-primary min-h-9 text-xs" disabled={busy} onClick={() => onApply?.(parseModifiedValue(modified, suggestion.suggestedValue))} type="button"><Check className="h-4 w-4" />确认采纳</button></div></div> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      {!handled && onApply ? <button className="ui-button-primary min-h-9 px-3 text-xs" disabled={busy} onClick={() => onApply()} type="button">{primaryAction === 'open' ? <ExternalLink className="h-4 w-4" /> : <Check className="h-4 w-4" />}{primaryLabel}</button> : null}
      {!handled && onApply && allowModify ? <button className="ui-button-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={() => setEditing(true)} type="button"><Pencil className="h-4 w-4" />修改后采纳</button> : null}
      {!handled && onIgnore ? <button className="ui-button-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={onIgnore} type="button"><X className="h-4 w-4" />忽略</button> : null}
      {handled ? <StatusBadge tone={suggestion.status === 'applied_to_draft' ? 'success' : 'neutral'}>{suggestion.status === 'applied_to_draft' ? '已采纳到草稿' : suggestion.status === 'ignored' ? '已忽略' : '建议已失效'}</StatusBadge> : null}
      {handled && onRestore ? <button className="ui-button-secondary min-h-9 px-3 text-xs" disabled={busy} onClick={onRestore} type="button"><Undo2 className="h-4 w-4" />恢复待处理</button> : null}
    </div>
  </article>;
}
