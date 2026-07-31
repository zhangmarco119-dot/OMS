import { Banknote, Camera, Clock3, ClipboardPen, FileText, RefreshCw, Search, Settings2, ShieldCheck, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ActionFeedbackDialog, type ActionFeedbackTone } from '../components/feedback/ActionFeedbackDialog';
import { MonthPicker } from '../components/forms/MonthPicker';
import { PageShell } from '../components/layout/PageShell';
import { ConfirmDialog } from '../components/ui/Actions';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { PayrollEstimateView } from '../features/payroll/PayrollEstimateView';
import { AdminOvertimeBatchImport } from '../features/payroll/AdminOvertimeBatchImport';
import { PayrollStatementView } from '../features/payroll/PayrollStatementView';
import { payrollMonthEndDate } from '../features/payroll/monthSelection';
import { formatMoney, todayInChina, type AdminPayrollSummary } from '../features/payroll/model';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import {
  addPayrollPenalty, adminRecordOvertime, configurePosSalesIntegration, invokePospalMonthlySalesSync, invokePospalSalesSync, loadAdminPayrollEstimates,
  generatePayrollPayslips, loadAdminPayrollPayslips, loadPayrollAdminSetup, loadPayrollIndividualTaxOverride, loadPayrollMonthlyPerformance, loadPayrollPayslipScheduleSettings, loadPayrollProfiles, loadPayrollVisibilitySettings, loadPosSalesSetup, revokePayrollPenalty, reviewOvertimeRequest, saveOvertimeRate, sendPayrollPayslip, sendPayrollPayslips, updatePayrollPayslip, withdrawPayrollPayslip, withdrawPayrollPayslips,
  savePayrollEmployeeRule, savePayrollPerformanceRule, savePayrollRevenueInput, uploadPayrollEvidence,
  savePayrollIndividualTaxOverride, savePayrollMonthlyPerformance, savePayrollPayslipScheduleSettings, savePayrollVisibilitySettings,
  type PayrollEmployeeRule, type PayrollMonthlyStoreSetting, type PayrollPerformanceRule, type PosSalesIntegration, type PosSalesSyncJob,
} from '../services/payroll.service';
import { recordSystemActivity } from '../services/operation-logs.service';

type Tab = 'overview' | 'payslips' | 'employees' | 'performance' | 'revenue' | 'penalties' | 'overtime' | 'visibility';
type Feedback = { title: string; message: string; tone: ActionFeedbackTone };
type Setup = Awaited<ReturnType<typeof loadPayrollAdminSetup>>;
type MonthlyPerformanceForm = { grade: 'A' | 'B' | 'C' | 'D'; mode: 'automatic' | 'score' | 'grade'; score: string; storeId: string };
const tabs: { key: Tab; label: string }[] = [
  { key: 'overview', label: '实时工资' }, { key: 'payslips', label: '工资单' }, { key: 'employees', label: '员工参数' },
  { key: 'performance', label: '绩效规则' }, { key: 'revenue', label: '营业收入' },
  { key: 'penalties', label: '处罚' }, { key: 'overtime', label: '工时计薪' }, { key: 'visibility', label: '查看期限' },
];
const monthStart = (date = todayInChina()) => `${date.slice(0, 7)}-01`;
const penaltyDefaults = { reminder: 0, warning: 3, formal_warning: 5, serious: 10 } as const;
const payrollRoleLabel = { staff: '员工', manager: '店长', admin: '管理员' } as const;
const payrollProfileLabel = (profile: { employment_type: 'full_time' | 'part_time'; role: keyof typeof payrollRoleLabel }) => profile.employment_type === 'part_time' ? '兼职员工' : payrollRoleLabel[profile.role];

export function AdminPayrollPage() {
  const [params, setParams] = useSearchParams();
  const tab = (tabs.some((item) => item.key === params.get('tab')) ? params.get('tab') : 'overview') as Tab;
  const changeTab = (nextTab: Tab) => { const next = new URLSearchParams(params); next.set('tab', nextTab); next.delete('employee'); next.delete('profile'); setParams(next); };
  const employeeDetailOpen = tab === 'overview' && params.has('employee');
  const closeEmployeeDetail = () => { const next = new URLSearchParams(params); next.delete('employee'); setParams(next, { replace: true }); };
  return <PageShell eyebrow="门店运营系统 · 管理员" title="实时薪资" backTo="/app/workbench" contentGapClassName="gap-3" onBack={employeeDetailOpen ? closeEmployeeDetail : undefined}>
    <nav className="ui-card grid grid-cols-4 gap-1 p-1.5 sm:grid-cols-8" aria-label="实时薪资功能">{tabs.map((item) => <button className={`min-h-10 rounded-lg px-1 text-[11px] font-bold ${tab === item.key ? 'bg-brand-700 text-white' : 'text-slate-600'}`} key={item.key} onClick={() => changeTab(item.key)} type="button">{item.label}</button>)}</nav>
    {tab === 'overview' ? <PayrollOverview /> : null}
    {tab === 'payslips' ? <PayrollPayslipManager /> : null}
    {tab === 'employees' ? <EmployeeRules /> : null}
    {tab === 'performance' ? <PerformanceRules /> : null}
    {tab === 'revenue' ? <RevenueManager /> : null}
    {tab === 'penalties' ? <PenaltyManager /> : null}
    {tab === 'overtime' ? <OvertimeManager /> : null}
    {tab === 'visibility' ? <PayrollVisibilityManager /> : null}
  </PageShell>;
}

function PayrollVisibilityManager() {
  const [historyMonths, setHistoryMonths] = useState('3');
  const [untilDay, setUntilDay] = useState('31');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  useEffect(() => {
    if (!supabase) return;
    void loadPayrollVisibilitySettings(supabase).then((value) => { setHistoryMonths(String(value.historyMonths)); setUntilDay(String(value.historyAvailableUntilDay)); }).catch((error) => setFeedback({ title: '加载失败', message: error instanceof Error ? error.message : '暂时无法加载设置。', tone: 'danger' }));
  }, []);
  const save = async () => {
    if (!supabase) return;
    const months = Number(historyMonths); const day = Number(untilDay);
    if (!Number.isInteger(months) || months < 0 || months > 24 || !Number.isInteger(day) || day < 1 || day > 31) { setFeedback({ title: '请检查设置', message: '历史月份应为 0–24，开放截止日应为 1–31。', tone: 'warning' }); return; }
    setBusy(true);
    try { await savePayrollVisibilitySettings(supabase, { historyMonths: months, historyAvailableUntilDay: day }); setFeedback({ title: '设置已保存', message: months ? `员工每月 ${day} 日前可查看前 ${months} 个月的预估工资和明细。` : '员工历史工资查看已关闭。', tone: 'success' }); }
    catch (error) { setFeedback({ title: '保存失败', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' }); }
    finally { setBusy(false); }
  };
  return <><SectionCard><SectionHeader icon={Settings2} title="员工历史工资查看期限" description="当前月份始终可查看；历史月份只在设定期限内开放。" /><div className="mt-4 grid grid-cols-2 gap-2"><label className="text-sm font-semibold">可查看前几个月<input className="ui-input mt-1" max="24" min="0" onChange={(event) => setHistoryMonths(event.target.value)} type="number" value={historyMonths} /></label><label className="text-sm font-semibold">每月开放至几日<input className="ui-input mt-1" max="31" min="1" onChange={(event) => setUntilDay(event.target.value)} type="number" value={untilDay} /></label></div><p className="mt-3 text-xs leading-5 text-slate-500">填写 0 个月可关闭历史工资查看。例如“3 个月、10 日”表示员工每月 10 日前可以查看前 3 个月的预估工资及明细。</p><button className="ui-button-primary mt-3 w-full" disabled={busy} onClick={() => void save()} type="button">保存查看期限</button></SectionCard><ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone} /></>;
}

function PayrollPayslipManager() {
  type Payslip = Awaited<ReturnType<typeof loadAdminPayrollPayslips>>[number];
  type Action = { item: Payslip; type: 'send' | 'withdraw' };
  const [month, setMonth] = useRememberedPageState('payslip-month', todayInChina().slice(0, 7));
  const [scope, setScope] = useRememberedPageState<'all' | 'single'>('payslip-scope', 'all');
  const [profileId, setProfileId] = useRememberedPageState('payslip-profile', '');
  const [profiles, setProfiles] = useState<Awaited<ReturnType<typeof loadPayrollProfiles>>>([]);
  const [items, setItems] = useState<Payslip[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [viewing, setViewing] = useState<Payslip | null>(null);
  const [editing, setEditing] = useState<Payslip | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [action, setAction] = useState<Action | null>(null);
  const [bulkAction, setBulkAction] = useState<'send' | 'withdraw' | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [schedule, setSchedule] = useState({ dayOfMonth: 1, enabled: false, frequencyMonths: 1, lastIssuedMonth: null as string | null, lastRunAt: null as string | null, sendTime: '09:00' });
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    setStatus('loading');
    try {
      const [nextProfiles, nextItems] = await Promise.all([loadPayrollProfiles(supabase), loadAdminPayrollPayslips(supabase, month)]);
      setProfiles(nextProfiles); setProfileId((value) => value || nextProfiles[0]?.id || ''); setItems(nextItems); setStatus('ready');
      setViewing((current) => current ? nextItems.find((item) => item.id === current.id) ?? null : null);
    } catch { setStatus('error'); }
  }, [month, setProfileId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!supabase || !viewing) return;
    void recordSystemActivity(supabase, {
      module: 'payroll',
      period: viewing.payroll_month.slice(0, 7),
      targetProfileId: viewing.profile_id,
      view: 'payslip_detail',
    }).catch(() => undefined);
  }, [viewing]);
  useEffect(() => {
    if (!supabase) return;
    void loadPayrollPayslipScheduleSettings(supabase)
      .then(setSchedule)
      .catch((error) => setFeedback({ title: '自动推送设置加载失败', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' }));
  }, []);
  const saveSchedule = async () => {
    if (!supabase) return;
    if (!Number.isInteger(schedule.frequencyMonths) || schedule.frequencyMonths < 1 || schedule.frequencyMonths > 12 || !Number.isInteger(schedule.dayOfMonth) || schedule.dayOfMonth < 1 || schedule.dayOfMonth > 28 || !schedule.sendTime) {
      setFeedback({ title: '请检查自动推送设置', message: '周期应为 1 到 12 个月，推送日期应为每月 1 到 28 日，并请选择推送时间。', tone: 'warning' });
      return;
    }
    setScheduleBusy(true);
    try {
      const saved = await savePayrollPayslipScheduleSettings(supabase, schedule);
      setSchedule(saved);
      setFeedback({ title: '自动推送设置已保存', message: saved.enabled ? `系统将在每 ${saved.frequencyMonths} 个月的 ${saved.dayOfMonth} 日 ${saved.sendTime} 自动推送上一工资周期的工资单。` : '工资单自动推送已关闭，工资单仅由管理员手动生成并发送。', tone: 'success' });
    } catch (error) {
      setFeedback({ title: '自动推送设置保存失败', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    } finally { setScheduleBusy(false); }
  };
  const generate = async () => {
    if (!supabase || (scope === 'single' && !profileId)) return;
    setGenerateOpen(false); setBusy(true);
    try {
      const result = await generatePayrollPayslips(supabase, month, scope === 'single' ? [profileId] : undefined);
      const parts = [`新生成 ${result.generatedCount} 份`];
      if (result.refreshedCount) parts.push(`重新生成草稿 ${result.refreshedCount} 份`);
      if (result.skippedSentCount) parts.push(`已发送并跳过 ${result.skippedSentCount} 份`);
      setFeedback({ title: '工资单草稿已生成', message: `${parts.join('，')}。请逐份预览，确认无误后再发送。`, tone: 'success' });
      await load();
    } catch (error) { setFeedback({ title: '工资单生成失败', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' }); }
    finally { setBusy(false); }
  };
  const beginEdit = (item: Payslip) => {
    setEditing(item); setViewing(null);
    setEditForm({
      accruedBaseSalary: String(item.estimate.accruedBaseSalary), accruedHousingAllowance: String(item.estimate.accruedHousingAllowance),
      accruedPerformance: String(item.estimate.accruedPerformance ?? 0), accruedFullAttendanceBonus: String(item.estimate.accruedFullAttendanceBonus),
      accruedExtraAttendanceBonus: String(item.estimate.accruedExtraAttendanceBonus), accruedServiceAward: String(item.estimate.accruedServiceAward),
      accruedExtraReward: String(item.estimate.accruedExtraReward), accruedCommission: String(item.estimate.accruedCommission ?? 0),
      accruedOvertime: String(item.estimate.accruedOvertime), fineTotal: String(item.estimate.fineTotal), individualIncomeTax: String(item.estimate.individualIncomeTax), adminNote: item.admin_note,
    });
  };
  const saveEdit = async () => {
    if (!supabase || !editing) return;
    const numericKeys = ['accruedBaseSalary','accruedHousingAllowance','accruedPerformance','accruedFullAttendanceBonus','accruedExtraAttendanceBonus','accruedServiceAward','accruedExtraReward','accruedCommission','accruedOvertime','fineTotal','individualIncomeTax'] as const;
    if (numericKeys.some((key) => !Number.isFinite(Number(editForm[key])) || Number(editForm[key]) < 0)) { setFeedback({ title: '请检查工资单金额', message: '所有金额必须是大于或等于 0 的数字。', tone: 'warning' }); return; }
    setBusy(true);
    try {
      await updatePayrollPayslip(supabase, editing.id, { ...Object.fromEntries(numericKeys.map((key) => [key, Number(editForm[key])])), adminNote: editForm.adminNote ?? '' } as Parameters<typeof updatePayrollPayslip>[2]);
      const wasConfirmed = editing.status === 'confirmed'; setEditing(null);
      setFeedback({ title: '工资单已修改', message: wasConfirmed ? '员工原确认状态已取消，最新工资单已重新进入待确认。' : editing.status === 'issued' ? '员工会看到更新后的工资单内容。' : '草稿已保存，请预览无误后发送。', tone: 'success' });
      await load();
    } catch (error) { setFeedback({ title: '工资单修改失败', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' }); }
    finally { setBusy(false); }
  };
  const executeAction = async () => {
    if (!supabase || !action) return;
    const current = action; setAction(null); setBusy(true);
    try {
      if (current.type === 'send') await sendPayrollPayslip(supabase,current.item.id); else await withdrawPayrollPayslip(supabase,current.item.id);
      setViewing(null);
      setFeedback({ title: current.type === 'send' ? '工资单已发送' : '工资单已撤回', message: current.type === 'send' ? '员工通知和确认待办已经生成。' : '员工端工资单、通知和确认待办已同步移除。', tone: 'success' });
      await load();
    } catch (error) { setFeedback({ title: '操作未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' }); }
    finally { setBusy(false); }
  };
  const draftIds = items.filter((item) => item.status === 'draft').map((item) => item.id);
  const sentIds = items.filter((item) => item.status === 'issued' || item.status === 'confirmed').map((item) => item.id);
  const executeBulkAction = async () => {
    if (!supabase || !bulkAction) return;
    const current = bulkAction;
    const ids = current === 'send' ? draftIds : sentIds;
    setBulkAction(null);
    if (!ids.length) {
      setFeedback({ title: current === 'send' ? '没有待发送工资单' : '没有可撤回工资单', message: '当前月份没有符合条件的工资单。', tone: 'warning' });
      return;
    }
    setBusy(true);
    try {
      const result = current === 'send'
        ? await sendPayrollPayslips(supabase, ids)
        : await withdrawPayrollPayslips(supabase, ids);
      setFeedback({
        title: current === 'send' ? '工资单已全部发送' : '工资单已全部撤回',
        message: current === 'send'
          ? `已发送 ${result.processedCount} 份工资单，员工通知和确认待办已经生成。`
          : `已撤回 ${result.processedCount} 份工资单，员工端通知和确认待办已同步移除。`,
        tone: 'success',
      });
      await load();
    } catch (error) {
      setFeedback({ title: '批量操作未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  const statusLabel = (item: Payslip) => item.status === 'draft' ? '待发送' : item.status === 'issued' ? '待员工确认' : item.status === 'confirmed' ? '员工已确认' : '已撤回';
  const statusTone = (item: Payslip) => item.status === 'confirmed' ? 'success' : item.status === 'withdrawn' ? 'danger' : item.status === 'draft' ? 'info' : 'warning';
  if (viewing) return <><button className="ui-button-secondary" onClick={() => setViewing(null)} type="button">返回工资单列表</button><div className="flex items-center justify-between gap-2"><StatusBadge tone={statusTone(viewing)}>{statusLabel(viewing)}</StatusBadge><span className="text-xs text-slate-500">第 {viewing.revision} 版</span></div><PayrollStatementView adminNote={viewing.admin_note} estimate={viewing.estimate} payrollMonth={viewing.payroll_month} /><div className="grid grid-cols-2 gap-2"><button className="ui-button-secondary" disabled={viewing.status === 'withdrawn'} onClick={() => beginEdit(viewing)} type="button">修改</button>{viewing.status === 'draft' ? <button className="ui-button-primary" onClick={() => setAction({ item:viewing,type:'send' })} type="button">发送工资单</button> : <button className="ui-button-danger" disabled={viewing.status === 'withdrawn'} onClick={() => setAction({ item:viewing,type:'withdraw' })} type="button">撤回工资单</button>}</div><ConfirmDialog confirmLabel={action?.type === 'send' ? '确认发送' : '确认撤回'} danger={action?.type === 'withdraw'} onCancel={() => setAction(null)} onConfirm={() => void executeAction()} open={Boolean(action)} title={action?.type === 'send' ? '发送工资单' : '撤回工资单'}><p>{action?.type === 'send' ? '发送后，员工会收到工资单通知和确认待办。' : '撤回后，员工将无法再查看该工资单，对应通知和待办也会移除。'}</p></ConfirmDialog><ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone} /></>;
  if (editing) return <><button className="ui-button-secondary" onClick={() => setEditing(null)} type="button">取消修改</button><SectionCard><SectionHeader title="修改工资单" description={editing.status === 'confirmed' ? '此工资单已被员工确认。保存修改后，系统会要求员工重新确认。' : '修改金额后，实发合计会自动重新计算。'} /><div className="mt-3 grid grid-cols-2 gap-2">{([['accruedBaseSalary','基本工资'],['accruedHousingAllowance','房补'],['accruedPerformance','绩效'],['accruedFullAttendanceBonus','全勤奖'],['accruedExtraAttendanceBonus','超勤奖'],['accruedServiceAward','工龄奖'],['accruedExtraReward','额外奖励'],['accruedCommission','提成'],['accruedOvertime','加班'],['fineTotal','罚款'],['individualIncomeTax','个税扣除']] as const).map(([key,label]) => <label className="text-sm font-semibold" key={key}>{label}<input className="ui-input mt-1" min="0" onChange={(event) => setEditForm((value) => ({ ...value,[key]:event.target.value }))} step="0.01" type="number" value={editForm[key] ?? ''} /></label>)}</div><label className="mt-3 block text-sm font-semibold">工资单备注（选填）<textarea className="ui-input mt-1 min-h-20 py-2" onChange={(event) => setEditForm((value) => ({ ...value,adminNote:event.target.value }))} value={editForm.adminNote ?? ''} /></label><button className="ui-button-primary mt-3 w-full" disabled={busy} onClick={() => void saveEdit()} type="button">保存工资单修改</button></SectionCard><ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone} /></>;
  return <>
    <SectionCard><SectionHeader icon={Settings2} title="工资单自动推送" description="默认关闭；开关、推送周期、日期和时间均由管理员设置。" /><label className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm font-semibold"><span>启用自动推送</span><input checked={schedule.enabled} className="h-5 w-5 accent-emerald-700" onChange={(event) => setSchedule((value) => ({ ...value, enabled: event.target.checked }))} type="checkbox" /></label><div className="mt-3 grid gap-2 sm:grid-cols-3"><label className="text-sm font-semibold">推送周期<select className="ui-input mt-1" disabled={!schedule.enabled} onChange={(event) => setSchedule((value) => ({ ...value, frequencyMonths: Number(event.target.value) }))} value={schedule.frequencyMonths}>{[1,2,3,6,12].map((value) => <option key={value} value={value}>每 {value} 个月</option>)}</select></label><label className="text-sm font-semibold">每月日期<input className="ui-input mt-1" disabled={!schedule.enabled} max="28" min="1" onChange={(event) => setSchedule((value) => ({ ...value, dayOfMonth: Number(event.target.value) }))} type="number" value={schedule.dayOfMonth} /></label><label className="text-sm font-semibold">推送时间<input className="ui-input mt-1" disabled={!schedule.enabled} onChange={(event) => setSchedule((value) => ({ ...value, sendTime: event.target.value }))} type="time" value={schedule.sendTime} /></label></div>{schedule.lastIssuedMonth ? <p className="mt-2 text-xs text-slate-500">最近自动推送工资月份：{schedule.lastIssuedMonth.slice(0, 7)}</p> : null}<button className="ui-button-primary mt-3 w-full" disabled={scheduleBusy} onClick={() => void saveSchedule()} type="button">{scheduleBusy ? '正在保存' : '保存自动推送设置'}</button></SectionCard>
    <SectionCard><SectionHeader icon={FileText} title="生成工资单" description="先生成草稿并预览，确认无误后再逐份发送。" />
      <div className="mt-3 grid grid-cols-2 gap-2"><MonthPicker label="工资月份" maxMonth={todayInChina().slice(0, 7)} onChange={setMonth} value={month} /><label className="text-sm font-semibold">生成范围<select className="ui-input mt-1" onChange={(event) => setScope(event.target.value as 'all' | 'single')} value={scope}><option value="all">全部员工和店长</option><option value="single">指定一人</option></select></label></div>
      {scope === 'single' ? <label className="mt-3 block text-sm font-semibold">选择员工<select className="ui-input mt-1" onChange={(event) => setProfileId(event.target.value)} value={profileId}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name} · {payrollProfileLabel(profile)}</option>)}</select></label> : null}
      <button className="ui-button-primary mt-3 w-full" disabled={busy || !profiles.length} onClick={() => setGenerateOpen(true)} type="button">{busy ? '正在处理' : `生成 ${month.slice(0,4)}年${Number(month.slice(5,7))}月工资单`}</button>
    </SectionCard>
    <SectionCard><SectionHeader title={`${month.slice(0,4)}年${Number(month.slice(5,7))}月工资单`} description={`共 ${items.length} 份 · 待发送 ${items.filter((item) => item.status==='draft').length} · 待确认 ${items.filter((item) => item.status==='issued').length} · 已确认 ${items.filter((item) => item.status==='confirmed').length}`} />
      {status === 'ready' && items.length ? <div className="mt-3 grid grid-cols-2 gap-2"><button className="ui-button-primary min-h-10 px-2 text-xs" disabled={busy || !draftIds.length} onClick={() => setBulkAction('send')} type="button">一键发送全部{draftIds.length ? `（${draftIds.length}）` : ''}</button><button className="ui-button-danger min-h-10 px-2 text-xs" disabled={busy || !sentIds.length} onClick={() => setBulkAction('withdraw')} type="button">一键撤回全部{sentIds.length ? `（${sentIds.length}）` : ''}</button></div> : null}
      {status === 'loading' ? <LoadingState label="正在加载工资单" /> : null}{status === 'error' ? <ErrorState message="暂时无法加载工资单。" onRetry={() => void load()} /> : null}{status === 'ready' && !items.length ? <EmptyState title="该月份尚未生成工资单" /> : null}
      {status === 'ready' ? <div className="mt-3 space-y-2">{items.map((item) => { const profile=profiles.find((entry)=>entry.id===item.profile_id); return <article className="rounded-lg border border-slate-200 bg-white p-3" key={item.id}><button className="w-full text-left" onClick={() => setViewing(item)} type="button"><div className="flex items-start justify-between gap-3"><div><b>{profile?.display_name??item.estimate.displayName}</b><p className="mt-1 text-xs text-slate-500">实发 {formatMoney(item.estimate.estimatedPayable??item.estimate.knownEstimatedPayable)} · 第 {item.revision} 版</p></div><StatusBadge tone={statusTone(item)}>{statusLabel(item)}</StatusBadge></div></button><div className="mt-3 grid grid-cols-3 gap-2"><button className="ui-button-secondary min-h-9 px-2 text-xs" onClick={() => setViewing(item)} type="button">查看</button><button className="ui-button-secondary min-h-9 px-2 text-xs" disabled={item.status==='withdrawn'} onClick={() => beginEdit(item)} type="button">修改</button>{item.status==='draft' ? <button className="ui-button-primary min-h-9 px-2 text-xs" onClick={() => setAction({ item,type:'send' })} type="button">发送</button> : <button className="ui-button-danger min-h-9 px-2 text-xs" disabled={item.status==='withdrawn'} onClick={() => setAction({ item,type:'withdraw' })} type="button">撤回</button>}</div></article>; })}</div> : null}
    </SectionCard>
    <ConfirmDialog confirmLabel="确认生成" onCancel={() => setGenerateOpen(false)} onConfirm={() => void generate()} open={generateOpen} title="生成工资单草稿"><p>系统只会生成工资单草稿，不会立即通知员工。请生成后逐份查看，确认无误再发送。</p></ConfirmDialog>
    <ConfirmDialog confirmLabel={action?.type==='send'?'确认发送':'确认撤回'} danger={action?.type==='withdraw'} onCancel={() => setAction(null)} onConfirm={() => void executeAction()} open={Boolean(action)} title={action?.type==='send'?'发送工资单':'撤回工资单'}><p>{action?.type==='send'?'发送后员工会收到通知和确认待办。':'撤回后员工端工资单、通知和待办会同步移除。'}</p></ConfirmDialog>
    <ConfirmDialog confirmLabel={bulkAction === 'send' ? '确认全部发送' : '确认全部撤回'} danger={bulkAction === 'withdraw'} onCancel={() => setBulkAction(null)} onConfirm={() => void executeBulkAction()} open={Boolean(bulkAction)} title={bulkAction === 'send' ? '一键发送全部工资单' : '一键撤回全部工资单'}><p>{bulkAction === 'send' ? `将发送当前月份全部 ${draftIds.length} 份待发送工资单，并为员工生成通知和确认待办。` : `将撤回当前月份全部 ${sentIds.length} 份已发送或已确认工资单，对应通知和待办会同步移除。`}</p></ConfirmDialog>
    <ActionFeedbackDialog message={feedback?.message??''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title??''} tone={feedback?.tone} />
  </>;
}

function PayrollOverview() {
  const auth = useAuth(); const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const asOf = params.get('date') || todayInChina(); const storeId = params.get('store') || ''; const search = params.get('q') || ''; const employeeId = params.get('employee') || '';
  const selectedMonth = asOf.slice(0, 7);
  const [result, setResult] = useState<AdminPayrollSummary | null>(null); const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const update = (key: string, value: string, replace = true) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace }); };
  const load = useCallback(async () => { if (!supabase) return; setStatus('loading'); try { setResult(await loadAdminPayrollEstimates(supabase, { asOf, storeId, search })); setStatus('ready'); void recordSystemActivity(supabase, { module: 'payroll', view: 'estimate_summary', period: selectedMonth, storeId: storeId || undefined, context: { scope: storeId ? 'single_store' : 'all_authorized_stores' } }).catch(() => undefined); } catch { setStatus('error'); } }, [asOf, search, selectedMonth, storeId]);
  useEffect(() => { const id = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(id); }, [load]);
  const selected = result?.items.find((item) => item.profileId === employeeId);
  useEffect(() => { if (!supabase || !selected) return; void recordSystemActivity(supabase, { module: 'payroll', view: 'estimate_detail', period: selectedMonth, storeId: storeId || undefined, targetProfileId: selected.profileId, context: { scope: storeId ? 'single_store' : 'all_authorized_stores' } }).catch(() => undefined); }, [selected, selectedMonth, storeId]);
  const resolveIssue = (issue: string) => {
    if (issue.includes('任务数据')) { void navigate('/app/admin/tasks'); return; }
    const next = new URLSearchParams(params);
    next.delete('employee');
    if (issue.includes('营业收入')) next.set('tab', 'revenue');
    else { next.set('tab', 'employees'); next.set('profile', employeeId); }
    setParams(next);
  };
  if (employeeId && selected) return <><button className="ui-button-secondary" onClick={() => update('employee', '', true)} type="button">返回工资列表</button><PayrollEstimateView estimate={selected} onResolveIssue={resolveIssue} /></>;
  return <>
    <SectionCard className="p-3"><div className="grid grid-cols-2 gap-2"><MonthPicker label="查看月份" maxMonth={todayInChina().slice(0, 7)} onChange={(month) => update('date', payrollMonthEndDate(month, todayInChina()))} value={selectedMonth} /><label className="text-sm font-semibold text-slate-700">门店范围<select className="ui-input mt-1" onChange={(event) => update('store', event.target.value)} value={storeId}><option value="">全部授权门店</option>{auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label></div><p className="mt-2 text-xs leading-5 text-slate-500">管理员可查看任意历史月份和本月；历史月份按该月最后一天汇总，本月按今天汇总。</p><label className="relative mt-2 block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input className="ui-input pl-9" onChange={(event) => update('q', event.target.value)} placeholder="搜索员工姓名或账号" value={search} /></label></SectionCard>
    {result ? <section className="grid grid-cols-2 gap-2"><SummaryMetric label="预估合计（已知项）" value={formatMoney(result.knownEstimatedTotal)} /><SummaryMetric label="数据完整员工" value={`${result.completeCount}/${result.employeeCount}`} /></section> : null}
    {status === 'loading' ? <LoadingState label="正在计算实时预估工资" /> : null}{status === 'error' ? <ErrorState message="暂时无法加载实时工资。" onRetry={() => void load()} /> : null}{status === 'ready' && !result?.items.length ? <EmptyState title="暂无符合条件的员工" /> : null}
    {status === 'ready' ? <section className="space-y-2">{result?.items.map((item) => <button className="ui-interactive ui-card w-full p-3.5 text-left" key={item.profileId} onClick={() => update('employee', item.profileId, false)} type="button"><div className="flex items-start justify-between gap-3"><div><b>{item.displayName}{item.employmentType === 'part_time' ? ' · 兼职' : ''}</b><p className="mt-0.5 text-xs text-slate-500">{item.employmentType === 'part_time' ? `本月已审批 ${item.partTimeHours} 小时` : `出勤 ${item.attendanceDays} 天 · 加班 ${item.overtimeHours} 小时 · 迟到 ${item.lateCount} 次`}</p></div><StatusBadge tone={item.dataComplete ? 'success' : 'warning'}>{item.dataComplete ? '数据完整' : '待完善'}</StatusBadge></div>{item.employmentType === 'part_time' ? <div className="mt-3 grid grid-cols-2 gap-2 text-center"><Mini label="兼职工时" value={`${item.partTimeHours} 小时`} /><Mini label="预估可发" value={formatMoney(item.estimatedNetPayable ?? item.knownEstimatedNetPayable)} /></div> : <div className="mt-3 grid grid-cols-3 gap-2 text-center"><Mini label="基本工资" value={formatMoney(item.accruedBaseSalary)} /><Mini label="预计个税" value={formatMoney(item.estimatedIndividualIncomeTax)} /><Mini label="预估可发" value={formatMoney(item.dataComplete ? item.estimatedNetPayable : item.knownEstimatedNetPayable)} /></div>}</button>)}</section> : null}
  </>;
}

function EmployeeRules() {
  const auth = useAuth(); const [setup, setSetup] = useState<Setup | null>(null); const [profileId, setProfileId] = useRememberedPageState('employee-rule-profile', '');
  const [params] = useSearchParams(); const requestedProfileId = params.get('profile') || '';
  const [form, setForm] = useState(ruleToForm(undefined, [], [])); const [feedback, setFeedback] = useState<Feedback | null>(null); const [busy, setBusy] = useState(false);
  const [performanceMonth, setPerformanceMonth] = useRememberedPageState('employee-performance-month', todayInChina().slice(0, 7));
  const [monthlyPerformance, setMonthlyPerformance] = useState<MonthlyPerformanceForm[]>([]);
  const [finalPerformanceMode, setFinalPerformanceMode] = useState<'automatic' | 'override'>('automatic');
  const [finalPerformanceAmount, setFinalPerformanceAmount] = useState('');
  const [performanceBusy, setPerformanceBusy] = useState(false);
  const [taxMonth, setTaxMonth] = useRememberedPageState('employee-tax-month', todayInChina().slice(0, 7));
  const [taxMode, setTaxMode] = useState<'automatic' | 'override'>('automatic');
  const [taxAmount, setTaxAmount] = useState('');
  const [taxBusy, setTaxBusy] = useState(false);
  const load = useCallback(async () => { if (!supabase) return; const data = await loadPayrollAdminSetup(supabase, monthStart()); setSetup(data); setProfileId((value) => value || data.profiles.find((profile) => profile.id === requestedProfileId)?.id || data.profiles[0]?.id || ''); }, [requestedProfileId, setProfileId]);
  useEffect(() => { void load().catch((error) => setFeedback({ title: '加载失败', message: error instanceof Error ? error.message : '暂时无法加载。', tone: 'danger' })); }, [load]);
  useEffect(() => {
    if (!setup || !profileId) return;
    const rule = setup.rules.find((item) => item.profile_id === profileId);
    const assignedStoreIds = setup.profileStoreAccess.filter((item) => item.profile_id === profileId).map((item) => item.store_id);
    const configured = setup.performanceStores.filter((item) => item.rule_id === rule?.id);
    const allocation = configured.length
      ? configured.map((item) => ({ allocationPercent: String(Number(item.allocation_ratio) * 100), storeId: item.store_id }))
      : assignedStoreIds.map((storeId) => ({ allocationPercent: String(100 / Math.max(assignedStoreIds.length, 1)), storeId }));
    setForm(ruleToForm(rule, setup.commissionStores.filter((item) => item.rule_id === rule?.id).map((item) => item.store_id), allocation));
  }, [profileId, setup]);
  useEffect(() => {
    let active = true;
    if (!supabase || !profileId || !setup) return undefined;
    const storeIds = setup.profileStoreAccess.filter((item) => item.profile_id === profileId).map((item) => item.store_id);
    void loadPayrollMonthlyPerformance(supabase, profileId, performanceMonth)
      .then((result) => {
        if (!active) return;
        setMonthlyPerformance(storeIds.map((storeId) => {
          const saved = result.settings.find((item) => item.storeId === storeId);
          return { grade: saved?.grade ?? 'A', mode: saved?.mode ?? 'automatic', score: saved?.score == null ? '' : String(saved.score), storeId };
        }));
        setFinalPerformanceMode(result.finalAmount == null ? 'automatic' : 'override');
        setFinalPerformanceAmount(result.finalAmount == null ? '' : String(result.finalAmount));
      })
      .catch((error) => { if (active) setFeedback({ title: '绩效设置加载失败', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' }); });
    return () => { active = false; };
  }, [performanceMonth, profileId, setup]);
  useEffect(() => {
    let active = true;
    if (!supabase || !profileId) return undefined;
    void loadPayrollIndividualTaxOverride(supabase, profileId, taxMonth)
      .then((amount) => { if (!active) return; setTaxMode(amount == null ? 'automatic' : 'override'); setTaxAmount(amount == null ? '' : String(amount)); })
      .catch((error) => { if (active) setFeedback({ title: '预计个税设置加载失败', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' }); });
    return () => { active = false; };
  }, [profileId, taxMonth]);
  const save = async () => {
    if (!supabase || !profileId) return;
    if (!form.base) { setFeedback({ title: '请完善工资参数', message: '月基本工资不能为空。', tone: 'warning' }); return; }
    if (form.fullAttendanceBonusEnabled && (!form.fullAttendanceBonus || Number(form.fullAttendanceBonus) <= 0)) {
      setFeedback({ title: '请填写全勤奖金额', message: '启用全勤奖后，奖励金额必须大于 0。', tone: 'warning' });
      return;
    }
    if (form.serviceAwardEnabled && (!form.serviceAward || Number(form.serviceAward) <= 0)) {
      setFeedback({ title: '请填写工龄奖金额', message: '启用工龄奖后，月度金额必须大于 0。', tone: 'warning' });
      return;
    }
    const allocationTotal = form.performanceStores.reduce((sum, item) => sum + Number(item.allocationPercent || 0), 0);
    if (form.performanceEnabled && (form.performanceStores.length === 0 || Math.abs(allocationTotal - 100) > 0.001 || form.performanceStores.some((item) => Number(item.allocationPercent) <= 0))) {
      setFeedback({ title: '请检查门店绩效占比', message: '启用绩效后，每个关联门店的占比必须大于 0%，且合计必须等于 100%。', tone: 'warning' });
      return;
    }
    setBusy(true);
    try {
      await savePayrollEmployeeRule(supabase, profileId, {
        monthlyBaseSalary: Number(form.base), monthlyHousingAllowance: Number(form.housing || 0), fullPerformanceAmount: form.performance,
        commissionRate: form.commission ? Number(form.commission) / 100 : '', housingEnabled: form.housingEnabled,
        performanceEnabled: form.performanceEnabled, commissionEnabled: form.commissionEnabled,
        fullAttendanceBonusEnabled: form.fullAttendanceBonusEnabled,
        fullAttendanceBonusAmount: Number(form.fullAttendanceBonus || 0),
        serviceAwardEnabled: form.serviceAwardEnabled, serviceAwardAmount: Number(form.serviceAward || 100),
        extraRewardAmount: Number(form.extraReward || 0),
        regularizationDate: form.regularizationDate || '', confirmed: form.confirmed,
        effectiveFrom: form.effectiveFrom, changeReason: form.reason.trim(),
      }, form.storeIds, form.performanceStores.map((item) => ({ allocationRatio: Number(item.allocationPercent) / 100, storeId: item.storeId })));
      setFeedback({ title: '员工工资参数已保存', message: '新参数将按所选生效日期参与实时预估，历史规则已保留。', tone: 'success' });
      await load();
    } catch (error) {
      setFeedback({ title: '保存未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    } finally { setBusy(false); }
  };
  const saveMonthlyPerformance = async () => {
    if (!supabase || !profileId) return;
    const invalidScore = monthlyPerformance.some((item) => item.mode === 'score' && (!Number.isFinite(Number(item.score)) || Number(item.score) < 0 || Number(item.score) > 100));
    if (invalidScore) {
      setFeedback({ title: '请检查门店绩效分', message: '手动设置的绩效分必须是 0 到 100 之间的数字。', tone: 'warning' });
      return;
    }
    if (finalPerformanceMode === 'override' && monthlyPerformance.some((item) => item.mode === 'automatic')) {
      setFeedback({ title: '请先设置各门店绩效等级', message: '手动修改最终绩效奖金额时，每个关联门店都必须先手动设置绩效分或绩效等级。', tone: 'warning' });
      return;
    }
    const finalAmount = Number(finalPerformanceAmount);
    if (finalPerformanceMode === 'override' && (!Number.isFinite(finalAmount) || finalAmount < 0)) {
      setFeedback({ title: '请检查最终绩效奖', message: '手动设置的最终绩效奖金额必须大于或等于 0。', tone: 'warning' });
      return;
    }
    setPerformanceBusy(true);
    try {
      const settings: PayrollMonthlyStoreSetting[] = monthlyPerformance.map((item) => ({
        grade: item.mode === 'grade' ? item.grade : null, mode: item.mode,
        score: item.mode === 'score' ? Number(item.score) : null, storeId: item.storeId,
      }));
      await savePayrollMonthlyPerformance(supabase, profileId, performanceMonth, settings, finalPerformanceMode === 'override' ? finalAmount : null);
      setFeedback({ title: '本月门店绩效已保存', message: finalPerformanceMode === 'override' ? '各门店绩效等级和最终实际绩效奖金额已保存，仅影响所选月份。' : '各门店绩效设置已保存，最终金额将按门店占比和等级自动计算。', tone: 'success' });
    } catch (error) {
      setFeedback({ title: '绩效设置保存失败', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    } finally { setPerformanceBusy(false); }
  };
  const saveMonthlyTax = async () => {
    if (!supabase || !profileId) return;
    const amount = Number(taxAmount);
    if (taxMode === 'override' && (!Number.isFinite(amount) || amount < 0)) {
      setFeedback({ title: '请检查预计个税', message: '手动设置金额必须是大于或等于 0 的数字。', tone: 'warning' });
      return;
    }
    setTaxBusy(true);
    try {
      await savePayrollIndividualTaxOverride(supabase, profileId, taxMonth, taxMode === 'override' ? amount : null);
      setFeedback({ title: '预计个税设置已保存', message: taxMode === 'override' ? `${taxMonth.slice(0, 4)}年${Number(taxMonth.slice(5, 7))}月预计个税已手动设置为 ${formatMoney(amount)}。` : '该月已恢复按个人所得税累计预扣规则自动估算。', tone: 'success' });
    } catch (error) {
      setFeedback({ title: '预计个税设置保存失败', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    } finally { setTaxBusy(false); }
  };
  if (!setup) return <LoadingState label="正在加载员工工资参数" />;
  const selectedProfile = setup.profiles.find((profile) => profile.id === profileId);
  const monthlyTaxSettings = <SectionCard><SectionHeader icon={Banknote} title="按月设置预计个税" description="实时薪资默认按累计预扣规则估算；工资单中的“个税扣除”仍由管理员人工填写确认。" /><div className="mt-3 grid grid-cols-2 gap-2"><MonthPicker label="个税月份" onChange={setTaxMonth} value={taxMonth} /><label className="text-sm font-semibold">估算方式<select className="ui-input mt-1" onChange={(event) => setTaxMode(event.target.value as 'automatic' | 'override')} value={taxMode}><option value="automatic">自动估算</option><option value="override">手动设置本月预计个税</option></select></label></div>{taxMode === 'override' ? <div className="mt-3"><Field label="本月预计个税" value={taxAmount} onChange={setTaxAmount} /></div> : <p className="mt-3 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-900">自动估算按每月 5000 元基本减除费用和综合所得累计预扣税率计算；专项附加扣除等个人信息未纳入，结果仅供预估。</p>}<button className="ui-button-primary mt-3 w-full" disabled={taxBusy} onClick={() => void saveMonthlyTax()} type="button">{taxBusy ? '正在保存' : '保存预计个税设置'}</button></SectionCard>;
  if (selectedProfile?.employment_type === 'part_time') return <><SectionCard><SectionHeader icon={Settings2} title="兼职员工工资参数" description="兼职账号只按审批通过的兼职工时计薪。" /><label className="mt-3 block text-sm font-semibold">选择员工<select className="ui-input mt-1" onChange={(event) => setProfileId(event.target.value)} value={profileId}>{setup.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name} · {payrollProfileLabel(profile)}</option>)}</select></label><p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm leading-6 text-emerald-900">兼职薪资 = 审批通过的兼职工时 × 审批时锁定的兼职时薪。请在“工时与计薪”菜单设置时薪，店长审批通过后自动计入。</p></SectionCard>{monthlyTaxSettings}<FeedbackDialog feedback={feedback} close={() => setFeedback(null)} /></>;
  return <><SectionCard>
    <SectionHeader icon={Settings2} title="员工工资参数" description="调整后按生效日期切换，修改原因可不填写。" />
    <label className="mt-3 block text-sm font-semibold">选择员工<select className="ui-input mt-1" onChange={(event) => setProfileId(event.target.value)} value={profileId}>{setup.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name} · {payrollProfileLabel(profile)}</option>)}</select></label>
    <div className="mt-3 grid grid-cols-2 gap-2"><Field label="月基本工资（含社保补贴）" value={form.base} onChange={(base) => setForm((value) => ({ ...value, base }))} /><Field label="月房补" value={form.housing} onChange={(housing) => setForm((value) => ({ ...value, housing }))} /><Field label="满绩效金额" value={form.performance} onChange={(performance) => setForm((value) => ({ ...value, performance }))} /><Field label="提成比例（%）" value={form.commission} onChange={(commission) => setForm((value) => ({ ...value, commission }))} /><Field label="额外奖励" value={form.extraReward} onChange={(extraReward) => setForm((value) => ({ ...value, extraReward }))} /></div>
    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">超勤奖由系统自动计算：超过当月全勤标准后，每超勤 1 天奖励 300 元。额外奖励可在此预设，也可生成工资单后单独修改。</p>
    <div className="mt-3 grid grid-cols-2 gap-2">{([['housingEnabled', '启用房补'], ['performanceEnabled', '启用绩效'], ['commissionEnabled', '启用提成'], ['fullAttendanceBonusEnabled', '启用全勤奖'], ['serviceAwardEnabled', '启用工龄奖']] as const).map(([key, label]) => <label className="rounded-lg bg-slate-50 p-2 text-xs font-semibold" key={key}><input checked={form[key]} className="mr-1.5" onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.checked }))} type="checkbox" />{label}</label>)}</div>
    {form.fullAttendanceBonusEnabled ? <div className="mt-2 rounded-lg bg-emerald-50 px-3 pb-3"><Field label="全勤奖金额" value={form.fullAttendanceBonus} onChange={(fullAttendanceBonus) => setForm((value) => ({ ...value, fullAttendanceBonus }))} /><p className="mt-1 text-xs leading-5 text-emerald-800">达到当月满勤天数后独立产生全勤奖，不计入绩效金额。</p></div> : null}
    {form.serviceAwardEnabled ? <div className="mt-2 rounded-lg bg-blue-50 px-3 pb-3"><Field label="月度工龄奖" value={form.serviceAward} onChange={(serviceAward) => setForm((value) => ({ ...value, serviceAward }))} /><p className="mt-1 text-xs leading-5 text-blue-800">默认 100 元，按当月累计出勤天数折算。</p></div> : null}
    {form.commissionEnabled ? <div className="mt-3"><p className="text-sm font-semibold">提成门店</p><div className="mt-1 grid grid-cols-2 gap-2">{auth.availableStores.map((store) => <label className="rounded-lg border p-2 text-xs" key={store.id}><input checked={form.storeIds.includes(store.id)} className="mr-1.5" onChange={(event) => setForm((value) => ({ ...value, storeIds: event.target.checked ? [...value.storeIds, store.id] : value.storeIds.filter((id) => id !== store.id) }))} type="checkbox" />{store.short_name}</label>)}</div></div> : null}
    {form.performanceEnabled ? <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3"><p className="text-sm font-semibold text-emerald-950">各门店绩效占比</p><p className="mt-1 text-xs leading-5 text-emerald-800">满绩效金额会按下列占比分配，再分别乘以各门店当月绩效等级对应的发放比例。</p><div className="mt-2 grid grid-cols-2 gap-2">{form.performanceStores.map((item) => <Field key={item.storeId} label={`${auth.availableStores.find((store) => store.id === item.storeId)?.short_name ?? '门店'}占比（%）`} value={item.allocationPercent} onChange={(allocationPercent) => setForm((current) => ({ ...current, performanceStores: current.performanceStores.map((entry) => entry.storeId === item.storeId ? { ...entry, allocationPercent } : entry) }))} />)}</div><p className="mt-2 text-right text-xs font-semibold text-emerald-900">当前合计 {form.performanceStores.reduce((sum, item) => sum + Number(item.allocationPercent || 0), 0).toFixed(2)}%</p></div> : null}
    <label className="mt-3 block text-sm font-semibold">转正日期（选填）<input className="ui-input mt-1" onChange={(event) => setForm((value) => ({ ...value, regularizationDate: event.target.value }))} type="date" value={form.regularizationDate} /></label>
    <p className="mt-1 text-xs leading-5 text-slate-500">转正前不计绩效和提成；转正当月仅按转正后的实际出勤日期折算。</p>
    <label className="mt-3 block text-sm font-semibold">生效日期<input className="ui-input mt-1" onChange={(event) => setForm((value) => ({ ...value, effectiveFrom: event.target.value }))} type="date" value={form.effectiveFrom} /></label>
    <label className="mt-3 block text-sm font-semibold">修改原因（选填）<input className="ui-input mt-1" onChange={(event) => setForm((value) => ({ ...value, reason: event.target.value }))} placeholder="例如：转正调薪" value={form.reason} /></label>
    <label className="mt-3 flex items-center rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-900"><input checked={form.confirmed} className="mr-2" onChange={(event) => setForm((value) => ({ ...value, confirmed: event.target.checked }))} type="checkbox" />我已核对并确认本员工工资参数</label>
    <button className="ui-button-primary mt-3 w-full" disabled={busy} onClick={() => void save()} type="button">{busy ? '正在保存' : '保存员工工资参数'}</button>
  </SectionCard>{form.performanceEnabled ? <SectionCard><SectionHeader icon={ShieldCheck} title="按月设置门店绩效" description="每个关联门店独立计算，也可单独手动设置分数或等级。" /><MonthPicker label="绩效月份" onChange={setPerformanceMonth} value={performanceMonth} /><div className="mt-3 space-y-2">{monthlyPerformance.map((item) => <div className="rounded-xl border border-slate-200 p-3" key={item.storeId}><b className="text-sm text-slate-900">{auth.availableStores.find((store) => store.id === item.storeId)?.name ?? '门店'}</b><label className="mt-2 block text-xs font-semibold">计算方式<select className="ui-input mt-1" onChange={(event) => setMonthlyPerformance((current) => current.map((entry) => entry.storeId === item.storeId ? { ...entry, mode: event.target.value as MonthlyPerformanceForm['mode'] } : entry))} value={item.mode}><option value="automatic">自动按评分计算</option><option value="score">手动设置绩效分</option><option value="grade">手动设置绩效等级</option></select></label>{item.mode === 'score' ? <Field label="本月绩效分（0–100）" value={item.score} onChange={(score) => setMonthlyPerformance((current) => current.map((entry) => entry.storeId === item.storeId ? { ...entry, score } : entry))} /> : null}{item.mode === 'grade' ? <label className="mt-3 block text-sm font-semibold">本月绩效等级<select className="ui-input mt-1" onChange={(event) => setMonthlyPerformance((current) => current.map((entry) => entry.storeId === item.storeId ? { ...entry, grade: event.target.value as MonthlyPerformanceForm['grade'] } : entry))} value={item.grade}>{(['A','B','C','D'] as const).map((grade) => <option key={grade} value={grade}>{grade} 级</option>)}</select></label> : null}</div>)}</div><div className="mt-3 rounded-xl bg-amber-50 p-3"><label className="text-sm font-semibold">最终绩效奖金额<select className="ui-input mt-1" onChange={(event) => setFinalPerformanceMode(event.target.value as 'automatic' | 'override')} value={finalPerformanceMode}><option value="automatic">按门店占比和等级自动计算</option><option value="override">手动设置最终实际金额</option></select></label>{finalPerformanceMode === 'override' ? <><Field label="本月最终绩效奖" value={finalPerformanceAmount} onChange={setFinalPerformanceAmount} /><p className="mt-1 text-xs leading-5 text-amber-800">手动金额不会显示为“管理员覆盖”；但仍需为每个门店手动设置分数或等级。</p></> : null}</div><button className="ui-button-primary mt-3 w-full" disabled={performanceBusy} onClick={() => void saveMonthlyPerformance()} type="button">{performanceBusy ? '正在保存' : '保存本月门店绩效'}</button></SectionCard> : null}{monthlyTaxSettings}<FeedbackDialog feedback={feedback} close={() => setFeedback(null)} /></>;
}

function PerformanceRules() {
  const [current, setCurrent] = useState<PayrollPerformanceRule | null>(null); const [feedback, setFeedback] = useState<Feedback | null>(null); const [busy, setBusy] = useState(false); const [form, setForm] = useState(defaultPerformanceForm());
  const load = useCallback(async () => { if (!supabase) return; const setup = await loadPayrollAdminSetup(supabase, monthStart()); const rule = setup.performanceRules[0] ?? null; setCurrent(rule); if (rule) setForm(performanceToForm(rule)); }, []);
  useEffect(() => { void load().catch(() => setFeedback({ title: '加载失败', message: '暂时无法加载绩效规则。', tone: 'danger' })); }, [load]);
  const save = async () => { if (!supabase) return; const weight = Number(form.taskWeight) + Number(form.attendanceWeight) + Number(form.disciplineWeight); if (weight !== 100 || !form.reason.trim()) { setFeedback({ title: '请完善绩效规则', message: weight !== 100 ? '任务、考勤和纪律三项权重合计必须等于 100。' : '请填写修改原因。', tone: 'warning' }); return; } setBusy(true); try { await savePayrollPerformanceRule(supabase, { taskWeight: Number(form.taskWeight), attendanceWeight: Number(form.attendanceWeight), disciplineWeight: Number(form.disciplineWeight), lateDeduction1To10: Number(form.late1), lateDeduction11To20: Number(form.late2), lateDeduction21To30: Number(form.late3), lateDeduction31Plus: Number(form.late4), gradeAMin: Number(form.aMin), gradeBMin: Number(form.bMin), gradeCMin: Number(form.cMin), gradeACoefficient: Number(form.aRate) / 100, gradeBCoefficient: Number(form.bRate) / 100, gradeCCoefficient: Number(form.cRate) / 100, gradeDCoefficient: Number(form.dRate) / 100, effectiveFrom: form.effectiveFrom, changeReason: form.reason.trim() }); setFeedback({ title: '绩效规则已保存', message: '新规则将按生效日期用于实时工资计算。', tone: 'success' }); await load(); } catch (error) { setFeedback({ title: '保存未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' }); } finally { setBusy(false); } };
  return <><SectionCard><SectionHeader icon={ShieldCheck} title="绩效评分规则" description={`当前规则：${current?.effective_from ?? '尚未配置'}`} /><h3 className="mt-4 text-sm font-bold">评分权重（合计 100）</h3><div className="mt-2 grid grid-cols-3 gap-2"><Field label="任务" value={form.taskWeight} onChange={(taskWeight) => setForm((v) => ({ ...v, taskWeight }))} /><Field label="考勤" value={form.attendanceWeight} onChange={(attendanceWeight) => setForm((v) => ({ ...v, attendanceWeight }))} /><Field label="纪律" value={form.disciplineWeight} onChange={(disciplineWeight) => setForm((v) => ({ ...v, disciplineWeight }))} /></div><h3 className="mt-4 text-sm font-bold">迟到绩效扣分</h3><div className="mt-2 grid grid-cols-2 gap-2"><Field label="1–10 分钟" value={form.late1} onChange={(late1) => setForm((v) => ({ ...v, late1 }))} /><Field label="11–20 分钟" value={form.late2} onChange={(late2) => setForm((v) => ({ ...v, late2 }))} /><Field label="21–30 分钟" value={form.late3} onChange={(late3) => setForm((v) => ({ ...v, late3 }))} /><Field label="31 分钟以上" value={form.late4} onChange={(late4) => setForm((v) => ({ ...v, late4 }))} /></div><h3 className="mt-4 text-sm font-bold">等级最低分 / 金额系数</h3><div className="mt-2 grid grid-cols-2 gap-2"><Field label="A 最低分" value={form.aMin} onChange={(aMin) => setForm((v) => ({ ...v, aMin }))} /><Field label="A 系数 %" value={form.aRate} onChange={(aRate) => setForm((v) => ({ ...v, aRate }))} /><Field label="B 最低分" value={form.bMin} onChange={(bMin) => setForm((v) => ({ ...v, bMin }))} /><Field label="B 系数 %" value={form.bRate} onChange={(bRate) => setForm((v) => ({ ...v, bRate }))} /><Field label="C 最低分" value={form.cMin} onChange={(cMin) => setForm((v) => ({ ...v, cMin }))} /><Field label="C 系数 %" value={form.cRate} onChange={(cRate) => setForm((v) => ({ ...v, cRate }))} /><Field label="D 系数 %" value={form.dRate} onChange={(dRate) => setForm((v) => ({ ...v, dRate }))} /></div><p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-900">发放比例参考：A 级（≥{form.aMin} 分）发放满绩效的 {form.aRate}%；B 级（≥{form.bMin} 分）发放 {form.bRate}%；C 级（≥{form.cMin} 分）发放 {form.cRate}%；低于 {form.cMin} 分为 D 级，发放 {form.dRate}%。</p><label className="mt-3 block text-sm font-semibold">生效日期<input className="ui-input mt-1" onChange={(event) => setForm((v) => ({ ...v, effectiveFrom: event.target.value }))} type="date" value={form.effectiveFrom} /></label><label className="mt-3 block text-sm font-semibold">修改原因<input className="ui-input mt-1" onChange={(event) => setForm((v) => ({ ...v, reason: event.target.value }))} value={form.reason} /></label><button className="ui-button-primary mt-3 w-full" disabled={busy} onClick={() => void save()} type="button">保存绩效规则</button></SectionCard><PerformanceRuleExplanation form={form} /><FeedbackDialog feedback={feedback} close={() => setFeedback(null)} /></>;
}

function PerformanceRuleExplanation({ form }: { form: ReturnType<typeof defaultPerformanceForm> }) {
  return <SectionCard>
    <SectionHeader title="绩效分计算细则" description="以下说明会随上方当前填写的规则同步变化。" />
    <ol className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
      <li><b>1. 任务得分：</b>当月已通过任务数 ÷ 应完成任务数 × {form.taskWeight} 分；没有足够任务数据时，绩效暂不定级。</li>
      <li><b>2. 考勤得分：</b>从 {form.attendanceWeight} 分开始计算，迟到 1–10、11–20、21–30、31 分钟以上分别扣 {form.late1}、{form.late2}、{form.late3}、{form.late4} 分，最低为 0 分。</li>
      <li><b>3. 纪律得分：</b>从 {form.disciplineWeight} 分开始计算，再减去处罚记录中的绩效扣分，最低为 0 分。</li>
      <li><b>4. 最终绩效分：</b>任务得分 + 考勤得分 + 纪律得分，三项满分合计 100 分。</li>
      <li><b>5. 绩效金额：</b>A 级（≥{form.aMin}）按满绩效的 {form.aRate}%；B 级（≥{form.bMin}）按 {form.bRate}%；C 级（≥{form.cMin}）按 {form.cRate}%；其余 D 级按 {form.dRate}% 计算，再按当月累计出勤天数折算。</li>
      <li><b>6. 全勤奖：</b>员工启用后，累计出勤达到当月满勤天数才独立产生全勤奖，不与绩效金额合并。</li>
      <li><b>7. 转正折算：</b>实习期不计绩效和提成；转正当月只按转正后的实际出勤日期占比折算。</li>
    </ol>
  </SectionCard>;
}

function RevenueManager() {
  const auth = useAuth();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [posSetup, setPosSetup] = useState<Awaited<ReturnType<typeof loadPosSalesSetup>> | null>(null);
  const [storeId, setStoreId] = useRememberedPageState('revenue-store', auth.availableStores[0]?.id ?? '');
  const [date, setDate] = useRememberedPageState('revenue-date', todayInChina());
  const [inputMode, setInputMode] = useState<'pos_sync' | 'manual'>('manual');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busyAction, setBusyAction] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    const [payroll, sales] = await Promise.all([
      loadPayrollAdminSetup(supabase, monthStart(date)),
      loadPosSalesSetup(supabase),
    ]);
    setSetup(payroll);
    setPosSetup(sales);
  }, [date]);
  useEffect(() => { void load().catch(() => undefined); }, [load]);

  const integration = posSetup?.integrations.find((item) => item.store_id === storeId);
  const savedInput = setup?.revenueInputs.find((item) => item.store_id === storeId && item.as_of_date === date);
  const dailyMonthTotal = setup?.revenues
    .filter((item) => item.store_id === storeId && item.revenue_date >= monthStart(date) && item.revenue_date <= date)
    .reduce((total, item) => total + Number(item.confirmed_amount), 0) ?? 0;
  const cumulativeRevenue = savedInput?.input_mode === 'manual'
    ? Number(savedInput.manual_cumulative_amount ?? 0)
    : dailyMonthTotal;
  useEffect(() => {
    const nextMode = savedInput?.input_mode ?? (integration?.provider === 'pospal' ? 'pos_sync' : 'manual');
    setInputMode(nextMode);
    setAmount(savedInput?.input_mode === 'manual' ? String(savedInput.manual_cumulative_amount ?? '') : '');
    setNote(savedInput?.note ?? '');
  }, [date, integration?.provider, savedInput, storeId]);

  const saveManual = async () => {
    if (!supabase || !auth.profile || !storeId || amount === '') {
      setFeedback({ title: '请完善提成计算基数', message: '请选择门店并填写本月 1 日至截止日期的累计提成计算基数。', tone: 'warning' });
      return;
    }
    setBusyAction('manual-cumulative');
    try {
      await savePayrollRevenueInput(supabase, { asOfDate: date, mode: 'manual', manualCumulativeAmount: Number(amount), note, storeId });
      setFeedback({ title: '手动提成基数已保存', message: `${date.slice(0, 7)}-01 至 ${date} 的金额仅用于员工提成计算，不会修改西直门的银豹营业额和每日营业额明细。`, tone: 'success' });
      await load();
    } catch (error) {
      setFeedback({ title: '保存未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    } finally { setBusyAction(''); }
  };

  const syncMonth = async () => {
    if (!supabase || !integration || integration.provider !== 'pospal') {
      setFeedback({ title: '当前门店未接入收银系统', message: '请选择已经接入银豹的西直门店，或仅手动设置员工提成计算基数。', tone: 'warning' });
      return;
    }
    setBusyAction(`sync-month:${integration.id}`);
    try {
      const result = await invokePospalMonthlySalesSync(supabase, integration.id, date);
      await savePayrollRevenueInput(supabase, { asOfDate: date, mode: 'pos_sync', storeId });
      setFeedback({
        title: '本月累计营业额已同步',
        message: `${date.slice(0, 7)}-01 至 ${date} 共读取 ${result.ticketCount ?? 0} 张单据，累计营业额为 ${formatMoney(result.revenueAmount ?? 0)}，使用 ${result.apiCallCount ?? 0} 次接口调用。`,
        tone: 'success',
      });
      await load();
    } catch (error) {
      setFeedback({ title: '本月累计同步未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
      await load().catch(() => undefined);
    } finally { setBusyAction(''); }
  };

  const syncNow = async (integration: PosSalesIntegration) => {
    if (!supabase) return;
    setBusyAction(`sync:${integration.id}`);
    try {
      const result = await invokePospalSalesSync(supabase, integration.id, date);
      setFeedback({
        title: '银豹营业收入已更新',
        message: `${date} 共读取 ${result.ticketCount ?? 0} 张单据，营业收入为 ${formatMoney(result.revenueAmount ?? 0)}，使用 ${result.apiCallCount ?? 0} 次接口调用。`,
        tone: 'success',
      });
      await load();
    } catch (error) {
      setFeedback({ title: '银豹同步未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
      await load().catch(() => undefined);
    } finally { setBusyAction(''); }
  };

  const saveSettings = async (integration: PosSalesIntegration, settings: { enabled: boolean; startHour: number; endHour: number; intervalMinutes: number }) => {
    if (!supabase) return;
    if (settings.endHour < settings.startHour) {
      setFeedback({ title: '自动同步时段不正确', message: '结束时间不能早于开始时间。', tone: 'warning' });
      return;
    }
    setBusyAction(`settings:${integration.id}`);
    try {
      await configurePosSalesIntegration(supabase, { id: integration.id, ...settings });
      setFeedback({ title: '自动同步设置已保存', message: settings.enabled ? `每天 ${settings.startHour}:00–${settings.endHour}:00，每 ${settings.intervalMinutes} 分钟检查一次银豹营业收入。` : '该门店的自动同步已暂停，仍可手动更新。', tone: 'success' });
      await load();
    } catch (error) {
      setFeedback({ title: '设置未保存', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    } finally { setBusyAction(''); }
  };

  return <>
    <SectionCard>
      <SectionHeader icon={RefreshCw} title="收银系统自动同步" description="西直门店使用银豹；五道口店将单独使用企迈，两个门店的数据不会混用。" />
      <div className="mt-3 space-y-3">
        {posSetup?.integrations.map((integration) => <PosSalesIntegrationCard
          busyAction={busyAction}
          integration={integration}
          job={posSetup.jobs.find((job) => job.integration_id === integration.id)}
          key={integration.id}
          onSave={saveSettings}
          onSync={() => void syncNow(integration)}
          syncDate={date}
        />)}
        {posSetup && !posSetup.integrations.length ? <EmptyState title="尚未配置收银系统连接" /> : null}
      </div>
    </SectionCard>

    <SectionCard>
      <SectionHeader icon={Banknote} title="本月累计营业额与提成基数" description="西直门实际营业额始终以银豹 API 数据为准；手动金额只覆盖员工提成计算基数，不修改营业额记录。" />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-sm font-semibold">门店<select className="ui-input mt-1" onChange={(event) => setStoreId(event.target.value)} value={storeId}>{auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        <label className="text-sm font-semibold">截止日期<input className="ui-input mt-1" max={todayInChina()} onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label>
      </div>
      <div className="mt-3 rounded-xl bg-brand-50 p-3 text-center"><p className="text-xs font-semibold text-brand-700">{date.slice(0, 7)}-01 至 {date} 累计提成基数</p><p className="mt-1 text-2xl font-bold tabular-nums text-brand-900">{formatMoney(cumulativeRevenue)}</p></div>
      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="营业额更新方式">
        <button className={`min-h-11 rounded-lg border px-3 text-sm font-bold ${inputMode === 'pos_sync' ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-200 bg-white text-slate-700'}`} disabled={!integration || integration.provider !== 'pospal'} onClick={() => setInputMode('pos_sync')} type="button">收银系统同步</button>
        <button className={`min-h-11 rounded-lg border px-3 text-sm font-bold ${inputMode === 'manual' ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-200 bg-white text-slate-700'}`} onClick={() => setInputMode('manual')} type="button">手动设置提成基数</button>
      </div>
      {inputMode === 'pos_sync' ? <div className="mt-3 rounded-xl border border-brand-100 bg-emerald-50/60 p-3"><p className="text-sm font-semibold text-slate-800">从银豹同步本月累计营业额</p><p className="mt-1 text-xs leading-5 text-slate-600">银豹接口每次最多查询 1 天；系统会分小批读取本月全部有效销售与退货单，完成后统一更新每日明细。</p><button className="ui-button-primary mt-3 w-full" disabled={Boolean(busyAction)} onClick={() => void syncMonth()} type="button">{busyAction.startsWith('sync-month:') ? '正在同步本月数据' : '同步本月累计营业额'}</button></div> : <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3"><p className="text-xs leading-5 text-amber-800">这里填写的金额只用于员工提成比例计算。西直门营业额仍由银豹 API 同步，且不会被此处覆盖。</p><Field label={`本月累计提成计算基数（截至 ${date}）`} value={amount} onChange={setAmount} /><label className="mt-3 block text-sm font-semibold">备注（选填）<input className="ui-input mt-1" onChange={(event) => setNote(event.target.value)} value={note} /></label><button className="ui-button-primary mt-3 w-full" disabled={Boolean(busyAction)} onClick={() => void saveManual()} type="button">{busyAction === 'manual-cumulative' ? '正在保存' : '保存手动提成基数'}</button></div>}
    </SectionCard>

    <section className="space-y-2"><h3 className="px-1 text-sm font-bold text-slate-700">每日营业额明细</h3>{setup?.revenues.slice(0, 30).map((row) => <SectionCard className="p-3" key={row.id}><div className="flex items-start justify-between gap-3"><span><b>{auth.availableStores.find((store) => store.id === row.store_id)?.short_name ?? '门店'}</b><small className="mt-0.5 block text-slate-500">{row.revenue_date}</small><StatusBadge tone={row.source === 'pospal' ? 'success' : row.source === 'qmai' ? 'info' : 'warning'}>{row.source === 'pospal' ? '银豹同步' : row.source === 'qmai' ? '企迈同步' : '历史手动明细'}</StatusBadge></span><b>{formatMoney(row.confirmed_amount)}</b></div></SectionCard>)}</section>
    <FeedbackDialog feedback={feedback} close={() => setFeedback(null)} />
  </>;
}

function PosSalesIntegrationCard({ busyAction, integration, job, onSave, onSync, syncDate }: {
  busyAction: string;
  integration: PosSalesIntegration;
  job?: PosSalesSyncJob;
  onSave: (integration: PosSalesIntegration, settings: { enabled: boolean; startHour: number; endHour: number; intervalMinutes: number }) => Promise<void>;
  onSync: () => void;
  syncDate: string;
}) {
  const [enabled, setEnabled] = useState(integration.enabled);
  const [startHour, setStartHour] = useState(integration.sync_start_hour);
  const [endHour, setEndHour] = useState(integration.sync_end_hour);
  const [intervalMinutes, setIntervalMinutes] = useState(integration.sync_interval_minutes);
  useEffect(() => {
    setEnabled(integration.enabled); setStartHour(integration.sync_start_hour); setEndHour(integration.sync_end_hour); setIntervalMinutes(integration.sync_interval_minutes);
  }, [integration]);
  const settingsBusy = busyAction === `settings:${integration.id}`;
  const syncBusy = busyAction === `sync:${integration.id}`;
  const hours = Array.from({ length: 24 }, (_, index) => index);
  return <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
    <div className="flex items-start justify-between gap-3">
      <div><b>{integration.display_name}</b><p className="mt-0.5 text-xs text-slate-500">银豹账号：{integration.external_account || '已安全配置'}</p></div>
      <StatusBadge tone={integration.last_error ? 'danger' : integration.last_success_at ? 'success' : 'warning'}>{integration.last_error ? '同步异常' : integration.last_success_at ? '连接正常' : '等待首次同步'}</StatusBadge>
    </div>
    {integration.last_error ? <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700">{integration.last_error}</p> : null}
    <div className="mt-3 grid grid-cols-2 gap-2">
      <label className="text-xs font-semibold">开始时间<select className="ui-input mt-1 min-h-10 py-1" onChange={(event) => setStartHour(Number(event.target.value))} value={startHour}>{hours.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>
      <label className="text-xs font-semibold">结束时间<select className="ui-input mt-1 min-h-10 py-1" onChange={(event) => setEndHour(Number(event.target.value))} value={endHour}>{hours.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>
      <label className="text-xs font-semibold">更新频率<select className="ui-input mt-1 min-h-10 py-1" onChange={(event) => setIntervalMinutes(Number(event.target.value))} value={intervalMinutes}><option value="15">每 15 分钟</option><option value="30">每 30 分钟</option><option value="60">每 1 小时</option><option value="120">每 2 小时</option></select></label>
      <label className="flex min-h-10 items-center gap-2 self-end rounded-lg bg-white px-3 text-xs font-semibold"><input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />启用自动更新</label>
    </div>
    <div className="mt-2 grid grid-cols-2 gap-2">
      <button className="ui-button-secondary min-h-10 text-xs" disabled={Boolean(busyAction)} onClick={() => void onSave(integration, { enabled, startHour, endHour, intervalMinutes })} type="button">{settingsBusy ? '正在保存' : '保存更新设置'}</button>
      <button className="ui-button-primary min-h-10 text-xs" disabled={Boolean(busyAction)} onClick={onSync} type="button"><RefreshCw className={`h-3.5 w-3.5 ${syncBusy ? 'animate-spin' : ''}`} />{syncBusy ? '正在同步' : `更新 ${syncDate}`}</button>
    </div>
    <p className="mt-2 text-[11px] leading-5 text-slate-500">{integration.last_success_at ? `上次成功：${new Date(integration.last_success_at).toLocaleString('zh-CN')}` : '尚无成功同步记录'}{job ? ` · 最近读取 ${job.fetched_count} 张单据 · API ${job.api_call_count} 次` : ''}</p>
  </article>;
}

function PenaltyManager() {
  const auth = useAuth(); const [setup, setSetup] = useState<Setup | null>(null); const [profileId, setProfileId] = useState(''); const [date, setDate] = useState(todayInChina()); const [reason, setReason] = useState(''); const [amount, setAmount] = useState('0'); const [level, setLevel] = useState<keyof typeof penaltyDefaults>('warning'); const [deduction, setDeduction] = useState(String(penaltyDefaults.warning)); const [files, setFiles] = useState<File[]>([]); const [feedback, setFeedback] = useState<Feedback | null>(null); const [revokeId, setRevokeId] = useState(''); const [revokeReason, setRevokeReason] = useState(''); const [busy, setBusy] = useState(false);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]); useEffect(() => () => previews.forEach((item) => URL.revokeObjectURL(item.url)), [previews]);
  const load = useCallback(async () => { if (!supabase) return; const data = await loadPayrollAdminSetup(supabase, monthStart(date)); setSetup(data); setProfileId((value) => value || data.profiles[0]?.id || ''); }, [date]); useEffect(() => { void load().catch(() => undefined); }, [load]);
  const save = async () => { if (!supabase || !auth.profile || !profileId || !reason.trim()) { setFeedback({ title: '请完善处罚信息', message: '员工、日期和处罚原因不能为空。', tone: 'warning' }); return; } setBusy(true); try { const penalty = await addPayrollPenalty(supabase, { profileId, eventDate: date, reason: reason.trim(), amount: Number(amount), eventLevel: level, performanceDeduction: Number(deduction) }); const failed: string[] = []; for (const file of files) { try { await uploadPayrollEvidence(supabase, { file, ownerId: auth.profile.id, entityId: penalty.id }); } catch { failed.push(file.name); } } setReason(''); setFiles([]); setFeedback({ title: '处罚记录已发布', message: failed.length ? `处罚及员工通知已发布，但 ${failed.length} 张图片上传失败。` : '罚款和绩效扣分已计入预估工资，员工通知已发送。', tone: failed.length ? 'warning' : 'success' }); await load(); } catch (error) { setFeedback({ title: '发布未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' }); } finally { setBusy(false); } };
  const revoke = async () => { if (!supabase || !revokeId || !revokeReason.trim()) { setFeedback({ title: '请填写撤销原因', message: '撤销处罚必须保留原因。', tone: 'warning' }); return; } const id = revokeId; setRevokeId(''); try { await revokePayrollPenalty(supabase, id, revokeReason.trim()); setFeedback({ title: '处罚记录已撤销', message: '该记录不再参与工资和绩效计算。', tone: 'success' }); setRevokeReason(''); await load(); } catch (error) { setFeedback({ title: '撤销未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' }); } };
  const changeLevel = (next: keyof typeof penaltyDefaults) => { setLevel(next); setDeduction(String(penaltyDefaults[next])); };
  return <><SectionCard><SectionHeader icon={ClipboardPen} title="其他罚款与纪律记录" description="事件等级会自动带出默认绩效扣分，仍可按实际情况调整。" /><label className="mt-3 block text-sm font-semibold">员工<select className="ui-input mt-1" onChange={(event) => setProfileId(event.target.value)} value={profileId}>{setup?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select></label><div className="mt-3 grid grid-cols-2 gap-2"><label className="text-sm font-semibold">日期<input className="ui-input mt-1" max={todayInChina()} onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label><label className="text-sm font-semibold">事件等级<select className="ui-input mt-1" onChange={(event) => changeLevel(event.target.value as keyof typeof penaltyDefaults)} value={level}><option value="reminder">提醒（默认 0 分）</option><option value="warning">警告（默认 3 分）</option><option value="formal_warning">正式警告（默认 5 分）</option><option value="serious">严重违纪（默认 10 分）</option></select></label><Field label="罚款金额" value={amount} onChange={setAmount} /><Field label="绩效扣分" value={deduction} onChange={setDeduction} /></div><label className="mt-3 block text-sm font-semibold">原因<input className="ui-input mt-1" onChange={(event) => setReason(event.target.value)} value={reason} /></label><label className="ui-button-secondary mt-3 w-full cursor-pointer"><Camera className="h-4 w-4" />上传处罚图片（选填）<input accept="image/jpeg,image/png,image/webp" className="sr-only" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} type="file" /></label>{previews.length ? <div className="mt-2 grid grid-cols-3 gap-2">{previews.map((item) => <div className="relative" key={`${item.file.name}-${item.file.lastModified}`}><img alt={item.file.name} className="aspect-square w-full rounded-lg object-cover" src={item.url} /><button aria-label={`删除 ${item.file.name}`} className="absolute right-1 top-1 flex h-7 w-7 min-h-0 items-center justify-center rounded-full bg-black/70 text-white" onClick={() => setFiles((current) => current.filter((file) => file !== item.file))} type="button"><X className="h-4 w-4" /></button></div>)}</div> : null}<button className="ui-button-primary mt-3 w-full" disabled={busy} onClick={() => void save()} type="button">{busy ? '正在发布' : '发布处罚记录'}</button></SectionCard><section className="space-y-2">{setup?.penalties.map((row) => <SectionCard className="p-3" key={row.id}><div className="flex items-start justify-between gap-3"><span><b>{setup.profiles.find((profile) => profile.id === row.profile_id)?.display_name}</b><small className="block text-slate-500">{row.event_date} · {row.reason} · 扣 {row.performance_deduction} 分</small></span><StatusBadge tone={row.status === 'active' ? 'danger' : 'info'}>{row.status === 'active' ? `-${formatMoney(row.amount)}` : '已撤销'}</StatusBadge></div>{row.status === 'active' ? <button className="ui-button-secondary mt-2 min-h-9 w-full text-xs" onClick={() => setRevokeId(row.id)} type="button">撤销此记录</button> : null}</SectionCard>)}</section><ConfirmDialog confirmLabel="确认撤销" onCancel={() => setRevokeId('')} onConfirm={() => void revoke()} open={Boolean(revokeId)} title="确认撤销处罚记录"><label className="block text-sm font-semibold">撤销原因<input className="ui-input mt-1" onChange={(event) => setRevokeReason(event.target.value)} value={revokeReason} /></label></ConfirmDialog><FeedbackDialog feedback={feedback} close={() => setFeedback(null)} /></>;
}

function OvertimeManager() {
  const auth = useAuth(); const [setup, setSetup] = useState<Setup | null>(null); const [rate, setRate] = useState('25'); const [effectiveFrom, setEffectiveFrom] = useState(todayInChina()); const [reason, setReason] = useState(''); const [feedback, setFeedback] = useState<Feedback | null>(null); const [busy, setBusy] = useState(false); const [review, setReview] = useState<{ id: string; action: 'approved' | 'rejected' } | null>(null); const [reviewNote, setReviewNote] = useState('');
  const load = useCallback(async () => { if (!supabase) return; const data = await loadPayrollAdminSetup(supabase, monthStart()); setSetup(data); if (data.overtimeRates[0]) { setRate(String(data.overtimeRates[0].hourly_rate)); setEffectiveFrom(data.overtimeRates[0].effective_from); } }, []); useEffect(() => { void load().catch(() => undefined); }, [load]);
  const reviewRequest = setup?.overtimeRequests.find((item) => item.id === review?.id);
  const reviewProfile = setup?.profiles.find((profile) => profile.id === reviewRequest?.profile_id);
  const reviewTerm = reviewProfile?.employment_type === 'part_time' ? '兼职工时' : '加班';
  const save = async () => { if (!supabase || rate === '' || Number(rate) < 0) { setFeedback({ title: '请填写有效时薪', message: '计薪时薪不能留空或小于 0。', tone: 'warning' }); return; } setBusy(true); try { await saveOvertimeRate(supabase, { hourlyRate: Number(rate), effectiveFrom, changeReason: reason.trim() }); setFeedback({ title: '计薪时薪已保存', message: '新时薪按生效日期使用；已经审批的申请继续保留审批时锁定的时薪。', tone: 'success' }); setReason(''); await load(); } catch (error) { setFeedback({ title: '保存未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' }); } finally { setBusy(false); } };
  const confirmReview = async () => { if (!supabase || !review) return; if (review.action === 'rejected' && !reviewNote.trim()) { setFeedback({ title: '请填写驳回原因', message: `驳回${reviewTerm}申请时必须说明原因。`, tone: 'warning' }); return; } const copy = review; const term = reviewTerm; setReview(null); try { await reviewOvertimeRequest(supabase, copy.id, copy.action, reviewNote.trim()); setReviewNote(''); window.dispatchEvent(new Event('storehub:todos-changed')); setFeedback({ title: `${term}申请${copy.action === 'approved' ? '已通过' : '已驳回'}`, message: copy.action === 'approved' ? `${term === '兼职工时' ? '兼职薪资' : '加班工资'}已计入员工预估工资。` : '员工会在通知中心看到驳回结果和原因。', tone: 'success' }); await load(); } catch (error) { setFeedback({ title: '审批未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' }); } };
  return <><SectionCard><SectionHeader icon={Clock3} title="工时计薪设置" description="加班与兼职工时默认 25 元/小时；审批通过后才计入对应薪资。" /><div className="mt-3 grid grid-cols-2 gap-2"><Field label="计薪时薪" value={rate} onChange={setRate} /><label className="mt-3 block text-sm font-semibold">生效日期<input className="ui-input mt-1" onChange={(event) => setEffectiveFrom(event.target.value)} type="date" value={effectiveFrom} /></label></div><label className="mt-3 block text-sm font-semibold">修改原因（选填）<input className="ui-input mt-1" onChange={(event) => setReason(event.target.value)} value={reason} /></label><button className="ui-button-primary mt-3 w-full" disabled={busy} onClick={() => void save()} type="button">保存计薪时薪</button></SectionCard><AdminOvertimeEntry onSaved={load} setup={setup} /><AdminOvertimeBatchImport onSaved={load} profiles={setup?.profiles ?? []} stores={auth.availableStores} /><SectionCard><SectionHeader title="工时申请与审批" description="员工和兼职申请由店长审批；店长申请由管理员审批。" /><div className="mt-3 space-y-2">{setup?.overtimeRequests.map((item) => { const requester = setup.profiles.find((profile) => profile.id === item.profile_id); const term = requester?.employment_type === 'part_time' ? '兼职工时' : '加班'; const managerPending = requester?.role === 'manager' && item.status === 'pending'; return <article className={`rounded-lg p-3 ${managerPending ? 'border border-amber-200 bg-amber-50' : 'bg-slate-50'}`} key={item.id}><div className="flex items-start justify-between gap-3"><div><b>{requester?.display_name ?? '员工'}{requester?.role === 'manager' ? ' · 店长' : requester?.employment_type === 'part_time' ? ' · 兼职' : ''}</b><p className="mt-1 text-sm text-slate-600">{item.overtime_date} · {term} {item.hours} 小时 · {auth.availableStores.find((store) => store.id === item.store_id)?.short_name ?? '门店'}</p>{item.reason ? <p className="mt-1 text-xs text-slate-500">{item.reason}</p> : null}</div><StatusBadge tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : 'warning'}>{item.status === 'approved' ? '已通过' : item.status === 'rejected' ? '已驳回' : managerPending ? '待管理员审批' : '待店长审批'}</StatusBadge></div>{managerPending ? <div className="mt-3 grid grid-cols-2 gap-2"><button className="ui-button-secondary" onClick={() => setReview({ id: item.id, action: 'rejected' })} type="button">驳回</button><button className="ui-button-primary" onClick={() => setReview({ id: item.id, action: 'approved' })} type="button">通过</button></div> : null}</article>; })}{!setup?.overtimeRequests.length ? <EmptyState title="暂无工时申请" /> : null}</div></SectionCard><ConfirmDialog confirmLabel={review?.action === 'approved' ? '确认通过' : '确认驳回'} danger={review?.action === 'rejected'} onCancel={() => { setReview(null); setReviewNote(''); }} onConfirm={() => void confirmReview()} open={Boolean(review)} title={`${review?.action === 'approved' ? '通过' : '驳回'}${reviewTerm}申请`}><label className="block text-sm font-semibold">审批说明{review?.action === 'approved' ? '（选填）' : ''}<textarea className="ui-input mt-1 min-h-20 py-2" onChange={(event) => setReviewNote(event.target.value)} value={reviewNote} /></label></ConfirmDialog><FeedbackDialog feedback={feedback} close={() => setFeedback(null)} /></>;
}

function AdminOvertimeEntry({ onSaved, setup }: { onSaved: () => Promise<void>; setup: Setup | null }) {
  const auth = useAuth();
  const profiles = useMemo(() => setup?.profiles ?? [], [setup]);
  const [profileId, setProfileId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [date, setDate] = useState(todayInChina());
  const [hours, setHours] = useState('0.5');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const selectedProfile = profiles.find((profile) => profile.id === profileId);
  const isPartTime = selectedProfile?.employment_type === 'part_time';
  const hoursTerm = isPartTime ? '兼职工时' : '加班工时';
  const hourOptions = Array.from({ length: 12 }, (_, index) => (index + 1) / 2);

  useEffect(() => {
    if (profileId || !profiles.length) return;
    const profile = profiles[0];
    setProfileId(profile.id);
    setStoreId(auth.availableStores.some((store) => store.id === profile.store_id) ? profile.store_id : auth.availableStores[0]?.id ?? '');
  }, [auth.availableStores, profileId, profiles]);

  const chooseProfile = (nextId: string) => {
    setProfileId(nextId);
    const profile = profiles.find((item) => item.id === nextId);
    if (profile && auth.availableStores.some((store) => store.id === profile.store_id)) setStoreId(profile.store_id);
  };
  const requestSave = () => {
    if (!profileId || !storeId || !date || !hours) {
      setFeedback({ title: '请完善工时信息', message: `员工、门店、日期和${hoursTerm}均不能为空。`, tone: 'warning' });
      return;
    }
    setConfirming(true);
  };
  const save = async () => {
    if (!supabase || !profileId || !storeId) return;
    setConfirming(false); setBusy(true);
    try {
      await adminRecordOvertime(supabase, { profileId, storeId, overtimeDate: date, hours: Number(hours), reason });
      await onSaved();
      setReason('');
      setFeedback({ title: `${hoursTerm}已登记`, message: `该记录已直接通过并计入${isPartTime ? '兼职薪资' : '员工实时薪资'}，员工通知也已发送。`, tone: 'success' });
    } catch (error) {
      setFeedback({ title: '登记未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    } finally { setBusy(false); }
  };

  return <SectionCard>
    <SectionHeader icon={Clock3} title="手动登记加班/兼职工时" description="管理员登记后直接生效，无需员工再次申请或审批。" />
    <div className="mt-3 grid grid-cols-2 gap-2">
      <label className="col-span-2 text-sm font-semibold">员工<select className="ui-input mt-1" onChange={(event) => chooseProfile(event.target.value)} value={profileId}><option value="">请选择员工</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name} · {payrollProfileLabel(profile)}</option>)}</select></label>
      <label className="text-sm font-semibold">门店<select className="ui-input mt-1" onChange={(event) => setStoreId(event.target.value)} value={storeId}><option value="">请选择门店</option>{auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.short_name ?? store.name}</option>)}</select></label>
      <label className="text-sm font-semibold">{isPartTime ? '兼职日期' : '加班日期'}<input className="ui-input mt-1" max={todayInChina()} onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label>
      <label className="col-span-2 text-sm font-semibold">{hoursTerm}<select className="ui-input mt-1" onChange={(event) => setHours(event.target.value)} value={hours}>{hourOptions.map((value) => <option key={value} value={value}>{value} 小时</option>)}</select></label>
    </div>
    <label className="mt-3 block text-sm font-semibold">登记说明（选填）<input className="ui-input mt-1" onChange={(event) => setReason(event.target.value)} placeholder="例如闭店盘点、临时支援" value={reason} /></label>
    <p className="mt-2 text-xs leading-5 text-slate-500">同一员工、门店和日期已有工时记录时，本次登记会更新该记录并直接确认通过。</p>
    <button className="ui-button-primary mt-3 w-full" disabled={busy || !profiles.length} onClick={requestSave} type="button">{busy ? '正在登记' : `登记${hoursTerm}`}</button>
    {!profiles.length ? <p className="mt-2 text-xs text-amber-700">当前没有可登记工时的员工、店长或兼职员工。</p> : null}
    <ConfirmDialog confirmLabel="确认登记" onCancel={() => setConfirming(false)} onConfirm={() => void save()} open={confirming} title={`确认登记${hoursTerm}`}><p className="text-sm text-slate-600">{selectedProfile?.display_name ?? '员工'} · {date} · {hours} 小时。确认后将立即计入薪资统计。</p></ConfirmDialog>
    <FeedbackDialog feedback={feedback} close={() => setFeedback(null)} />
  </SectionCard>;
}

function FeedbackDialog({ close, feedback }: { close: () => void; feedback: Feedback | null }) { return <ActionFeedbackDialog message={feedback?.message ?? ''} onClose={close} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone} />; }
function Field({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) { return <label className="mt-3 block text-sm font-semibold">{label}<input className="ui-input mt-1" min="0" onChange={(event) => onChange(event.target.value)} step="0.01" type="number" value={value} /></label>; }
function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-2"><b className="block truncate text-xs tabular-nums">{value}</b><span className="text-[10px] text-slate-500">{label}</span></div>; }
function SummaryMetric({ label, value }: { label: string; value: string }) { return <SectionCard className="p-3"><b className="block text-lg tabular-nums text-slate-900">{value}</b><span className="text-xs text-slate-500">{label}</span></SectionCard>; }
function ruleToForm(rule: PayrollEmployeeRule | undefined, storeIds: string[], performanceStores: { allocationPercent: string; storeId: string }[]) { return { base: rule ? String(rule.monthly_base_salary) : '', housing: rule ? String(rule.monthly_housing_allowance) : '', performance: rule?.full_performance_amount == null ? '' : String(rule.full_performance_amount), commission: rule?.commission_rate == null ? '' : String(rule.commission_rate * 100), extraReward: rule ? String(rule.extra_reward_amount) : '0', fullAttendanceBonus: rule ? String(rule.full_attendance_bonus_amount) : '', serviceAward: rule ? String(rule.service_award_amount) : '100', regularizationDate: rule?.regularization_date ?? '', effectiveFrom: rule?.effective_from ?? todayInChina(), reason: '', housingEnabled: rule?.housing_enabled ?? true, performanceEnabled: rule?.performance_enabled ?? true, commissionEnabled: rule?.commission_enabled ?? false, fullAttendanceBonusEnabled: rule?.full_attendance_bonus_enabled ?? false, serviceAwardEnabled: rule?.service_award_enabled ?? false, confirmed: rule?.confirmed ?? false, performanceStores, storeIds }; }
function defaultPerformanceForm() { return { taskWeight: '60', attendanceWeight: '25', disciplineWeight: '15', late1: '1', late2: '3', late3: '5', late4: '10', aMin: '90', bMin: '80', cMin: '70', aRate: '100', bRate: '80', cRate: '50', dRate: '20', effectiveFrom: todayInChina(), reason: '' }; }
function performanceToForm(rule: PayrollPerformanceRule) { return { taskWeight: String(rule.task_weight), attendanceWeight: String(rule.attendance_weight), disciplineWeight: String(rule.discipline_weight), late1: String(rule.late_deduction_1_10), late2: String(rule.late_deduction_11_20), late3: String(rule.late_deduction_21_30), late4: String(rule.late_deduction_31_plus), aMin: String(rule.grade_a_min), bMin: String(rule.grade_b_min), cMin: String(rule.grade_c_min), aRate: String(rule.grade_a_coefficient * 100), bRate: String(rule.grade_b_coefficient * 100), cRate: String(rule.grade_c_coefficient * 100), dRate: String(rule.grade_d_coefficient * 100), effectiveFrom: rule.effective_from, reason: '' }; }
