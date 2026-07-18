import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ErrorState, LoadingState } from '../components/ui/Feedback';
import { AttendanceMonthView } from '../features/attendance/AttendanceMonthView';
import { currentMonth, emptyAttendanceMonth, type AttendanceMonthDetail } from '../features/attendance/model';
import { supabase } from '../lib/supabase';
import { loadAttendanceMonth } from '../services/attendance.service';

export function AdminAttendanceDetailPage() {
  const { profileId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : currentMonth();
  const storeId = params.get('store') ?? '';
  const [name, setName] = useState('员工考勤详情');
  const [detail, setDetail] = useState<AttendanceMonthDetail>(emptyAttendanceMonth());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = useCallback(async () => {
    if (!supabase || !profileId) { setStatus('error'); return; }
    setStatus('loading');
    try {
      const [attendance, profile] = await Promise.all([loadAttendanceMonth(supabase, profileId, month, storeId), supabase.from('profiles').select('display_name').eq('id', profileId).single()]);
      setDetail(attendance); if (profile.data?.display_name) setName(`${profile.data.display_name}的考勤`); setStatus('ready');
    } catch { setStatus('error'); }
  }, [month, profileId, storeId]);
  useEffect(() => { void load(); }, [load]);
  return <PageShell eyebrow="考勤管理 · 月度详情" title={name} backTo="/app/admin/attendance" contentGapClassName="gap-3"><label className="ui-card block p-3 text-sm font-semibold text-slate-700">查看月份<input className="ui-input mt-1" max={`${currentMonth()}-01`} onChange={(event) => setParams({ month: event.target.value.slice(0, 7), ...(storeId ? { store: storeId } : {}) }, { replace: true })} type="date" value={`${month}-01`} /></label>{storeId ? <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800">当前详情仅统计所选门店</p> : <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800">当前详情统计全部授权门店</p>}{status === 'loading' ? <LoadingState label="正在加载员工考勤" /> : null}{status === 'error' ? <ErrorState message="暂时无法加载该员工考勤。" onRetry={() => void load()} /> : null}{status === 'ready' ? <AttendanceMonthView detail={detail} /> : null}</PageShell>;
}
