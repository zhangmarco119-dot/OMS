import { useCallback, useEffect, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { ErrorState, LoadingState } from '../components/ui/Feedback';
import { AttendanceMonthView } from '../features/attendance/AttendanceMonthView';
import { currentMonth, emptyAttendanceMonth, type AttendanceMonthDetail } from '../features/attendance/model';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import { loadAttendanceMonth } from '../services/attendance.service';

export function MyAttendancePage() {
  const auth = useAuth();
  const [month, setMonth] = useRememberedPageState('month', currentMonth());
  const [detail, setDetail] = useState<AttendanceMonthDetail>(emptyAttendanceMonth());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    if (!supabase || !auth.profile) { setStatus('error'); setMessage('账号或服务配置尚未就绪。'); return; }
    setStatus('loading');
    try { setDetail(await loadAttendanceMonth(supabase, auth.profile.id, month)); setMessage(''); setStatus('ready'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '加载考勤失败。'); setStatus('error'); }
  }, [auth.profile, month]);
  useEffect(() => { void load(); }, [load]);
  return <PageShell eyebrow="个人考勤" title="我的考勤" backTo="/app/menu" contentGapClassName="gap-3">
    <label className="ui-card block p-3 text-sm font-semibold text-slate-700">查看月份<input className="ui-input mt-1" max={currentMonth()} onChange={(event) => setMonth(event.target.value)} type="month" value={month} /></label>
    {status === 'loading' ? <LoadingState label="正在加载月度考勤" /> : null}
    {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
    {status === 'ready' ? <AttendanceMonthView detail={detail} /> : null}
  </PageShell>;
}
