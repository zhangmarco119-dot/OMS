import { FileSpreadsheet } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ErrorState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { SectionCard } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { loadSubmittedTaskDetailView, type HistoryTask } from '../features/history/historyService';
import { asProductSnapshot } from '../features/tasks/taskCalculations';
import type { TaskWithItems } from '../features/tasks/taskService';
import { supabase } from '../lib/supabase';
import type { TaskType } from '../types/domain';

const taskTypeLabel: Record<TaskType, string> = { inventory: '点货单', order: '订货单' };

const formatDateTime = (value: string | null) => {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const itemStatusLabel = (status: TaskWithItems['items'][number]['status'], taskType: TaskType) => {
  if (status === 'no_order_needed') return '无需订货';
  if (status === 'pending') return taskType === 'inventory' ? '未盘点' : '未处理';
  return taskType === 'inventory' ? '已盘点' : '已填写';
};

type DetailView = { detail: TaskWithItems; summary: HistoryTask };

export function HistoryTaskDetailPage() {
  const auth = useAuth();
  const location = useLocation();
  const { taskId = '' } = useParams();
  const [view, setView] = useState<DetailView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !auth.profile || !taskId) {
      setStatus('error');
      setMessage('无法读取点货单，请重新登录后再试。');
      return;
    }
    setStatus('loading');
    try {
      setView(await loadSubmittedTaskDetailView(supabase, taskId));
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '点货单明细加载失败。');
    }
  }, [auth.profile, taskId]);

  useEffect(() => { void load(); }, [load]);

  const deletedItemCount = view?.detail.task.task_type === 'inventory'
    ? view.detail.items.filter((item) => item.product_action_status === 'deletion_approved').length
    : 0;

  const reviewBackTo = typeof (location.state as { backTo?: unknown } | null)?.backTo === 'string'
    && /^\/app\/admin\/tasks\/[^/]+$/.test((location.state as { backTo: string }).backTo)
    ? (location.state as { backTo: string }).backTo
    : null;

  return <PageShell eyebrow="提交记录" title={view ? taskTypeLabel[view.detail.task.task_type] : '单据明细'} backTo={reviewBackTo || '/app/history'} contentGapClassName="gap-3">
    {status === 'loading' ? <LoadingState label="正在加载单据明细" /> : null}
    {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
    {status === 'ready' && view ? <>
      <SectionCard className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="text-xs font-bold text-brand-700">{view.summary.storeName}</p><h2 className="mt-1 text-xl font-bold text-slate-900">{formatDateTime(view.detail.task.submitted_at)}</h2></div>
          <StatusBadge tone="success">已提交</StatusBadge>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-4">
          <Info label={view.detail.task.task_type === 'inventory' ? '点货人' : '订货人'} value={view.summary.submitterName} />
          <Info label="货品数量" value={`${view.summary.itemCount} 项`} />
          <Info label="门店" value={view.summary.storeShortName} />
          <Info label="单据编号" value={view.detail.task.id.slice(0, 8)} />
        </div>
      </SectionCard>

      <SectionCard className="p-3 sm:p-4">
        <div className="mb-3 flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-brand-700" /><h2 className="font-bold text-slate-900">货品明细</h2></div>
        <div className="space-y-2">
          {view.detail.items.map((item, index) => {
            const snapshot = asProductSnapshot(item.product_snapshot);
            const isConfirmedDeletion = item.product_action_status === 'deletion_approved';
            const startsDeletedSection = isConfirmedDeletion && (index === 0 || view.detail.items[index - 1]?.product_action_status !== 'deletion_approved');
            const actionStatus = item.product_action_status === 'deletion_requested' ? '申请删除' : isConfirmedDeletion ? '已确认删除' : item.product_action_status === 'deletion_ignored' ? '删除已忽略' : '';
            const quantity = item.status === 'no_order_needed' ? '-' : `${item.quantity ?? '-'}${item.quantity === null ? '' : ` ${snapshot.count_unit}`}`;
            return <div key={item.id}>
              {startsDeletedSection ? <div className="mb-2 mt-3 rounded-lg bg-slate-200/80 px-3 py-2 text-xs font-bold text-slate-700">以下为本次点货中已确认删除的货品（{deletedItemCount}）</div> : null}
              <article className={`rounded-xl border p-3 ${isConfirmedDeletion ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><b className="text-slate-900">{index + 1}. {snapshot.name}</b>{item.is_extra_item ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">本次新增</span> : null}</div><p className="mt-1 text-xs text-slate-500">{snapshot.spec || '无规格'}</p></div>
                  <strong className="shrink-0 text-base text-slate-900">{quantity}</strong>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-2 text-xs"><span className="font-semibold text-brand-700">{actionStatus || itemStatusLabel(item.status, view.detail.task.task_type)}</span><span className="min-w-0 truncate text-right text-slate-500">{item.staff_note || (item.is_extra_item ? '本次新增货品' : '无备注')}</span></div>
              </article>
            </div>;
          })}
        </div>
      </SectionCard>
    </> : null}
  </PageShell>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-xs text-slate-500">{label}</p><p className="mt-0.5 truncate font-semibold text-slate-900" title={value}>{value}</p></div>;
}
