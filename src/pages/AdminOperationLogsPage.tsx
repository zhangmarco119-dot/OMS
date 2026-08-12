import { ChevronDown, ChevronUp, ClipboardCheck as ClipboardClock, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import {
  loadOperationLogActors,
  loadOperationLogs,
  compactConsecutiveOperationLogs,
  OPERATION_LOGS_CHANGED_EVENT,
  type OperationLog,
  type OperationLogActor,
} from '../services/operation-logs.service';
import type { Json } from '../types/database';

const moduleLabels: Record<string, string> = {
  account: '账号管理', arrival: '到货', attendance: '考勤', auth: '登录', inventory_order: '点货订货',
  notice: '公告', operation_report: '运营报告', operation_report_template: '运营报告模板',
  payroll: '薪资', penalty: '处罚', product: '货品', sop: 'SOP', task: '任务',
  task_template: '任务模板', work_hours: '工时',
};
const metadataLabels: Record<string, string> = {
  afterStatus: '操作后状态', beforeStatus: '操作前状态', changedFields: '变更内容', clientPlatform: '设备平台',
  clientRelease: '客户端版本', entityLabel: '记录名称', loginMethod: '登录方式', pagePath: '访问页面',
  period: '查看期间', reportDate: '业务日期', scope: '查看范围', statusFilter: '状态筛选',
  storeName: '门店', targetDisplayName: '目标姓名', targetUsername: '目标账号', taskType: '任务类型', viewType: '查看内容',
};
const fieldLabels: Record<string, string> = {
  display_name: '姓名', employment_type: '用工类型', is_active: '账号状态', name: '名称',
  role: '账号身份', status: '状态', title: '标题', username: '账号名', updated_at: '更新时间',
};
const valueLabels: Record<string, string> = {
  account: '账号登录', all: '全部', all_authorized_stores: '全部授权门店', approved: '已通过', archived: '已归档',
  draft: '草稿', email: '邮箱登录', estimate_detail: '预估薪资详情', estimate_summary: '员工薪资汇总',
  login: '登录系统', month_detail: '考勤详情', month_summary: '月度考勤汇总', payslip_detail: '工资单详情',
  payslip_list: '工资单列表', published: '已发布', rejected: '已驳回', retracted: '已撤回', self: '本人',
  single_store: '单个门店', submitted: '已提交',
};
const roleText = (role: OperationLog['actor_role_snapshot'], employmentType: OperationLog['actor_employment_type_snapshot']) => employmentType === 'part_time' ? '兼职' : role === 'admin' ? '管理员' : role === 'manager' ? '店长' : role === 'staff' ? '员工' : '系统';
const actorRoleText = (actor: OperationLogActor) => roleText(actor.role, actor.employmentType);
const actionLabel = (row: OperationLog) => {
  if (row.operation === 'login') return '登录';
  if (row.operation === 'viewed') return '查看';
  if (row.operation === 'created') return '新建';
  if (row.operation === 'deleted') return '删除';
  const before = row.metadata.beforeStatus;
  const after = row.metadata.afterStatus;
  if (after === 'published') return '发布';
  if (after === 'archived') return '归档';
  if (after === 'submitted') return '提交';
  if (after === 'approved') return '审批通过';
  if (after === 'rejected') return '驳回';
  if (before === 'published' && (after === 'draft' || after === 'retracted')) return '撤回';
  return '修改';
};
const formatTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Shanghai' }).format(new Date(value));
const metadataValue = (key: string, value: Json | undefined) => {
  if (key === 'changedFields' && Array.isArray(value)) return value.map((item) => fieldLabels[String(item)] ?? String(item)).join('、') || '无可展示字段';
  if (value === true) return '是';
  if (value === false) return '否';
  if (Array.isArray(value)) return value.map(String).join('、');
  if (value && typeof value === 'object') return JSON.stringify(value);
  const text = value == null ? '' : String(value);
  return valueLabels[text] ?? text;
};

export function AdminOperationLogsPage() {
  const auth = useAuth();
  const [search, setSearch] = useRememberedPageState('operation-log-search', '');
  const [actorId, setActorId] = useRememberedPageState('operation-log-actor', '');
  const [storeId, setStoreId] = useRememberedPageState('operation-log-store', '');
  const [module, setModule] = useRememberedPageState('operation-log-module', '');
  const [operation, setOperation] = useRememberedPageState('operation-log-operation', '');
  const [startDate, setStartDate] = useRememberedPageState('operation-log-start', '');
  const [endDate, setEndDate] = useRememberedPageState('operation-log-end', '');
  const [excludeActorId, setExcludeActorId] = useRememberedPageState('operation-log-exclude-actor', auth.profile?.id ?? '');
  const [keyOnly, setKeyOnly] = useRememberedPageState('operation-log-key-only', true);
  const [actors, setActors] = useState<OperationLogActor[]>([]);
  const [items, setItems] = useState<OperationLog[]>([]);
  const [total, setTotal] = useState(0);
  const [rawOffset, setRawOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const filters = useMemo(() => ({ actorId, endDate, excludeActorId, keyOnly, module, operation, search, startDate, storeId }), [actorId, endDate, excludeActorId, keyOnly, module, operation, search, startDate, storeId]);
  const hasFilters = Boolean(actorId || endDate || excludeActorId || keyOnly || module || operation || search || startDate || storeId);

  const load = useCallback(async (showLoading = true) => {
    if (!supabase) { setStatus('error'); return; }
    if (showLoading) setStatus('loading');
    try {
      const result = await loadOperationLogs(supabase, filters);
      setItems(result.items); setRawOffset(result.rawCount); setTotal(result.total); setStatus('ready'); setLastUpdatedAt(new Date());
    } catch { if (showLoading) setStatus('error'); }
  }, [filters]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { if (!supabase) return; void loadOperationLogActors(supabase).then(setActors).catch(() => setActors([])); }, []);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void load(false); };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    window.addEventListener(OPERATION_LOGS_CHANGED_EVENT, refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener(OPERATION_LOGS_CHANGED_EVENT, refresh); };
  }, [load]);

  const resetFilters = () => {
    setSearch(''); setActorId(''); setExcludeActorId(''); setKeyOnly(false); setStoreId(''); setModule(''); setOperation(''); setStartDate(''); setEndDate('');
  };

  const more = async () => {
    if (!supabase) return;
    setLoadingMore(true);
    try {
      const result = await loadOperationLogs(supabase, filters, rawOffset);
      setItems((current) => compactConsecutiveOperationLogs([...current, ...result.items])); setRawOffset((current) => current + result.rawCount); setTotal(result.total);
    } finally { setLoadingMore(false); }
  };

  return <PageShell backTo="/app/workbench" contentGapClassName="gap-3" eyebrow="门店运营系统 · 管理员" title="操作日志">
    <SectionCard className="p-3.5">
      <SectionHeader icon={ClipboardClock} title="账号操作记录" description="记录登录、考勤和薪资查看以及关键业务变更；不保存密码、令牌、图片内容或完整薪资数值。" />
      <label className="relative mt-3 block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input className="ui-input pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="搜索操作人、账号或记录名称" value={search} /></label>
      <label className="mt-2 block text-xs font-semibold text-slate-600">账号筛选<select className="ui-input mt-1" onChange={(event) => setActorId(event.target.value)} value={actorId}><option value="">全部账号</option>{actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.displayName}{actor.username ? `（${actor.username}）` : ''} · {actorRoleText(actor)}</option>)}</select></label>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-slate-600">排除某人<select className="ui-input mt-1" disabled={Boolean(actorId)} onChange={(event) => setExcludeActorId(event.target.value)} value={excludeActorId}><option value="">不排除</option>{actors.map((actor) => <option key={actor.id} value={actor.id}>不看{actor.id === auth.profile?.id ? '自己 · ' : ''}{actor.displayName}</option>)}</select></label>
        <label className="flex min-h-11 items-center gap-2 self-end rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold"><input checked={keyOnly} disabled={Boolean(operation)} onChange={(event) => setKeyOnly(event.target.checked)} type="checkbox" />只看关键操作</label>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <select aria-label="门店筛选" className="ui-input" onChange={(event) => setStoreId(event.target.value)} value={storeId}><option value="">全部授权门店</option>{auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select>
        <select aria-label="模块筛选" className="ui-input" onChange={(event) => setModule(event.target.value)} value={module}><option value="">全部模块</option>{Object.entries(moduleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select aria-label="操作筛选" className="ui-input" onChange={(event) => setOperation(event.target.value)} value={operation}><option value="">全部操作</option><option value="login">登录</option><option value="viewed">查看</option><option value="created">新建</option><option value="updated">修改/提交/审批</option><option value="deleted">删除</option></select>
        <div className="grid grid-cols-2 gap-1"><input aria-label="开始日期" className="ui-input px-2" onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} /><input aria-label="结束日期" className="ui-input px-2" min={startDate} onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} /></div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button className="ui-button-secondary min-h-10" onClick={() => void load(false)} type="button"><RefreshCw className="h-4 w-4" />立即刷新</button>
        <button className="ui-button-secondary min-h-10" disabled={!hasFilters} onClick={resetFilters} type="button"><RotateCcw className="h-4 w-4" />清除筛选</button>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-slate-500">默认隐藏自己的普通查看记录；相邻的同人同事项只显示一次。日志每 15 秒自动更新{lastUpdatedAt ? ` · 最近更新 ${lastUpdatedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</p>
    </SectionCard>
    {status === 'loading' ? <LoadingState label="正在加载操作日志" /> : status === 'error' ? <ErrorState message="暂时无法读取操作日志。" onRetry={() => void load()} /> : !items.length ? <EmptyState title="暂无匹配的操作日志" description="可以调整账号、模块、操作或日期筛选条件。" /> : <>
      <p className="px-1 text-xs text-slate-500">共 {total} 条记录</p>
      <div className="space-y-2">{items.map((row) => {
        const expanded = expandedId === row.id;
        const storeName = auth.availableStores.find((store) => store.id === row.store_id)?.name ?? (typeof row.metadata.storeName === 'string' ? row.metadata.storeName : '');
        const detailEntries = Object.entries(row.metadata).filter(([key, value]) => !['clientPlatform', 'clientRelease', 'dedupeWindowSeconds', 'eventKey', 'pagePath', 'targetProfileId'].includes(key) && value != null && value !== '' && !(Array.isArray(value) && value.length === 0));
        return <SectionCard className="p-3.5" key={row.id}>
          <div className="flex flex-wrap items-center gap-2"><b className="text-sm text-slate-900">{row.actor_name_snapshot}</b>{row.actor_username_snapshot ? <span className="text-xs text-slate-500">@{row.actor_username_snapshot}</span> : null}<StatusBadge>{roleText(row.actor_role_snapshot, row.actor_employment_type_snapshot)}</StatusBadge><StatusBadge tone={row.operation === 'deleted' ? 'danger' : row.operation === 'created' || row.operation === 'login' ? 'success' : 'info'}>{actionLabel(row)}</StatusBadge></div>
          <p className="mt-2 text-sm font-semibold text-slate-700">{moduleLabels[row.module] ?? row.module} · {row.summary}{row.repeatCount > 1 ? <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">连续 {row.repeatCount} 次</span> : null}</p>
          <p className="mt-1 text-xs text-slate-500">{formatTime(row.occurred_at)}{storeName ? ` · ${storeName}` : ''}</p>
          {detailEntries.length ? <button className="mt-2 flex min-h-8 items-center gap-1 text-xs font-bold text-brand-700" onClick={() => setExpandedId(expanded ? null : row.id)} type="button">{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}{expanded ? '收起详情' : '查看详情'}</button> : null}
          {expanded ? <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1"><dt>账号</dt><dd className="break-all">{row.actor_username_snapshot || '未记录'}</dd><dt>姓名</dt><dd>{row.actor_name_snapshot}</dd><dt>身份</dt><dd>{roleText(row.actor_role_snapshot, row.actor_employment_type_snapshot)}</dd><dt>模块与动作</dt><dd>{moduleLabels[row.module] ?? row.module} · {actionLabel(row)}</dd>{row.entity_id ? <><dt>记录标识</dt><dd className="break-all">{row.entity_id}</dd></> : null}{detailEntries.map(([key, value]) => <div className="contents" key={`${row.id}-${key}`}><dt>{metadataLabels[key] ?? key}</dt><dd className="break-all">{metadataValue(key, value)}</dd></div>)}</dl>
          </div> : null}
        </SectionCard>;
      })}</div>
      {rawOffset < total ? <button className="ui-button-secondary w-full" disabled={loadingMore} onClick={() => void more()} type="button">{loadingMore ? '正在加载' : '加载更多'}</button> : null}
    </>}
  </PageShell>;
}
