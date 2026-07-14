import { Eye, FileSpreadsheet, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { EmptyState, ErrorState, FeedbackBanner, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { SegmentedControl } from '../components/ui/FormField';
import { SectionCard } from '../components/ui/Surface';
import { ProductFeedbackRecords } from '../features/admin/ProductFeedbackRecords';
import { useAuth } from '../features/auth/AuthContext';
import { loadSubmittedTaskDetail, loadSubmittedTasks, type HistoryTask } from '../features/history/historyService';
import { asProductSnapshot } from '../features/tasks/taskCalculations';
import type { TaskWithItems } from '../features/tasks/taskService';
import { supabase } from '../lib/supabase';
import type { TaskType } from '../types/domain';

const taskTypeLabel: Record<TaskType, string> = {
  inventory: '点货单',
  order: '订货单',
};

const itemStatusLabel = (status: TaskWithItems['items'][number]['status'], taskType: TaskType) => {
  if (status === 'no_order_needed') {
    return '无需订货';
  }
  if (status === 'pending') {
    return taskType === 'inventory' ? '未盘点' : '未处理';
  }
  return taskType === 'inventory' ? '已盘点' : '已填写';
};

const formatDateTime = (value: string | null) => {
  if (!value) {
    return '未记录';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

export function HistoryPage() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState<TaskType | 'all'>('all');
  const [adminView, setAdminView] = useState<'tasks' | 'feedback'>('tasks');
  const [items, setItems] = useState<HistoryTask[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<TaskWithItems | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<HistoryTask | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const detailRequestRef = useRef(0);
  const isAdmin = auth.profile?.role === 'admin';

  useEffect(() => { if (searchParams.get('view') === 'feedback') setAdminView('feedback'); }, [searchParams]);

  const loadHistory = useCallback(async () => {
    if (!supabase || !auth.profile) {
      setStatus('error');
      setMessage('需要先登录并配置 Supabase。');
      return;
    }

    setStatus('loading');
    setMessage(null);
    try {
      const loaded = await loadSubmittedTasks(supabase, auth.profile, filter);
      setItems(loaded);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '加载记录失败。');
    }
  }, [auth.profile, filter]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const openDetail = async (summary: HistoryTask) => {
    if (!supabase) {
      setMessage('缺少 Supabase 配置，无法查看明细。');
      return;
    }

    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setLoadingDetailId(summary.task.id);
    setMessage(null);
    try {
      const detail = await loadSubmittedTaskDetail(supabase, summary.task.id);
      if (detailRequestRef.current === requestId) {
        setSelected(detail);
        setSelectedSummary(summary);
      }
    } catch (error) {
      if (detailRequestRef.current === requestId) {
        setMessage(error instanceof Error ? error.message : '加载明细失败。');
      }
    } finally {
      if (detailRequestRef.current === requestId) {
        setLoadingDetailId(null);
      }
    }
  };

  return (
    <PageShell eyebrow={isAdmin ? '管理员记录' : '我的记录'} title={isAdmin ? '全部提交记录' : '提交记录'} backTo="/app">
      {isAdmin ? (
        <SegmentedControl className="grid-cols-2" items={[{ active: adminView === 'tasks', label: '点货与订货', onClick: () => setAdminView('tasks') }, { active: adminView === 'feedback', label: '货品反馈', onClick: () => setAdminView('feedback') }]} />
      ) : null}

      {isAdmin && adminView === 'feedback' ? <ProductFeedbackRecords /> : (
        <>
      <SectionCard>
        <SegmentedControl className="grid-cols-3" items={[{ active: filter === 'all', label: '全部', onClick: () => setFilter('all') }, { active: filter === 'inventory', label: '点货', onClick: () => setFilter('inventory') }, { active: filter === 'order', label: '订货', onClick: () => setFilter('order') }]} />

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm leading-6 text-slate-500">
            {isAdmin ? '显示所有授权门店已提交记录，可查看每次点货和订货结果。' : '显示你已提交的点货和订货记录。'}
          </p>
          <button aria-label="刷新记录" className="ui-icon-button" onClick={() => void loadHistory()} type="button">
            <RefreshCw className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </SectionCard>

      {message && status !== 'error' ? <FeedbackBanner>{message}</FeedbackBanner> : null}

      {status === 'loading' ? (
        <LoadingState label="正在加载提交记录" />
      ) : null}

      {status === 'error' ? (
        <ErrorState message={message ?? '记录加载失败。'} onRetry={() => void loadHistory()} />
      ) : null}

      {status === 'ready' && items.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title="暂无已提交记录" description="员工点击提交后，这里会保留数据库记录和货品快照。" />
      ) : null}

      {status === 'ready' && items.length > 0 ? (
        <div className="space-y-3">
          {items.map((summary) => {
            const { itemCount, storeName, submitterName, task } = summary;
            return (
            <article className="ui-card p-4" key={task.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-brand-700">{taskTypeLabel[task.task_type]}</p>
                  <h2 className="mt-1 truncate text-lg font-bold text-slate-900">{formatDateTime(task.submitted_at)}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {isAdmin ? `${storeName} · ` : ''}{submitterName} · {itemCount} 个货品 · 单号 {task.id.slice(0, 8)}
                  </p>
                </div>
                <StatusBadge tone="success">已提交</StatusBadge>
              </div>
              <button
                className="ui-button-primary mt-4 w-full"
                disabled={loadingDetailId === task.id}
                onClick={() => void openDetail(summary)}
                type="button"
              >
                <Eye className="h-5 w-5" aria-hidden="true" />
                {loadingDetailId === task.id ? '正在加载' : '查看明细'}
              </button>
            </article>
            );
          })}
        </div>
      ) : null}

      {selected ? (
        <div className="ui-dialog-overlay" role="dialog" aria-modal="true" aria-label="点货订货明细">
          <div className="ui-dialog-panel max-w-3xl overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
              <div>
                <p className="text-sm font-semibold text-brand-700">{taskTypeLabel[selected.task.task_type]}</p>
                <h2 className="mt-1 text-lg font-bold text-slate-900">{formatDateTime(selected.task.submitted_at)}</h2>
                <p className="mt-1 text-sm text-slate-500">{selected.task.task_type === 'inventory' ? '点货人' : '订货人'}：{selectedSummary?.submitterName ?? '未知提交人'}</p>
              </div>
              <button aria-label="关闭明细" className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100" onClick={() => { setSelected(null); setSelectedSummary(null); }} type="button">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="max-h-[64vh] overflow-auto p-3">
              <div className="min-w-[420px] overflow-hidden rounded-lg border border-slate-200 text-xs sm:text-sm">
                <div className="grid grid-cols-[minmax(9rem,1.7fr)_4.5rem_5.5rem_minmax(5rem,1fr)] gap-1 bg-slate-100 px-2 py-2 text-xs font-bold text-slate-500">
                  <span>货品 / 规格</span><span>数量</span><span>状态</span><span>备注</span>
                </div>
                {selected.items.map((item, index) => {
                  const snapshot = asProductSnapshot(item.product_snapshot);
                  const actionStatus = item.product_action_status === 'deletion_requested'
                    ? '申请删除'
                    : item.product_action_status === 'deletion_approved'
                      ? '已确认删除'
                      : item.product_action_status === 'deletion_ignored'
                        ? '删除已忽略'
                        : '';
                  const quantity = item.status === 'no_order_needed'
                    ? '-'
                    : item.quantity ?? '-';
                  return (
                    <div className="grid grid-cols-[minmax(9rem,1.7fr)_4.5rem_5.5rem_minmax(5rem,1fr)] items-center gap-1 border-t border-slate-100 px-2 py-2" key={item.id}>
                      <span className="truncate font-semibold text-slate-900" title={`${index + 1}. ${snapshot.name} · ${snapshot.spec}`}>{index + 1}. {snapshot.name} · <span className="font-normal text-slate-500">{snapshot.spec || '无规格'}</span></span>
                      <span className="font-semibold text-slate-800">{quantity}{item.quantity === null ? '' : ` ${snapshot.count_unit}`}</span>
                      <span className="truncate text-slate-600" title={`${itemStatusLabel(item.status, selected.task.task_type)} ${actionStatus}`}>{actionStatus || itemStatusLabel(item.status, selected.task.task_type)}</span>
                      <span className="truncate text-slate-500" title={item.staff_note ?? ''}>{item.staff_note || (item.is_extra_item ? '本次新增货品' : '-')}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
        </>
      )}
    </PageShell>
  );
}
