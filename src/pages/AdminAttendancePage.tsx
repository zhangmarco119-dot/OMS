import { AlertTriangle, Building2, Clock3, Gauge, Link2, ListChecks, Plus, RefreshCw, Search, Trash2, Unlink, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ActionFeedbackDialog, type ActionFeedbackTone } from '../components/feedback/ActionFeedbackDialog';
import { PageShell } from '../components/layout/PageShell';
import { ConfirmDialog } from '../components/ui/Actions';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { currentMonth } from '../features/attendance/model';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import { bindAttendanceEmployee, invokeAttendanceSync, loadAdminAttendanceMonth, loadAttendanceBindings, loadAttendanceEnterpriseSetup, loadAttendanceIncrementalSchedule, loadAttendanceSyncJobs, loadDingTalkApiUsage, removeAttendanceEnterpriseMapping, saveAttendanceEnterpriseMapping, saveAttendanceIncrementalSchedule, saveDingTalkApiDailyLimit, unbindAttendanceEmployee, type AttendanceBindingCandidate, type AttendanceEmployeeBinding, type AttendanceEnterpriseSetup, type AttendanceIncrementalSchedule, type AttendanceSyncJob, type DingTalkApiUsage } from '../services/attendance.service';
import { recordSystemActivity } from '../services/operation-logs.service';

type Tab = 'overview' | 'enterprises' | 'bindings' | 'logs';

export function AdminAttendancePage() {
  const [params, setParams] = useSearchParams();
  const tab = (['overview', 'enterprises', 'bindings', 'logs'].includes(params.get('tab') ?? '') ? params.get('tab') : 'overview') as Tab;
  return <PageShell eyebrow="门店运营系统 · 管理员" title="考勤管理" backTo="/app/workbench" contentGapClassName="gap-3">
    <nav className="ui-card grid grid-cols-4 gap-1 p-1.5" aria-label="考勤管理功能">
      {([{ key: 'overview', label: '月度考勤', icon: ListChecks }, { key: 'enterprises', label: '企业门店', icon: Building2 }, { key: 'bindings', label: '员工绑定', icon: Users }, { key: 'logs', label: '同步日志', icon: RefreshCw }] as const).map(({ key, label, icon: Icon }) => <button className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-bold sm:flex-row sm:text-sm ${tab === key ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-600'}`} key={key} onClick={() => setParams({ tab: key }, { replace: true })} type="button"><Icon className="h-4 w-4" />{label}</button>)}
    </nav>
    {tab === 'overview' ? <AttendanceOverview /> : null}
    {tab === 'enterprises' ? <AttendanceEnterprises /> : null}
    {tab === 'bindings' ? <AttendanceBindings /> : null}
    {tab === 'logs' ? <AttendanceLogs /> : null}
  </PageShell>;
}

function AttendanceOverview() {
  const auth = useAuth();
  const [month, setMonth] = useRememberedPageState('overview-month', currentMonth());
  const [storeId, setStoreId] = useRememberedPageState('overview-store', '');
  const [search, setSearch] = useRememberedPageState('overview-search', '');
  const [statusFilter, setStatusFilter] = useRememberedPageState('overview-status', 'all');
  const [items, setItems] = useState<Awaited<ReturnType<typeof loadAdminAttendanceMonth>>['items']>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [syncing, setSyncing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [apiUsage, setApiUsage] = useState<DingTalkApiUsage | null>(null);
  const [dailyLimit, setDailyLimit] = useState(150);
  const [savingLimit, setSavingLimit] = useState(false);
  const [schedule, setSchedule] = useState<AttendanceIncrementalSchedule>({ configured: false, configuredAt: null, enabled: false, lastDispatchedAt: null, times: ['10:00', '14:00', '22:00'] });
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [feedback, setFeedback] = useState<{ title: string; message: string; tone: ActionFeedbackTone } | null>(null);
  const load = useCallback(async () => {
    if (!supabase) { setStatus('error'); return; }
    setStatus('loading');
    try { const result = await loadAdminAttendanceMonth(supabase, { month, storeId, search, status: statusFilter }); setItems(result.items); setTotal(result.total); setStatus('ready'); void recordSystemActivity(supabase, { module: 'attendance', view: 'month_summary', period: month, storeId: storeId || undefined, context: { scope: storeId ? 'single_store' : 'all_authorized_stores', statusFilter } }).catch(() => undefined); }
    catch { setStatus('error'); }
  }, [month, search, statusFilter, storeId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);
  const loadUsage = useCallback(async () => {
    if (!supabase) return;
    try { const usage = await loadDingTalkApiUsage(supabase); setApiUsage(usage); setDailyLimit(usage.limit); } catch { setApiUsage(null); }
  }, []);
  useEffect(() => { void loadUsage(); }, [loadUsage]);
  const loadSchedule = useCallback(async () => {
    if (!supabase) return;
    try {
      const loaded = await loadAttendanceIncrementalSchedule(supabase);
      setSchedule({ ...loaded, times: loaded.times.length ? loaded.times : ['10:00', '14:00', '22:00'] });
    } catch { /* The migration may not have been deployed yet. */ }
  }, []);
  useEffect(() => { void loadSchedule(); }, [loadSchedule]);
  const sync = async () => {
    if (!supabase) return;
    setSyncing(true);
    try {
      const response = await invokeAttendanceSync(supabase, { action: 'sync', month, ...(storeId ? { storeId } : {}) });
      setFeedback({ title: response?.status === 'partial' ? '同步部分完成' : '同步完成', message: response?.message ?? '考勤数据已同步。', tone: response?.status === 'partial' ? 'warning' : 'success' });
      await Promise.all([load(), loadUsage()]);
    } catch (error) { setFeedback({ title: '同步未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'warning' }); }
    finally { setSyncing(false); }
  };
  const loadMore = async () => {
    if (!supabase) return;
    setLoadingMore(true);
    try {
      const result = await loadAdminAttendanceMonth(supabase, { month, storeId, search, status: statusFilter, offset: items.length });
      setItems((current) => [...current, ...result.items]); setTotal(result.total);
    } catch { setFeedback({ title: '加载未完成', message: '暂时无法加载更多员工，请稍后重试。', tone: 'warning' }); }
    finally { setLoadingMore(false); }
  };
  const saveSchedule = async () => {
    if (!supabase) return;
    if (!schedule.times.length || schedule.times.some((time) => !/^\d{2}:\d{2}$/.test(time))) {
      setFeedback({ title: '请设置同步时间', message: '至少保留一个有效的每日同步时间。', tone: 'warning' });
      return;
    }
    setSavingSchedule(true);
    try {
      const saved = await saveAttendanceIncrementalSchedule(supabase, schedule.enabled, schedule.times);
      setSchedule(saved);
      setFeedback({ title: '定时同步已保存', message: saved.enabled ? `系统会在每天 ${saved.times.join('、')} 执行增量同步。` : '定时同步已关闭，仍可随时手动执行增量同步。', tone: 'success' });
    } catch (error) {
      setFeedback({ title: '设置未保存', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'warning' });
    } finally { setSavingSchedule(false); }
  };
  const saveApiLimit = async () => {
    if (!supabase || !Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 300) {
      setFeedback({ title: '限额不正确', message: '当日临时限额应为 1 至 300 次。', tone: 'warning' });
      return;
    }
    setSavingLimit(true);
    try {
      const usage = await saveDingTalkApiDailyLimit(supabase, dailyLimit);
      setApiUsage(usage); setDailyLimit(usage.limit);
      setFeedback({ title: '当日限额已调整', message: `今天的钉钉接口限额已临时调整为 ${usage.limit} 次，明天自动恢复默认 150 次。`, tone: 'success' });
    } catch (error) {
      setFeedback({ title: '限额未调整', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'warning' });
    } finally { setSavingLimit(false); }
  };
  return <>
    <SectionCard className="p-3.5">
      <div className="grid grid-cols-2 gap-2"><label className="text-xs font-semibold text-slate-600">月份<input className="ui-input mt-1" max={currentMonth()} onChange={(event) => setMonth(event.target.value)} type="month" value={month} /></label><label className="text-xs font-semibold text-slate-600">门店<select className="ui-input mt-1" onChange={(event) => setStoreId(event.target.value)} value={storeId}><option value="">全部授权门店</option>{auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label></div>
      <label className="relative mt-2 block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input className="ui-input pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="搜索员工姓名或账号" value={search} /></label>
      <div className="mt-2 grid grid-cols-5 gap-1">{[['all', '全部'], ['normal', '正常'], ['late', '迟到'], ['missing', '缺卡'], ['abnormal', '异常']] .map(([value, label]) => <button className={`min-h-9 rounded-md text-xs font-bold ${statusFilter === value ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'}`} key={value} onClick={() => setStatusFilter(value)} type="button">{label}</button>)}</div>
      <button className="ui-button-primary mt-3 w-full" disabled={syncing} onClick={() => void sync()} type="button"><RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />{syncing ? '正在同步' : `同步${month}考勤`}</button>
      <p className="mt-2 text-xs leading-5 text-slate-500">手动同步不受 5 分钟限制，每次都会重新执行增量检查，只读取未同步日期、当天和仍需复查的缺卡或异常日期；同一范围正在同步时会阻止重复并发。</p>
    </SectionCard>
    <SectionCard className="p-3.5">
      <SectionHeader icon={Gauge} title="钉钉接口调用量" description="系统按真实外部请求计数，每日默认限额为 150 次。" />
      <div className={`mt-3 rounded-lg p-3 ${apiUsage && apiUsage.remaining <= 30 ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'}`}><div className="flex items-end justify-between gap-3"><b className="text-2xl">{apiUsage?.used ?? '—'} / {apiUsage?.limit ?? 150}</b><span className="text-sm font-semibold">剩余 {apiUsage?.remaining ?? '—'} 次</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/70"><div className="h-full rounded-full bg-current transition-all" style={{ width: `${apiUsage ? Math.min(100, apiUsage.used / apiUsage.limit * 100) : 0}%` }} /></div></div>
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><label className="text-xs font-semibold text-slate-600">今日临时限额<input className="ui-input mt-1" max={300} min={1} onChange={(event) => setDailyLimit(Number(event.target.value))} type="number" value={dailyLimit} /></label><button className="ui-button-secondary mt-5 px-4" disabled={savingLimit} onClick={() => void saveApiLimit()} type="button">{savingLimit ? '调整中' : '临时调整'}</button></div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{apiUsage?.temporaryOverride ? '今天正在使用临时限额；次日会自动恢复 150 次。' : '如有临时需要可只调整今天的限额，次日自动恢复 150 次。'}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">系统按企业批量读取员工，并只请求增量日期；运营报告不会调用钉钉接口。</p>
    </SectionCard>
    <SectionCard className="p-3.5">
      <SectionHeader icon={Clock3} title="定时增量同步" description="可设置多个每日固定时间。每次只同步数据库尚未覆盖的日期，并刷新当天数据。" />
      <label className="mt-3 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-3 text-sm font-bold text-emerald-900"><span>启用每日定时同步</span><input checked={schedule.enabled} className="h-5 w-5 accent-emerald-700" onChange={(event) => setSchedule((current) => ({ ...current, enabled: event.target.checked }))} type="checkbox" /></label>
      <div className="mt-3 space-y-2">{schedule.times.map((time, index) => <div className="grid grid-cols-[1fr_auto] gap-2" key={`${index}-${time}`}><input aria-label={`第 ${index + 1} 个同步时间`} className="ui-input" onChange={(event) => setSchedule((current) => ({ ...current, times: current.times.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} type="time" value={time} /><button aria-label="删除同步时间" className="ui-button-secondary min-h-11 px-3 text-red-700" disabled={schedule.times.length <= 1} onClick={() => setSchedule((current) => ({ ...current, times: current.times.filter((_, itemIndex) => itemIndex !== index) }))} type="button"><Trash2 className="h-4 w-4" /></button></div>)}</div>
      <div className="mt-3 grid grid-cols-2 gap-2"><button className="ui-button-secondary" disabled={schedule.times.length >= 8} onClick={() => setSchedule((current) => ({ ...current, times: [...current.times, '12:00'] }))} type="button"><Plus className="h-4 w-4" />增加时间</button><button className="ui-button-primary" disabled={savingSchedule} onClick={() => void saveSchedule()} type="button">{savingSchedule ? '正在保存' : '保存设置'}</button></div>
      <p className="mt-2 text-xs leading-5 text-slate-500">最多设置 8 个时间。最近执行：{schedule.lastDispatchedAt ? new Date(schedule.lastDispatchedAt).toLocaleString('zh-CN') : '尚未执行'}</p>
    </SectionCard>
    {status === 'loading' ? <LoadingState label="正在汇总员工考勤" /> : null}
    {status === 'error' ? <ErrorState message="暂时无法加载门店考勤汇总。" onRetry={() => void load()} /> : null}
    {status === 'ready' && !items.length ? <EmptyState title="没有符合条件的员工" description="可更换筛选条件，或先在“员工绑定”中完成钉钉账号绑定。" /> : null}
    {status === 'ready' ? <section className="space-y-2">{items.map((item) => <Link className="ui-interactive ui-card block p-3.5" key={`${item.profileId}-${item.storeId}`} to={`/app/admin/attendance/${item.profileId}?month=${month}${storeId ? `&store=${storeId}` : ''}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b className="block truncate text-slate-900">{item.displayName}</b><p className="mt-0.5 truncate text-xs text-slate-500">{item.storeName}</p></div><StatusBadge tone={item.bindingStatus === 'active' ? 'success' : 'warning'}>{item.bindingStatus === 'active' ? '已绑定' : '未绑定'}</StatusBadge></div><div className="mt-3 grid grid-cols-5 items-stretch gap-1 text-center"><MiniMetric label="出勤" value={item.attendanceDays} /><MiniMetric label="加班" value={`${item.overtimeHours}h`} /><MiniMetric compact label="迟到" value={`${item.lateCount}/${item.lateMinutes}`} /><MiniMetric label="缺卡" value={item.missingCount} /><MiniMetric label="异常" value={item.abnormalCount} /></div><p className="mt-2 text-[11px] text-slate-400">{storeId ? '当前仅统计所选门店' : '当前统计全部授权门店'} · 最近同步：{item.lastSyncedAt ? new Date(item.lastSyncedAt).toLocaleString('zh-CN') : '尚未同步'}</p></Link>)}{total > items.length ? <button className="ui-button-secondary w-full" disabled={loadingMore} onClick={() => void loadMore()} type="button">{loadingMore ? '正在加载' : `加载更多（已显示 ${items.length}/${total}）`}</button> : null}</section> : null}
    <ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone} />
  </>;
}

function AttendanceEnterprises() {
  const auth = useAuth();
  const [setup, setSetup] = useState<AttendanceEnterpriseSetup>({ enterprises: [], mappings: [] });
  const [selectedStores, setSelectedStores] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState('');
  const [removeId, setRemoveId] = useState('');
  const [feedback, setFeedback] = useState<{ title: string; message: string; tone: ActionFeedbackTone } | null>(null);
  const load = useCallback(async () => { if (!supabase) return; setStatus('loading'); try { setSetup(await loadAttendanceEnterpriseSetup(supabase)); setStatus('ready'); } catch { setStatus('error'); } }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async (corpId: string, displayName: string) => { const storeId = selectedStores[corpId]; if (!supabase || !storeId) { setFeedback({ title: '请选择门店', message: '请选择该钉钉企业对应的门店后再保存。', tone: 'warning' }); return; } setBusy(corpId); try { await saveAttendanceEnterpriseMapping(supabase, corpId, displayName, storeId); setFeedback({ title: '对应关系已保存', message: `${displayName} 已与所选门店建立对应关系。`, tone: 'success' }); await load(); } catch (error) { setFeedback({ title: '保存未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'warning' }); } finally { setBusy(''); } };
  const remove = async () => { if (!supabase || !removeId) return; const id = removeId; setRemoveId(''); setBusy(id); try { await removeAttendanceEnterpriseMapping(supabase, id); setFeedback({ title: '对应关系已移除', message: '该企业与门店的对应关系已移除。', tone: 'success' }); await load(); } catch (error) { setFeedback({ title: '移除未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'warning' }); } finally { setBusy(''); } };
  return <><SectionCard className="p-3.5"><p className="text-sm leading-6 text-slate-600">一个钉钉账号可以配置多个企业。先将每个企业与实际门店对应，再到“员工绑定”中为同一员工绑定不同企业身份；考勤会自动合并。</p></SectionCard>{status === 'loading' ? <LoadingState label="正在加载企业与门店" /> : null}{status === 'error' ? <ErrorState message="暂时无法加载企业与门店对应关系。" onRetry={() => void load()} /> : null}{status === 'ready' && !setup.enterprises.length ? <EmptyState title="尚未读取到钉钉企业" description="请先到员工绑定页面更新钉钉通讯录。" /> : null}{status === 'ready' ? <section className="space-y-2">{setup.enterprises.map((enterprise) => <SectionCard className="p-3.5" key={enterprise.corp_id}><div className="flex items-start justify-between gap-2"><div><b>{enterprise.display_name}</b><p className="mt-0.5 text-[11px] text-slate-400">企业标识 · {enterprise.corp_id}</p></div><StatusBadge tone="success">已配置凭据</StatusBadge></div><div className="mt-3 space-y-2">{setup.mappings.filter((mapping) => mapping.corp_id === enterprise.corp_id).map((mapping) => <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm" key={mapping.id}><span>{auth.availableStores.find((store) => store.id === mapping.store_id)?.name ?? '未知门店'}</span><button className="text-xs font-bold text-red-700" disabled={busy === mapping.id} onClick={() => setRemoveId(mapping.id)} type="button">移除</button></div>)}</div><div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><select className="ui-input" onChange={(event) => setSelectedStores((value) => ({ ...value, [enterprise.corp_id]: event.target.value }))} value={selectedStores[enterprise.corp_id] ?? ''}><option value="">选择要对应的门店</option>{auth.availableStores.filter((store) => !setup.mappings.some((mapping) => mapping.corp_id === enterprise.corp_id && mapping.store_id === store.id)).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select><button className="ui-button-primary px-4" disabled={busy === enterprise.corp_id} onClick={() => void save(enterprise.corp_id, enterprise.display_name)} type="button">保存</button></div></SectionCard>)}</section> : null}<ConfirmDialog confirmLabel="移除对应关系" danger onCancel={() => setRemoveId('')} onConfirm={() => void remove()} open={Boolean(removeId)} title="确认移除企业门店对应关系"><p>如果仍有员工使用该企业与门店绑定，系统会阻止移除，并提示先解除员工绑定。</p></ConfirmDialog><ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone} /></>;
}

function AttendanceBindings() {
  const auth = useAuth();
  const [candidates, setCandidates] = useState<AttendanceBindingCandidate[]>([]);
  const [directory, setDirectory] = useState<Awaited<ReturnType<typeof loadAttendanceBindings>>['directory']>([]);
  const [setup, setSetup] = useState<AttendanceEnterpriseSetup>({ enterprises: [], mappings: [] });
  const [search, setSearch] = useRememberedPageState('bindings-search', '');
  const [bindingFilter, setBindingFilter] = useRememberedPageState<'all' | 'bound' | 'unbound' | 'error'>('bindings-filter', 'all');
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [selectedStores, setSelectedStores] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState('');
  const [confirmUnbind, setConfirmUnbind] = useState<{ candidate: AttendanceBindingCandidate; binding: AttendanceEmployeeBinding } | null>(null);
  const [feedback, setFeedback] = useState<{ title: string; message: string; tone: ActionFeedbackTone } | null>(null);
  const load = useCallback(async () => { if (!supabase) return; setStatus('loading'); try { const result = await loadAttendanceBindings(supabase); setCandidates(result.candidates); setDirectory(result.directory); setSetup(result.setup); setSelected((current) => Object.fromEntries(result.candidates.map((item) => [item.profile.id, current[item.profile.id] ?? item.suggestedEmployees[0]?.id ?? '']))); setStatus('ready'); } catch { setStatus('error'); } }, []);
  useEffect(() => { void load(); }, [load]);
  const filtered = useMemo(() => candidates.filter((item) => { const text = `${item.profile.display_name}${item.profile.username}${item.storeName}${item.bindings.map((binding) => `${binding.employee?.display_name}${binding.enterpriseName}${binding.storeName}`).join('')}`.toLowerCase(); const hasActive = item.bindings.some((binding) => binding.binding.binding_status === 'active'); const hasError = item.bindings.some((binding) => binding.binding.binding_status === 'error'); return (!search.trim() || text.includes(search.trim().toLowerCase())) && (bindingFilter === 'all' || bindingFilter === 'bound' && hasActive || bindingFilter === 'error' && hasError || bindingFilter === 'unbound' && !hasActive); }), [bindingFilter, candidates, search]);
  const refreshDirectory = async () => { if (!supabase) return; setBusy('directory'); try { const response = await invokeAttendanceSync(supabase, { action: 'refresh-directory' }); setFeedback({ title: '通讯录已更新', message: response?.message ?? '钉钉员工通讯录已更新。', tone: 'success' }); await load(); } catch (error) { setFeedback({ title: '通讯录更新未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'warning' }); } finally { setBusy(''); } };
  const bind = async (candidate: AttendanceBindingCandidate) => { const employeeId = selected[candidate.profile.id]; const employee = directory.find((item) => item.id === employeeId); const availableStores = employee ? setup.mappings.filter((mapping) => mapping.corp_id === employee.corp_id).map((mapping) => mapping.store_id) : []; const storeId = selectedStores[candidate.profile.id] || (availableStores.includes(candidate.profile.store_id) ? candidate.profile.store_id : availableStores[0]); if (!supabase || !employeeId || !storeId) { setFeedback({ title: '请完善绑定信息', message: !employeeId ? '请选择钉钉员工。' : '该员工所在钉钉企业尚未对应门店，请先完成企业门店设置。', tone: 'warning' }); return; } setBusy(candidate.profile.id); try { await bindAttendanceEmployee(supabase, candidate.profile.id, employeeId, storeId, candidate.suggestedEmployees.some((item) => item.id === employeeId)); setFeedback({ title: '绑定成功', message: `${candidate.profile.display_name} 已新增一个钉钉企业身份。`, tone: 'success' }); setSelected((value) => ({ ...value, [candidate.profile.id]: '' })); await load(); } catch (error) { setFeedback({ title: '绑定未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'warning' }); } finally { setBusy(''); } };
  const unbind = async () => { if (!supabase || !confirmUnbind) return; const target = confirmUnbind; setConfirmUnbind(null); setBusy(target.binding.binding.id); try { await unbindAttendanceEmployee(supabase, target.binding.binding.id); setFeedback({ title: '已解除绑定', message: `${target.candidate.profile.display_name} 在 ${target.binding.enterpriseName} 的身份绑定已解除。`, tone: 'success' }); await load(); } catch (error) { setFeedback({ title: '解除绑定未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'warning' }); } finally { setBusy(''); } };
  return <><SectionCard className="p-3"><button className="ui-button-primary w-full" disabled={busy === 'directory'} onClick={() => void refreshDirectory()} type="button"><RefreshCw className={`h-4 w-4 ${busy === 'directory' ? 'animate-spin' : ''}`} />{busy === 'directory' ? '正在读取所有企业通讯录' : '更新钉钉员工通讯录'}</button><label className="relative mt-2 block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input className="ui-input pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="搜索账号、姓名、门店、企业或钉钉员工" value={search} /></label><div className="mt-2 grid grid-cols-4 gap-1">{([['all', '全部'], ['bound', '已绑定'], ['unbound', '未绑定'], ['error', '异常']] as const).map(([value, label]) => <button className={`min-h-9 rounded-md text-xs font-bold ${bindingFilter === value ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'}`} key={value} onClick={() => setBindingFilter(value)} type="button">{label}</button>)}</div></SectionCard>{status === 'loading' ? <LoadingState label="正在加载员工绑定" /> : null}{status === 'error' ? <ErrorState message="暂时无法加载员工绑定。" onRetry={() => void load()} /> : null}{status === 'ready' && !filtered.length ? <EmptyState title="没有符合条件的员工" /> : null}{status === 'ready' ? <section className="space-y-2">{filtered.map((candidate) => { const employee = directory.find((item) => item.id === selected[candidate.profile.id]); const mappedStoreIds = employee ? setup.mappings.filter((mapping) => mapping.corp_id === employee.corp_id).map((mapping) => mapping.store_id) : []; return <SectionCard className="p-3.5" key={candidate.profile.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b className="block truncate">{candidate.profile.display_name}</b><p className="text-xs text-slate-500">{candidate.profile.username} · {candidate.storeName}</p></div><StatusBadge tone={candidate.bindings.some((item) => item.binding.binding_status === 'error') ? 'danger' : candidate.bindings.some((item) => item.binding.binding_status === 'active') ? 'success' : 'warning'}>{candidate.bindings.filter((item) => item.binding.binding_status === 'active').length} 个企业身份</StatusBadge></div><div className="mt-2 space-y-2">{candidate.bindings.map((item) => <div className={`flex items-center justify-between gap-2 rounded-lg p-3 text-sm ${item.binding.binding_status === 'error' ? 'bg-red-50' : 'bg-emerald-50'}`} key={item.binding.id}><span className="min-w-0"><b className="block truncate"><Link2 className="mr-1 inline h-4 w-4" />{item.employee?.display_name ?? item.binding.dingtalk_user_id}</b><small className="block truncate text-slate-500">{item.enterpriseName} · {item.storeName}</small></span><button className="ui-button-secondary min-h-8 shrink-0 px-2 py-1 text-xs text-red-700" disabled={busy === item.binding.id} onClick={() => setConfirmUnbind({ candidate, binding: item })} type="button"><Unlink className="h-3.5 w-3.5" />解除</button></div>)}</div><div className="mt-3 rounded-lg border border-dashed p-3"><p className="mb-2 text-xs font-bold text-slate-600">新增企业身份</p><select className="ui-input" onChange={(event) => { setSelected((value) => ({ ...value, [candidate.profile.id]: event.target.value })); setSelectedStores((value) => ({ ...value, [candidate.profile.id]: '' })); }} value={selected[candidate.profile.id] ?? ''}><option value="">选择钉钉员工</option>{directory.filter((item) => !candidate.bindings.some((binding) => binding.binding.corp_id === item.corp_id && binding.binding.binding_status === 'active')).map((item) => <option key={item.id} value={item.id}>{item.display_name} · {setup.enterprises.find((enterprise) => enterprise.corp_id === item.corp_id)?.display_name ?? item.corp_id}{candidate.suggestedEmployees.some((suggested) => suggested.id === item.id) ? '（姓名一致）' : ''}</option>)}</select>{employee ? <select className="ui-input mt-2" onChange={(event) => setSelectedStores((value) => ({ ...value, [candidate.profile.id]: event.target.value }))} value={selectedStores[candidate.profile.id] || (mappedStoreIds.includes(candidate.profile.store_id) ? candidate.profile.store_id : mappedStoreIds[0] ?? '')}><option value="">选择对应门店</option>{auth.availableStores.filter((store) => mappedStoreIds.includes(store.id)).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select> : null}<button className="ui-button-primary mt-2 w-full" disabled={busy === candidate.profile.id || !selected[candidate.profile.id]} onClick={() => void bind(candidate)} type="button">{busy === candidate.profile.id ? '正在绑定' : '确认新增绑定'}</button></div></SectionCard>; })}</section> : null}<ConfirmDialog confirmLabel="解除绑定" danger onCancel={() => setConfirmUnbind(null)} onConfirm={() => void unbind()} open={Boolean(confirmUnbind)} title="确认解除该企业身份"><p>解除后不会删除历史考勤；其他企业身份仍会继续同步。</p></ConfirmDialog><ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone} /></>;
}

function AttendanceLogs() {
  const [jobs, setJobs] = useState<AttendanceSyncJob[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState<{ title: string; message: string; tone: ActionFeedbackTone } | null>(null);
  const load = useCallback(async () => { if (!supabase) { setStatus('error'); return; } setStatus('loading'); try { setJobs(await loadAttendanceSyncJobs(supabase)); setStatus('ready'); } catch { setStatus('error'); } }, []);
  useEffect(() => { void load(); }, [load]);
  const retry = async (job: AttendanceSyncJob) => { if (!supabase) return; setBusy(job.id); try { const response = await invokeAttendanceSync(supabase, job.sync_type === 'directory' ? { action: 'refresh-directory' } : { action: 'retry-job', jobId: job.id }); setFeedback({ title: '重试已完成', message: response?.message ?? '同步任务已重试。', tone: response?.status === 'partial' ? 'warning' : 'success' }); await load(); } catch (error) { setFeedback({ title: '重试未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'warning' }); } finally { setBusy(''); } };
  const labels: Record<AttendanceSyncJob['status'], string> = { queued: '等待中', running: '同步中', succeeded: '成功', partial: '部分成功', failed: '失败' };
  return <>{status === 'loading' ? <LoadingState label="正在加载同步日志" /> : null}{status === 'error' ? <ErrorState message="暂时无法加载同步日志。" onRetry={() => void load()} /> : null}{status === 'ready' && !jobs.length ? <EmptyState title="暂无同步日志" /> : null}{status === 'ready' ? <section className="space-y-2">{jobs.map((job) => <SectionCard className="p-3.5" key={job.id}><div className="flex items-start justify-between gap-3"><div><b>{job.sync_type === 'directory' ? '钉钉通讯录同步' : '考勤数据同步'}</b><p className="mt-0.5 text-xs text-slate-500">{new Date(job.created_at).toLocaleString('zh-CN')} · {job.trigger_type === 'scheduled' ? '自动' : job.trigger_type === 'retry' ? '重试' : '手动'}</p></div><StatusBadge tone={job.status === 'succeeded' ? 'success' : job.status === 'failed' ? 'danger' : job.status === 'partial' ? 'warning' : 'info'}>{labels[job.status]}</StatusBadge></div><div className="mt-3 grid grid-cols-4 gap-1 text-center"><MiniMetric label="成功" value={job.success_count} /><MiniMetric label="失败" value={job.failure_count} /><MiniMetric label="新增" value={job.inserted_count} /><MiniMetric label="更新" value={job.updated_count} /></div>{job.error_summary ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"><AlertTriangle className="mr-1 inline h-4 w-4" />{job.error_summary}</p> : null}{job.failures.length ? <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer font-semibold text-red-700">查看 {job.failures.length} 条失败详情</summary>{job.failures.map((failure) => <p className="mt-1 rounded bg-slate-50 p-2" key={failure.id}>{failure.error_message}</p>)}</details> : null}{['failed', 'partial'].includes(job.status) ? <button className="ui-button-secondary mt-3 w-full" disabled={busy === job.id} onClick={() => void retry(job)} type="button"><RefreshCw className={`h-4 w-4 ${busy === job.id ? 'animate-spin' : ''}`} />重试此任务</button> : null}</SectionCard>)}</section> : null}<ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone} /></>;
}

function MiniMetric({ compact = false, label, value }: { compact?: boolean; label: string; value: number | string }) { return <div className="flex min-h-14 min-w-0 flex-col items-center justify-center rounded-lg bg-slate-50 px-1 py-2 text-center"><b className={`block w-full whitespace-nowrap text-center leading-4 tabular-nums text-slate-900 ${compact ? 'text-[11px]' : 'text-sm'}`}>{value}</b><span className="mt-0.5 block w-full whitespace-nowrap text-center text-[10px] leading-4 text-slate-500">{label}</span></div>; }
