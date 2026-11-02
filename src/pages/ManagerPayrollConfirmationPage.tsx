import { CheckCircle2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { PageShell } from '../components/layout/PageShell';
import { ConfirmDialog } from '../components/ui/Actions';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { SectionCard } from '../components/ui/Surface';
import { PayrollStatementView } from '../features/payroll/PayrollStatementView';
import { supabase } from '../lib/supabase';
import { confirmDelegatedPayrollPayslip, loadDelegatedPayrollPayslip, type PayrollPayslip } from '../services/payroll.service';

export function ManagerPayrollConfirmationPage() {
  const { payslipId = '' } = useParams();
  const [item, setItem] = useState<PayrollPayslip | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState('');
  const load = useCallback(async () => {
    if (!supabase || !payslipId) { setStatus('error'); return; }
    setStatus('loading');
    try { setItem(await loadDelegatedPayrollPayslip(supabase, payslipId)); setStatus('ready'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '暂时无法加载工资单。'); setStatus('error'); }
  }, [payslipId]);
  useEffect(() => { void load(); }, [load]);
  const confirm = async () => {
    if (!supabase || !item) return;
    setConfirming(false);
    try {
      await confirmDelegatedPayrollPayslip(supabase, item.id);
      setItem((current) => current ? { ...current, confirmed_at: new Date().toISOString(), status: 'confirmed' } : current);
      setSuccess('工资单已代为确认，管理员已收到需要阅读的提醒。');
      window.dispatchEvent(new Event('storehub:todos-changed'));
      window.dispatchEvent(new Event('storehub:notifications-changed'));
    } catch (error) { setMessage(error instanceof Error ? error.message : '工资单确认失败，请稍后重试。'); }
  };

  return <PageShell backTo="/app/todos" contentGapClassName="gap-3" eyebrow="门店运营系统 · 店长" title="确认员工工资单">
    {status === 'loading' ? <LoadingState label="正在加载待确认工资单" /> : null}
    {status === 'error' ? <ErrorState message={message || '暂时无法加载工资单。'} onRetry={() => void load()} /> : null}
    {status === 'ready' && !item ? <EmptyState description="该工资单可能已撤回、未指派给当前账号，或当前账号没有查看权限。" title="没有可确认的工资单" /> : null}
    {item ? <>
      <SectionCard className="border-amber-200 bg-amber-50 p-4"><div className="flex items-start justify-between gap-3"><div><b className="text-slate-900">请先在线下与员工完成核对</b><p className="mt-1 text-sm leading-6 text-slate-600">确认员工认可下方全部工资明细后，再点击“确认薪资”。系统会记录由店长代为确认并提醒管理员阅读。</p></div><StatusBadge tone={item.status === 'confirmed' ? 'success' : 'warning'}>{item.status === 'confirmed' ? '已确认' : '待店长确认'}</StatusBadge></div></SectionCard>
      <PayrollStatementView adminNote={item.admin_note} estimate={item.estimate} payrollMonth={item.payroll_month} />
      {item.status === 'issued' ? <button className="ui-button-primary w-full" onClick={() => setConfirming(true)} type="button">已与员工核对，确认薪资</button> : <SectionCard className="border-emerald-200 bg-emerald-50 p-3 text-center text-sm font-bold text-emerald-800"><CheckCircle2 className="mr-1 inline h-4 w-4" />已由店长确认</SectionCard>}
    </> : null}
    <ConfirmDialog confirmLabel="确认薪资" onCancel={() => setConfirming(false)} onConfirm={() => void confirm()} open={confirming} title="确认已完成线下核对"><p>此操作表示你已将工资单交给该员工核对，并确认员工认可全部明细。确认后管理员会收到提醒。</p></ConfirmDialog>
    <ActionFeedbackDialog message={success || message} onClose={() => { setSuccess(''); setMessage(''); }} open={Boolean(success || (status === 'ready' && message))} title={success ? '工资单已确认' : '工资单处理未完成'} tone={success ? 'success' : 'warning'} />
  </PageShell>;
}
