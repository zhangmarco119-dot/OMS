import { PackageCheck, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { IconButton } from '../components/ui/Actions';
import { EmptyState, ErrorState, FeedbackBanner, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { canOperateV2Modules } from '../features/access/roleCapabilities';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadArrivalHistory, type ArrivalReportRow } from '../services/arrivals.service';

const statusLabel: Record<ArrivalReportRow['status'], string> = {
  draft: '草稿',
  submitted: '已提交',
  viewed: '管理员已查看',
  voided: '已作废',
};

const formatDateTime = (value: string | null) => {
  if (!value) return '未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

export function ArrivalHistoryPage() {
  const auth = useAuth();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [items, setItems] = useState<ArrivalReportRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !auth.store || !canOperateV2Modules(auth.profile?.role)) {
      setStatus('error');
      setMessage('当前账号不能查看门店到货历史。');
      return;
    }
    setStatus('loading');
    setMessage(null);
    try {
      setItems(await loadArrivalHistory(supabase, auth.store.id));
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '加载到货历史失败。');
    }
  }, [auth.profile?.role, auth.store]);

  useEffect(() => { void load(); }, [load]);

  return (
    <PageShell eyebrow="门店运营系统" title="到货历史" backTo="/app/arrivals" contentGapClassName="gap-3">
      <SectionCard><SectionHeader action={<IconButton aria-label="刷新到货历史" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></IconButton>} description={auth.store?.name ?? '未绑定门店'} icon={PackageCheck} title="本店上报记录" /></SectionCard>
      {status === 'loading' ? <LoadingState label="正在加载到货历史" /> : null}
      {status === 'error' ? <ErrorState message={message ?? '加载到货历史失败。'} onRetry={() => void load()} /> : null}
      {status === 'ready' && items.length === 0 ? <EmptyState description="提交后的到货上报会显示在这里。" icon={PackageCheck} title="暂无到货记录" /> : null}
      {status === 'ready' ? <div className="space-y-2.5">{items.map((report) => <article className="ui-card p-4" key={report.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold text-brand-700">{report.report_no}</p><h2 className="mt-1 line-clamp-2 font-bold leading-6 text-slate-900">{report.generated_summary}</h2></div><StatusBadge tone={report.status === 'voided' ? 'danger' : report.status === 'draft' ? 'neutral' : 'success'}>{statusLabel[report.status]}</StatusBadge></div><p className="mt-2 text-sm text-slate-500">{report.reporter_name_snapshot} · 到货 {report.arrival_date} {report.arrival_time?.slice(0, 5) ?? ''}</p><p className="mt-1 text-xs text-slate-400">提交时间：{formatDateTime(report.submitted_at)}</p>{report.status === 'voided' ? <FeedbackBanner className="mt-3" title="作废原因" tone="danger">{report.void_reason}</FeedbackBanner> : null}</article>)}</div> : null}
    </PageShell>
  );
}
