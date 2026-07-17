import { CheckCircle2, Clock3 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ActionFeedbackDialog, type ActionFeedbackTone } from '../components/feedback/ActionFeedbackDialog';
import { PageShell } from '../components/layout/PageShell';
import { ConfirmDialog } from '../components/ui/Actions';
import { EmptyState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { todayInChina } from '../features/payroll/model';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadManagerOvertimeRequests, loadMyOvertimeRequests, loadOvertimeProfiles, reviewOvertimeRequest, submitOvertimeRequest } from '../services/payroll.service';
import type { Database } from '../types/database';

type RequestRow = Database['public']['Tables']['payroll_overtime_requests']['Row'];
type Feedback = { title: string; message: string; tone: ActionFeedbackTone };
const statusLabel: Record<RequestRow['status'], string> = { pending: '待店长审批', approved: '已通过', rejected: '已驳回', cancelled: '已取消' };
const statusTone: Record<RequestRow['status'], 'success' | 'warning' | 'danger' | 'info'> = { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'info' };

export function OvertimePage() {
  const auth = useAuth();
  const isManager = auth.profile?.role === 'manager';
  const [mine, setMine] = useState<RequestRow[]>([]);
  const [approvals, setApprovals] = useState<RequestRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [date, setDate] = useState(todayInChina());
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [storeId, setStoreId] = useState(auth.store?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ request: RequestRow; action: 'approved' | 'rejected' } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !auth.profile) return;
    setStatus('loading');
    try {
      const [myRows, approvalRows] = await Promise.all([
        loadMyOvertimeRequests(supabase, auth.profile.id),
        isManager ? loadManagerOvertimeRequests(supabase, auth.availableStores.map((store) => store.id)) : Promise.resolve([]),
      ]);
      const profiles = isManager ? await loadOvertimeProfiles(supabase, approvalRows.map((item) => item.profile_id)) : [];
      setMine(myRows); setApprovals(approvalRows); setNames(Object.fromEntries(profiles.map((profile) => [profile.id, profile.display_name]))); setStatus('ready');
    } catch (error) { setFeedback({ title: '加载失败', message: error instanceof Error ? error.message : '暂时无法加载加班记录。', tone: 'danger' }); setStatus('ready'); }
  }, [auth.availableStores, auth.profile, isManager]);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!supabase || !auth.profile || !storeId || !hours || Number(hours) <= 0 || !reason.trim()) { setFeedback({ title: '请完善加班信息', message: '门店、加班日期、加班小时和加班说明不能为空。', tone: 'warning' }); return; }
    setBusy(true);
    try {
      await submitOvertimeRequest(supabase, { storeId, overtimeDate: date, hours: Number(hours), reason: reason.trim() });
      setHours(''); setReason(''); window.dispatchEvent(new Event('storehub:todos-changed'));
      setFeedback({ title: '加班申请已提交', message: '申请已发送到店长待办，只有审批通过后才会计入预估工资。', tone: 'success' });
      await load();
    } catch (error) { setFeedback({ title: '提交未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' }); }
    finally { setBusy(false); }
  };

  const confirmReview = async () => {
    if (!supabase || !review) return;
    if (review.action === 'rejected' && !reviewNote.trim()) { setFeedback({ title: '请填写驳回原因', message: '驳回加班申请时必须说明原因。', tone: 'warning' }); return; }
    const copy = review; setReview(null);
    try { await reviewOvertimeRequest(supabase, copy.request.id, copy.action, reviewNote.trim()); setReviewNote(''); window.dispatchEvent(new Event('storehub:todos-changed')); setFeedback({ title: copy.action === 'approved' ? '加班申请已通过' : '加班申请已驳回', message: copy.action === 'approved' ? '审批时薪已经锁定，该加班金额将计入员工预估工资。' : '员工会在通知中心看到驳回结果和原因。', tone: 'success' }); await load(); }
    catch (error) { setFeedback({ title: '审批未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' }); }
  };

  const pending = approvals.filter((item) => item.status === 'pending' && item.profile_id !== auth.profile?.id);
  return <PageShell eyebrow="门店运营系统" title="加班填报" backTo="/app/workbench" contentGapClassName="gap-3">
    {isManager ? <SectionCard><SectionHeader icon={CheckCircle2} title="加班审批" description={`当前 ${pending.length} 条待处理`} /><div className="mt-3 space-y-2">{pending.map((item) => <article className="rounded-lg border border-amber-200 bg-amber-50 p-3" key={item.id}><div className="flex items-start justify-between gap-3"><div><b>{names[item.profile_id] ?? '员工'}</b><p className="mt-1 text-sm text-slate-600">{item.overtime_date} · {item.hours} 小时 · {auth.availableStores.find((store) => store.id === item.store_id)?.short_name}</p><p className="mt-1 text-xs text-slate-500">{item.reason}</p></div><StatusBadge tone="warning">待审批</StatusBadge></div><div className="mt-3 grid grid-cols-2 gap-2"><button className="ui-button-secondary" onClick={() => setReview({ request: item, action: 'rejected' })} type="button">驳回</button><button className="ui-button-primary" onClick={() => setReview({ request: item, action: 'approved' })} type="button">通过</button></div></article>)}{!pending.length ? <p className="py-2 text-sm text-slate-500">当前没有待审批的加班申请。</p> : null}</div></SectionCard> : null}

    <SectionCard><SectionHeader icon={Clock3} title="填写加班申请" description="默认按 25 元/小时，实际金额以店长审批时生效的后台时薪为准。" /><div className="mt-3 grid grid-cols-2 gap-2"><label className="text-sm font-semibold">加班门店<select className="ui-input mt-1" onChange={(event) => setStoreId(event.target.value)} value={storeId}>{auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label className="text-sm font-semibold">加班日期<input className="ui-input mt-1" max={todayInChina()} onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label><label className="text-sm font-semibold">加班小时<input className="ui-input mt-1" max="16" min="0.25" onChange={(event) => setHours(event.target.value)} step="0.25" type="number" value={hours} /></label></div><label className="mt-3 block text-sm font-semibold">加班说明<textarea className="ui-input mt-1 min-h-20 py-2" onChange={(event) => setReason(event.target.value)} placeholder="说明加班完成的工作" value={reason} /></label><button className="ui-button-primary mt-3 w-full" disabled={busy} onClick={() => void submit()} type="button">{busy ? '正在提交' : '提交加班申请'}</button></SectionCard>

    <SectionCard><SectionHeader title="我的加班记录" description="只有“已通过”的小时会计入预估工资。" />{status === 'loading' ? <LoadingState label="正在加载加班记录" /> : <div className="mt-3 space-y-2">{mine.map((item) => <article className="rounded-lg bg-slate-50 p-3" key={item.id}><div className="flex items-start justify-between gap-3"><div><b>{item.overtime_date} · {item.hours} 小时</b><p className="mt-1 text-xs text-slate-500">{item.reason}</p>{item.review_note ? <p className="mt-1 text-xs text-red-700">审批说明：{item.review_note}</p> : null}</div><StatusBadge tone={statusTone[item.status]}>{statusLabel[item.status]}</StatusBadge></div></article>)}{!mine.length ? <EmptyState title="暂无加班记录" /> : null}</div>}</SectionCard>
    <ConfirmDialog confirmLabel={review?.action === 'approved' ? '确认通过' : '确认驳回'} danger={review?.action === 'rejected'} onCancel={() => { setReview(null); setReviewNote(''); }} onConfirm={() => void confirmReview()} open={Boolean(review)} title={review?.action === 'approved' ? '确认通过加班申请' : '驳回加班申请'}><p className="text-sm text-slate-600">{review?.request.overtime_date} · {review?.request.hours} 小时</p><label className="mt-3 block text-sm font-semibold">审批说明{review?.action === 'approved' ? '（选填）' : ''}<textarea className="ui-input mt-1 min-h-20 py-2" onChange={(event) => setReviewNote(event.target.value)} value={reviewNote} /></label></ConfirmDialog>
    <ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone} />
  </PageShell>;
}
