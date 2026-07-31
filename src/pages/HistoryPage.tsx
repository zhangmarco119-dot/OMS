import { Eye, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { EmptyState, ErrorState, FeedbackBanner, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { SegmentedControl } from '../components/ui/FormField';
import { SectionCard } from '../components/ui/Surface';
import { ProductFeedbackRecords } from '../features/admin/ProductFeedbackRecords';
import { useAuth } from '../features/auth/AuthContext';
import { loadSubmittedTasks, type HistoryTask } from '../features/history/historyService';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import type { TaskType } from '../types/domain';

const taskTypeLabel: Record<TaskType, string> = {
  inventory: '点货单',
  order: '订货单',
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
  const [filter, setFilter] = useRememberedPageState<TaskType | 'all'>('task-type', 'all');
  const [adminView, setAdminView] = useRememberedPageState<'tasks' | 'feedback'>('admin-view', 'tasks');
  const [items, setItems] = useState<HistoryTask[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const isAdmin = auth.profile?.role === 'admin';

  useEffect(() => { if (searchParams.get('view') === 'feedback') setAdminView('feedback'); }, [searchParams, setAdminView]);

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
              <Link
                className="ui-button-primary mt-4 w-full"
                to={`/app/history/${task.id}`}
              >
                <Eye className="h-5 w-5" aria-hidden="true" />
                查看明细
              </Link>
            </article>
            );
          })}
        </div>
      ) : null}

        </>
      )}
    </PageShell>
  );
}
