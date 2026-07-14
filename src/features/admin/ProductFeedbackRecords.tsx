import { ChevronDown, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  feedbackProductSnapshots,
  feedbackProductText,
  handleProductFeedbackAction,
  isAppliedProductCorrection,
  loadProductFeedbackRecords,
  type AdminFeedbackAction,
  type ProductFeedbackRecord,
  type ProductFeedbackRow,
} from './adminProductsService';

type FeedbackFilter = 'all' | ProductFeedbackRow['feedback_type'];

const typeLabels: Record<ProductFeedbackRow['feedback_type'], string> = {
  discontinued: '删除申请',
  incorrect: '修改',
  new: '新增',
};

const feedbackStatus = (item: ProductFeedbackRow) => {
  if (item.status === 'resolved' && item.feedback_type === 'discontinued') {
    return { label: '已接受并删除', className: 'bg-red-50 text-red-700' };
  }
  if (item.status === 'resolved') {
    return { label: '已读', className: 'bg-emerald-50 text-emerald-700' };
  }
  if (item.status === 'open') {
    return { label: '待处理', className: 'bg-amber-50 text-amber-700' };
  }
  if (item.status === 'reverted') {
    return { label: '已撤回', className: 'bg-slate-100 text-slate-600' };
  }
  return item.feedback_type === 'discontinued'
    ? { label: '已拒绝', className: 'bg-slate-100 text-slate-600' }
    : { label: '已忽略', className: 'bg-slate-100 text-slate-600' };
};

const formatDateTime = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'short',
}).format(new Date(value));

export function ProductFeedbackRecords() {
  const [records, setRecords] = useState<ProductFeedbackRecord[]>([]);
  const [filter, setFilter] = useState<FeedbackFilter>('all');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, string>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      setRecords(await loadProductFeedbackRecords());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载货品反馈失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(
    () => records.filter(({ feedback }) => filter === 'all' || feedback.feedback_type === filter),
    [filter, records],
  );

  const handleFeedback = async (item: ProductFeedbackRow, action: AdminFeedbackAction) => {
    if (action === 'confirm_delete' && !window.confirm(`接受删除申请：确认从货品数据库删除“${feedbackProductText(item)}”？`)) {
      return;
    }
    if (action === 'revert' && !window.confirm(`确认撤回“${feedbackProductText(item)}”的修改？`)) {
      return;
    }

    setMessage(null);
    try {
      await handleProductFeedbackAction(item.id, action, resolutionDrafts[item.id]);
      setResolutionDrafts((current) => ({ ...current, [item.id]: '' }));
      setMessage('反馈已处理。');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '处理反馈失败。');
    }
  };

  return (
    <section className="space-y-3">
      <div className="rounded-lg bg-white p-3 shadow-sm">
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1">
          {([
            ['all', '全部'],
            ['incorrect', '修改'],
            ['new', '新增'],
            ['discontinued', '删除申请'],
          ] as const).map(([value, label]) => (
            <button className={`min-h-10 rounded-md text-sm font-bold ${filter === value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} key={value} onClick={() => setFilter(value)} type="button">
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500">{filtered.length} 条反馈记录</p>
          <button aria-label="刷新反馈" className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600" onClick={() => void refresh()} type="button">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {message ? <p className="rounded-lg bg-accent-50 p-3 text-sm text-accent-700">{message}</p> : null}
      {loading ? <div className="rounded-lg bg-white p-4 text-sm font-semibold shadow-sm">正在加载货品反馈</div> : null}
      {!loading && filtered.length === 0 ? <div className="rounded-lg bg-white p-6 text-center text-sm text-slate-500 shadow-sm">当前筛选下暂无反馈。</div> : null}

      {filtered.map(({ creatorName, feedback: item, storeName }) => {
        const appliedCorrection = isAppliedProductCorrection(item);
        const snapshots = feedbackProductSnapshots(item);
        const status = feedbackStatus(item);
        const expanded = expandedIds.has(item.id);
        return (
          <article className="rounded-lg bg-white p-4 shadow-sm" key={item.id}>
            <button aria-expanded={expanded} className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setExpandedIds((current) => {
              const next = new Set(current);
              if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
              return next;
            })} type="button">
              <div className="min-w-0">
                <p className="text-sm font-bold text-brand-700">{typeLabels[item.feedback_type]} · {storeName}</p>
                <h2 className="mt-1 truncate font-bold text-slate-900">{feedbackProductText(item)}</h2>
                <p className="mt-1 text-xs text-slate-500">{creatorName} · {formatDateTime(item.created_at)}</p>
              </div>
              <span className="flex shrink-0 items-center gap-1">
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${status.className}`}>{status.label}</span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
              </span>
            </button>

            {expanded ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                {item.note ? <p className="text-sm text-slate-600">备注：{item.note}</p> : <p className="text-sm text-slate-400">无备注</p>}

                {appliedCorrection && snapshots.suggested ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="truncate text-slate-600" title={`${snapshots.original.name} ${snapshots.original.spec}`}>修改前：{snapshots.original.name} · {snapshots.original.spec} · {snapshots.original.count_unit}</p>
                    <p className="truncate font-semibold text-brand-700" title={`${snapshots.suggested.name} ${snapshots.suggested.spec}`}>修改后：{snapshots.suggested.name} · {snapshots.suggested.spec} · {snapshots.suggested.count_unit}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">货品信息：{feedbackProductText(item)}</p>
                )}

                {item.status === 'open' ? (
                  <>
                    <input className="mt-3 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setResolutionDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="处理备注（选填）" value={resolutionDrafts[item.id] ?? ''} />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {item.feedback_type === 'discontinued' ? (
                        <><button className="min-h-10 rounded-lg border border-slate-200 text-sm font-bold" onClick={() => void handleFeedback(item, 'ignore')} type="button">拒绝请求</button><button className="min-h-10 rounded-lg bg-red-700 text-sm font-bold text-white" onClick={() => void handleFeedback(item, 'confirm_delete')} type="button">接受并删除</button></>
                      ) : appliedCorrection ? (
                        <><button className="min-h-10 rounded-lg border border-slate-200 text-sm font-bold" onClick={() => void handleFeedback(item, 'revert')} type="button">撤回修改</button><button className="min-h-10 rounded-lg bg-brand-600 text-sm font-bold text-white" onClick={() => void handleFeedback(item, 'acknowledge')} type="button">我知道了</button></>
                      ) : (
                        <><button className="min-h-10 rounded-lg border border-slate-200 text-sm font-bold" onClick={() => void handleFeedback(item, 'ignore')} type="button">忽略</button><button className="min-h-10 rounded-lg bg-brand-600 text-sm font-bold text-white" onClick={() => void handleFeedback(item, 'resolve')} type="button">我知道了</button></>
                      )}
                    </div>
                  </>
                ) : item.resolution_note ? <p className="mt-2 text-sm text-slate-500">处理备注：{item.resolution_note}</p> : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
