import { ClipboardCheck as ClipboardClock, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import { loadOperationLogs, type OperationLog } from '../services/operation-logs.service';

const moduleLabels: Record<string, string> = { account: '账号管理', arrival: '到货', inventory_order: '点货订货', notice: '公告', operation_report: '运营报告', operation_report_template: '运营报告模板', penalty: '处罚', product: '货品', sop: 'SOP', task: '任务', task_template: '任务模板', work_hours: '工时' };
const roleLabel = (row: OperationLog) => row.actor_employment_type_snapshot === 'part_time' ? '兼职' : row.actor_role_snapshot === 'admin' ? '管理员' : row.actor_role_snapshot === 'manager' ? '店长' : row.actor_role_snapshot === 'staff' ? '员工' : '系统';
const actionLabel = (row: OperationLog) => {
  if (row.operation === 'created') return '新建';
  if (row.operation === 'deleted') return '删除';
  const before = row.metadata.beforeStatus; const after = row.metadata.afterStatus;
  if (after === 'published') return '发布';
  if (after === 'archived') return '归档';
  if (after === 'submitted') return '提交';
  if (after === 'approved') return '审批通过';
  if (after === 'rejected') return '驳回';
  if (before === 'published' && ['draft', 'retracted'].includes(after)) return '撤回';
  return '修改';
};
const formatTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Shanghai' }).format(new Date(value));

export function AdminOperationLogsPage() {
  const auth = useAuth();
  const [search, setSearch] = useRememberedPageState('operation-log-search', '');
  const [storeId, setStoreId] = useRememberedPageState('operation-log-store', '');
  const [module, setModule] = useRememberedPageState('operation-log-module', '');
  const [operation, setOperation] = useRememberedPageState('operation-log-operation', '');
  const [startDate, setStartDate] = useRememberedPageState('operation-log-start', '');
  const [endDate, setEndDate] = useRememberedPageState('operation-log-end', '');
  const [items, setItems] = useState<OperationLog[]>([]); const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'); const [loadingMore, setLoadingMore] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) { setStatus('error'); return; }
    setStatus('loading');
    try { const result = await loadOperationLogs(supabase, { endDate, module, operation, search, startDate, storeId }); setItems(result.items); setTotal(result.total); setStatus('ready'); }
    catch { setStatus('error'); }
  }, [endDate, module, operation, search, startDate, storeId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);
  const more = async () => { if (!supabase) return; setLoadingMore(true); try { const result = await loadOperationLogs(supabase, { endDate, module, operation, search, startDate, storeId }, items.length); setItems((current) => [...current, ...result.items]); setTotal(result.total); } finally { setLoadingMore(false); } };

  return <PageShell backTo="/app/workbench" contentGapClassName="gap-3" eyebrow="门店运营系统 · 管理员" title="操作日志">
    <SectionCard className="p-3.5"><SectionHeader icon={ClipboardClock} title="账号操作记录" description="记录新版本上线后的关键业务操作，不保存密码、密钥和图片内容。" /><label className="relative mt-3 block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input className="ui-input pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="搜索操作人或记录名称" value={search} /></label><div className="mt-2 grid grid-cols-2 gap-2"><select className="ui-input" onChange={(event) => setStoreId(event.target.value)} value={storeId}><option value="">全部授权门店</option>{auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select><select className="ui-input" onChange={(event) => setModule(event.target.value)} value={module}><option value="">全部模块</option>{Object.entries(moduleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select className="ui-input" onChange={(event) => setOperation(event.target.value)} value={operation}><option value="">全部操作</option><option value="created">新建</option><option value="updated">修改/提交/审批</option><option value="deleted">删除</option></select><div className="grid grid-cols-2 gap-1"><input aria-label="开始日期" className="ui-input px-2" onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} /><input aria-label="结束日期" className="ui-input px-2" min={startDate} onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} /></div></div></SectionCard>
    {status === 'loading' ? <LoadingState label="正在加载操作日志" /> : status === 'error' ? <ErrorState message="暂时无法读取操作日志。" onRetry={() => void load()} /> : !items.length ? <EmptyState title="暂无匹配的操作日志" description="日志从该功能上线后开始记录。" /> : <><p className="px-1 text-xs text-slate-500">共 {total} 条记录</p><div className="space-y-2">{items.map((row) => <SectionCard className="p-3.5" key={row.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b className="text-sm text-slate-900">{row.actor_name_snapshot}</b><StatusBadge>{roleLabel(row)}</StatusBadge><StatusBadge tone={row.operation === 'deleted' ? 'danger' : row.operation === 'created' ? 'success' : 'info'}>{actionLabel(row)}</StatusBadge></div><p className="mt-2 text-sm font-semibold text-slate-700">{moduleLabels[row.module] ?? row.module} · {row.summary}</p><p className="mt-1 text-xs text-slate-500">{formatTime(row.occurred_at)}</p></div></div></SectionCard>)}</div>{items.length < total ? <button className="ui-button-secondary w-full" disabled={loadingMore} onClick={() => void more()} type="button">{loadingMore ? '正在加载' : '加载更多'}</button> : null}</>}
  </PageShell>;
}
