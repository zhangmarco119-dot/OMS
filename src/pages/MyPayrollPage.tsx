import { CheckCircle2, FileText } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { MonthPicker } from '../components/forms/MonthPicker';
import { PageShell } from '../components/layout/PageShell';
import { ConfirmDialog } from '../components/ui/Actions';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { SectionCard } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { PayrollEstimateView } from '../features/payroll/PayrollEstimateView';
import { PayrollStatementView } from '../features/payroll/PayrollStatementView';
import { payrollMonthEndDate } from '../features/payroll/monthSelection';
import { formatMoney, todayInChina, type PayrollEstimate } from '../features/payroll/model';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import { confirmPayrollPayslip, loadMyPayrollEstimate, loadMyPayrollPayslips, loadPayrollVisibilitySettings, type PayrollPayslip, type PayrollVisibilitySettings } from '../services/payroll.service';

const currentMonth = () => todayInChina().slice(0, 7);
const shiftMonth = (month: string, offset: number) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (month: string) => {
  const [year, value] = month.slice(0, 7).split('-');
  return `${year}年${Number(value)}月`;
};

export function MyPayrollPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'payslips' ? 'payslips' : 'estimate';
  const setTab = (next: 'estimate' | 'payslips') => {
    const copy = new URLSearchParams(params);
    copy.set('tab', next);
    copy.delete('payslip');
    setParams(copy);
  };
  return <PageShell eyebrow="个人薪资" title="我的薪资" backTo="/app/menu" contentGapClassName="gap-3">
    <nav className="ui-card grid grid-cols-2 gap-1 p-1.5" aria-label="我的薪资功能">
      <button className={`min-h-11 rounded-lg text-sm font-bold ${tab === 'estimate' ? 'bg-brand-700 text-white' : 'text-slate-600'}`} onClick={() => setTab('estimate')} type="button">预估薪资</button>
      <button className={`min-h-11 rounded-lg text-sm font-bold ${tab === 'payslips' ? 'bg-brand-700 text-white' : 'text-slate-600'}`} onClick={() => setTab('payslips')} type="button">工资单</button>
    </nav>
    {tab === 'estimate' ? <EstimatePanel /> : <PayslipPanel />}
  </PageShell>;
}

function EstimatePanel() {
  const auth = useAuth();
  const profileId = auth.profile?.id;
  const [estimate, setEstimate] = useState<PayrollEstimate | null>(null);
  const [settings, setSettings] = useState<PayrollVisibilitySettings | null>(null);
  const [month, setMonth] = useRememberedPageState('estimate-month', currentMonth());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const asOf = useMemo(() => payrollMonthEndDate(month, todayInChina()), [month]);
  const load = useCallback(async () => {
    if (!supabase || !profileId) { setStatus('error'); setMessage('账号或服务配置尚未就绪。'); return; }
    setStatus('loading');
    try {
      const nextSettings = settings ?? await loadPayrollVisibilitySettings(supabase);
      setSettings(nextSettings);
      setEstimate(await loadMyPayrollEstimate(supabase, profileId, asOf));
      setStatus('ready'); setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : '暂时无法计算预估工资。'); setStatus('error'); }
  }, [asOf, profileId, settings]);
  useEffect(() => { void load(); }, [load]);
  const historyEnabled = Boolean(settings?.historyOpenNow && settings.historyMonths > 0);
  return <>
    <div className="ui-card p-3"><MonthPicker disabled={!settings} label="查看月份" maxMonth={currentMonth()} minMonth={historyEnabled && settings ? shiftMonth(currentMonth(), -settings.historyMonths) : currentMonth()} onChange={setMonth} value={month} /></div>
    {status === 'loading' ? <LoadingState label="正在计算所选月份的预估工资" /> : null}
    {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
    {status === 'ready' && estimate ? <PayrollEstimateView estimate={estimate} /> : null}
  </>;
}

function PayslipPanel() {
  const auth = useAuth();
  const profileId = auth.profile?.id;
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<PayrollPayslip[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [confirming, setConfirming] = useState<PayrollPayslip | null>(null);
  const [feedback, setFeedback] = useState('');
  const selected = items.find((item) => item.id === params.get('payslip'));
  const load = useCallback(async () => {
    if (!supabase || !profileId) { setStatus('error'); return; }
    setStatus('loading');
    try { setItems(await loadMyPayrollPayslips(supabase, profileId)); setStatus('ready'); }
    catch { setStatus('error'); }
  }, [profileId]);
  useEffect(() => { void load(); }, [load]);
  const open = (id: string) => { const copy = new URLSearchParams(params); copy.set('tab','payslips'); copy.set('payslip',id); setParams(copy); };
  const close = () => { const copy = new URLSearchParams(params); copy.delete('payslip'); setParams(copy); };
  const confirm = async () => {
    if (!supabase || !confirming) return;
    const id = confirming.id; setConfirming(null);
    try {
      await confirmPayrollPayslip(supabase, id);
      setItems((current) => current.map((item) => item.id === id ? { ...item, status: 'confirmed', confirmed_at: new Date().toISOString() } : item));
      setFeedback('工资单已确认，对应待办已完成。');
      window.dispatchEvent(new Event('storehub:todos-changed'));
      window.dispatchEvent(new Event('storehub:notifications-changed'));
    } catch (error) { setFeedback(error instanceof Error ? error.message : '工资单确认失败，请稍后重试。'); }
  };
  if (selected) return <>
    <button className="ui-button-secondary" onClick={close} type="button">返回工资单列表</button>
    <SectionCard className="p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-brand-700">工资单状态</p><p className="mt-1 text-xs text-slate-500">发放于 {selected.issued_at ? new Date(selected.issued_at).toLocaleString('zh-CN') : '尚未发送'}</p></div><StatusBadge tone={selected.status === 'confirmed' ? 'success' : 'warning'}>{selected.status === 'confirmed' ? '已确认' : '待确认'}</StatusBadge></div></SectionCard>
    <PayrollStatementView adminNote={selected.admin_note} estimate={selected.estimate} payrollMonth={selected.payroll_month} />
    {selected.status === 'issued' ? <button className="ui-button-primary w-full" onClick={() => setConfirming(selected)} type="button">确认工资单内容</button> : <SectionCard className="border-emerald-200 bg-emerald-50 p-3 text-center text-sm font-bold text-emerald-800"><CheckCircle2 className="mr-1 inline h-4 w-4" />已于 {selected.confirmed_at ? new Date(selected.confirmed_at).toLocaleString('zh-CN') : '当前时间'} 确认</SectionCard>}
    <ConfirmDialog confirmLabel="确认工资单" onCancel={() => setConfirming(null)} onConfirm={() => void confirm()} open={Boolean(confirming)} title="确认工资单内容"><p>请确认已经核对本工资单的金额和明细。确认后，本月工资单待办将自动完成。</p></ConfirmDialog>
    <ActionFeedbackDialog message={feedback} onClose={() => setFeedback('')} open={Boolean(feedback)} title="工资单处理结果" tone="success" />
  </>;
  return <>
    {status === 'loading' ? <LoadingState label="正在加载工资单" /> : null}
    {status === 'error' ? <ErrorState message="暂时无法加载工资单。" onRetry={() => void load()} /> : null}
    {status === 'ready' && !items.length ? <EmptyState description="暂未推送" icon={FileText} title="暂无工资单" /> : null}
    {status === 'ready' ? <section className="space-y-2">{items.map((item) => <article className="ui-card p-4" key={item.id}><div className="flex items-start justify-between gap-3"><div><b>{monthLabel(item.payroll_month)}工资单</b><p className="mt-1 text-xs text-slate-500">发放：{item.issued_at ? new Date(item.issued_at).toLocaleString('zh-CN') : '尚未发送'}</p></div><StatusBadge tone={item.status === 'confirmed' ? 'success' : 'warning'}>{item.status === 'confirmed' ? '已确认' : '待确认'}</StatusBadge></div><div className="mt-3 flex items-end justify-between gap-3"><div><span className="text-xs text-slate-500">实发金额</span><strong className="mt-0.5 block text-xl tabular-nums">{formatMoney(item.estimate.dataComplete ? item.estimate.estimatedPayable : item.estimate.knownEstimatedPayable)}</strong></div><button className={item.status === 'issued' ? 'ui-button-primary' : 'ui-button-secondary'} onClick={() => open(item.id)} type="button">{item.status === 'issued' ? '查看并确认' : '查看工资单'}</button></div></article>)}</section> : null}
    <ActionFeedbackDialog message={feedback} onClose={() => setFeedback('')} open={Boolean(feedback)} title="工资单处理结果" tone="success" />
  </>;
}
