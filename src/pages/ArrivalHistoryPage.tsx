import { PackageCheck, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
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
    <PageShell eyebrow="门店运营系统" title="到货历史" backTo="/app/arrivals">
      <div className="flex items-center justify-between gap-3 rounded-lg bg-white p-4 shadow-sm">
        <div><p className="text-sm text-slate-500">当前门店</p><p className="mt-1 font-bold text-slate-900">{auth.store?.name}</p></div>
        <button aria-label="刷新到货历史" className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-700" onClick={() => void load()} type="button"><RefreshCw className="h-5 w-5" aria-hidden="true" /></button>
      </div>
      {status === 'loading' ? <div className="h-28 animate-pulse rounded-lg bg-white shadow-sm" /> : null}
      {status === 'error' ? <div className="rounded-lg bg-white p-5 text-sm leading-6 text-red-700 shadow-sm">{message}<button className="mt-4 min-h-11 w-full rounded-lg bg-brand-600 font-bold text-white" onClick={() => void load()} type="button">重试</button></div> : null}
      {status === 'ready' && items.length === 0 ? <div className="rounded-lg bg-white p-8 text-center shadow-sm"><PackageCheck className="mx-auto h-12 w-12 text-slate-300" aria-hidden="true" /><p className="mt-4 font-bold text-slate-900">暂无到货记录</p><p className="mt-2 text-sm text-slate-500">提交后的到货上报会显示在这里。</p></div> : null}
      {status === 'ready' ? <div className="space-y-3">{items.map((report) => <article className="rounded-lg bg-white p-4 shadow-sm" key={report.id}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-brand-700">{report.report_no}</p><h2 className="mt-1 font-bold text-slate-900">{report.generated_summary}</h2></div><span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${report.status === 'voided' ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-700'}`}>{statusLabel[report.status]}</span></div><p className="mt-3 text-sm text-slate-500">{report.reporter_name_snapshot} · 到货 {report.arrival_date} {report.arrival_time?.slice(0, 5) ?? ''}</p><p className="mt-1 text-xs text-slate-400">提交时间：{formatDateTime(report.submitted_at)}</p>{report.status === 'voided' ? <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">作废原因：{report.void_reason}</p> : null}</article>)}</div> : null}
    </PageShell>
  );
}
