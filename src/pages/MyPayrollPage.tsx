import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { ErrorState, LoadingState } from '../components/ui/Feedback';
import { useAuth } from '../features/auth/AuthContext';
import { PayrollEstimateView } from '../features/payroll/PayrollEstimateView';
import { todayInChina, type PayrollEstimate } from '../features/payroll/model';
import { supabase } from '../lib/supabase';
import { loadMyPayrollEstimate, loadPayrollVisibilitySettings, type PayrollVisibilitySettings } from '../services/payroll.service';

const currentMonth = () => todayInChina().slice(0, 7);
const shiftMonth = (month: string, offset: number) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const lastDayOfMonth = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}`;
};

export function MyPayrollPage() {
  const auth = useAuth();
  const [estimate, setEstimate] = useState<PayrollEstimate | null>(null);
  const [settings, setSettings] = useState<PayrollVisibilitySettings | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const asOf = useMemo(() => month === currentMonth() ? todayInChina() : lastDayOfMonth(month), [month]);
  const load = useCallback(async () => {
    if (!supabase || !auth.profile) { setStatus('error'); setMessage('账号或服务配置尚未就绪。'); return; }
    setStatus('loading');
    try {
      const nextSettings = settings ?? await loadPayrollVisibilitySettings(supabase);
      setSettings(nextSettings);
      setEstimate(await loadMyPayrollEstimate(supabase, auth.profile.id, asOf));
      setStatus('ready'); setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : '暂时无法计算预估工资。'); setStatus('error'); }
  }, [asOf, auth.profile, settings]);
  useEffect(() => { void load(); }, [load]);
  const historyEnabled = Boolean(settings?.historyOpenNow && settings.historyMonths > 0);
  return <PageShell eyebrow="个人薪资" title="预估工资" backTo="/app/menu" contentGapClassName="gap-3">
    <label className="ui-card block p-3 text-sm font-semibold text-slate-700">查看月份<input className="ui-input mt-1" disabled={!settings} max={currentMonth()} min={historyEnabled && settings ? shiftMonth(currentMonth(), -settings.historyMonths) : currentMonth()} onChange={(event) => setMonth(event.target.value)} type="month" value={month} /></label>
    {settings ? <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs leading-5 text-brand-800">{settings.historyMonths === 0 ? '管理员暂未开放历史工资查看。' : settings.historyOpenNow ? `本月 ${settings.historyAvailableUntilDay} 日前，可查看前 ${settings.historyMonths} 个月的预估工资和明细。` : `本月历史工资查看期限已于 ${settings.historyAvailableUntilDay} 日结束；当前月份仍可正常查看。`}</p> : null}
    {status === 'loading' ? <LoadingState label="正在计算所选月份的预估工资" /> : null}
    {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
    {status === 'ready' && estimate ? <PayrollEstimateView estimate={estimate} /> : null}
  </PageShell>;
}
