import { useCallback, useEffect, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { ErrorState, LoadingState } from '../components/ui/Feedback';
import { PayrollEstimateView } from '../features/payroll/PayrollEstimateView';
import { todayInChina, type PayrollEstimate } from '../features/payroll/model';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadMyPayrollEstimate } from '../services/payroll.service';

export function MyPayrollPage() {
  const auth = useAuth();
  const [estimate, setEstimate] = useState<PayrollEstimate | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    if (!supabase || !auth.profile) { setStatus('error'); setMessage('账号或服务配置尚未就绪。'); return; }
    setStatus('loading');
    try { setEstimate(await loadMyPayrollEstimate(supabase, auth.profile.id, todayInChina())); setStatus('ready'); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : '暂时无法计算预估工资。'); setStatus('error'); }
  }, [auth.profile]);
  useEffect(() => { void load(); }, [load]);
  return <PageShell eyebrow="个人薪资" title="我的预估工资" backTo="/app/menu" contentGapClassName="gap-3">
    {status === 'loading' ? <LoadingState label="正在计算截至今日的预估工资" /> : null}
    {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
    {status === 'ready' && estimate ? <PayrollEstimateView estimate={estimate} /> : null}
  </PageShell>;
}

