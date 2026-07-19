import { CheckCircle2, Clock3, Pencil } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ActionFeedbackDialog, type ActionFeedbackTone } from '../components/feedback/ActionFeedbackDialog';
import { PageShell } from '../components/layout/PageShell';
import { ConfirmDialog } from '../components/ui/Actions';
import { EmptyState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { formatMoney, todayInChina } from '../features/payroll/model';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import {
  loadManagerOvertimeRequests,
  loadMyOvertimeRequests,
  loadOvertimeProfiles,
  reviewOvertimeRequest,
  submitOvertimeRequest,
  updateOvertimeRequest,
} from '../services/payroll.service';
import type { Database } from '../types/database';

type RequestRow = Database['public']['Tables']['payroll_overtime_requests']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type Feedback = { title: string; message: string; tone: ActionFeedbackTone };
type Tab = 'submit' | 'records';

const statusLabel: Record<RequestRow['status'], string> = {
  pending: '待审批', approved: '已通过', rejected: '已驳回', cancelled: '已取消',
};
const statusTone: Record<RequestRow['status'], 'success' | 'warning' | 'danger' | 'info'> = {
  pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'info',
};
const hourOptions = Array.from({ length: 13 }, (_, index) => index / 2);
const chinaDate = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const daysAgoInChina = (days: number) => chinaDate(new Date(Date.now() - days * 86_400_000));
const submittedDateInChina = (value: string) => chinaDate(new Date(value));

export function OvertimePage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'records' ? 'records' : 'submit';
  const isManager = auth.profile?.role === 'manager';
  const isPartTime = auth.profile?.employment_type === 'part_time';
  const workTerm = isPartTime ? '兼职工时' : '加班';
  const today = todayInChina();
  const earliestDate = daysAgoInChina(5);
  const [mine, setMine] = useState<RequestRow[]>([]);
  const [approvals, setApprovals] = useState<RequestRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [date, setDate] = useState(today);
  const [hours, setHours] = useState('');
  const [hoursOpen, setHoursOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [storeId, setStoreId] = useRememberedPageState('store', auth.store?.id ?? '');
  const [recordMonth, setRecordMonth] = useRememberedPageState('record-month', today.slice(0, 7));
  const [editingId, setEditingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ request: RequestRow; action: 'approved' | 'rejected' } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const setTab = (nextTab: Tab) => {
    const next = new URLSearchParams(params);
    next.set('tab', nextTab);
    setParams(next, { replace: true });
  };

  const load = useCallback(async () => {
    if (!supabase || !auth.profile) return;
    setStatus('loading');
    try {
      const [myRows, approvalRows] = await Promise.all([
        loadMyOvertimeRequests(supabase, auth.profile.id),
        isManager
          ? loadManagerOvertimeRequests(supabase, auth.availableStores.map((store) => store.id))
          : Promise.resolve([]),
      ]);
      const profileRows = await loadOvertimeProfiles(supabase, [
        ...myRows.map((item) => item.profile_id),
        ...approvalRows.map((item) => item.profile_id),
      ]);
      setMine(myRows);
      setApprovals(approvalRows);
      setProfiles(Object.fromEntries(profileRows.map((profile) => [profile.id, profile])));
      setStatus('ready');
    } catch (error) {
      setFeedback({ title: '加载失败', message: error instanceof Error ? error.message : `暂时无法加载${workTerm}记录。`, tone: 'danger' });
      setStatus('ready');
    }
  }, [auth.availableStores, auth.profile, isManager, workTerm]);

  useEffect(() => { void load(); }, [load]);

  const resetForm = () => {
    setDate(today);
    setHours('');
    setHoursOpen(false);
    setReason('');
    setStoreId(auth.store?.id ?? auth.availableStores[0]?.id ?? '');
    setEditingId('');
  };

  const submit = async () => {
    if (!supabase || !auth.profile || !storeId || !hours) {
      setFeedback({ title: `请完善${workTerm}信息`, message: `请选择门店、${workTerm}日期和${workTerm}小时。`, tone: 'warning' });
      return;
    }
    if (date < earliestDate || date > today) {
      setFeedback({ title: `${workTerm}日期不在可填范围`, message: `只能填报今天或过去 5 日内的${workTerm}。`, tone: 'warning' });
      return;
    }
    setBusy(true);
    try {
      const input = { storeId, overtimeDate: date, hours: Number(hours), reason: reason.trim() };
      if (editingId) await updateOvertimeRequest(supabase, editingId, input);
      else await submitOvertimeRequest(supabase, input);
      const reviewer = auth.profile.role === 'manager' ? '管理员' : '店长';
      setFeedback({
        title: editingId ? `${workTerm}修改已提交` : `${workTerm}申请已提交`,
        message: `申请已发送到${reviewer}待办，只有审批通过后才会计入${isPartTime ? '预估薪资' : '预估工资'}。`,
        tone: 'success',
      });
      resetForm();
      window.dispatchEvent(new Event('storehub:todos-changed'));
      await load();
    } catch (error) {
      setFeedback({ title: editingId ? '修改未完成' : '提交未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const beginEdit = (request: RequestRow) => {
    setEditingId(request.id);
    setStoreId(request.store_id);
    setDate(request.overtime_date);
    setHours(String(request.hours));
    setHoursOpen(false);
    setReason(request.reason);
    setTab('submit');
    window.scrollTo({ behavior: 'smooth', top: 0 });
  };

  const confirmReview = async () => {
    if (!supabase || !review) return;
    if (review.action === 'rejected' && !reviewNote.trim()) {
      const term = profiles[review.request.profile_id]?.employment_type === 'part_time' ? '兼职工时' : '加班';
      setFeedback({ title: '请填写驳回原因', message: `驳回${term}申请时必须说明原因。`, tone: 'warning' });
      return;
    }
    const copy = review;
    setReview(null);
    try {
      await reviewOvertimeRequest(supabase, copy.request.id, copy.action, reviewNote.trim());
      setReviewNote('');
      window.dispatchEvent(new Event('storehub:todos-changed'));
      const term = profiles[copy.request.profile_id]?.employment_type === 'part_time' ? '兼职工时' : '加班';
      setFeedback({
        title: copy.action === 'approved' ? `${term}申请已通过` : `${term}申请已驳回`,
        message: copy.action === 'approved' ? `审批时薪已经锁定，${term === '兼职工时' ? '兼职薪资' : '加班工资'}将计入员工预估工资。` : '员工会在通知中心看到驳回结果和原因。',
        tone: 'success',
      });
      await load();
    } catch (error) {
      setFeedback({ title: '审批未完成', message: error instanceof Error ? error.message : '请稍后重试。', tone: 'danger' });
    }
  };

  const pendingApprovals = approvals.filter((item) => (
    item.status === 'pending'
    && item.profile_id !== auth.profile?.id
    && profiles[item.profile_id]?.role === 'staff'
  ));
  const monthRows = useMemo(
    () => mine.filter((item) => item.overtime_date.startsWith(recordMonth)),
    [mine, recordMonth],
  );
  const approvedRows = monthRows.filter((item) => item.status === 'approved');
  const approvedHours = approvedRows.reduce((total, item) => total + Number(item.hours), 0);
  const approvedWage = approvedRows.reduce((total, item) => total + Number(item.hours) * Number(item.approved_hourly_rate ?? 0), 0);

  return <PageShell eyebrow="门店运营系统" title={isPartTime ? '兼职工时' : '加班管理'} backTo="/app/workbench" contentGapClassName="gap-3">
    <nav aria-label={isPartTime ? '兼职工时菜单' : '加班管理菜单'} className="ui-card grid grid-cols-2 gap-1 p-1.5">
      <button className={`min-h-10 rounded-lg text-sm font-bold ${tab === 'submit' ? 'bg-brand-700 text-white' : 'text-slate-600'}`} onClick={() => setTab('submit')} type="button">{isPartTime ? '兼职工时填报' : '加班填报'}</button>
      <button className={`min-h-10 rounded-lg text-sm font-bold ${tab === 'records' ? 'bg-brand-700 text-white' : 'text-slate-600'}`} onClick={() => setTab('records')} type="button">{isPartTime ? '兼职工时记录' : '加班记录'}</button>
    </nav>

    {tab === 'submit' ? <>
      {isManager ? <SectionCard>
        <SectionHeader icon={CheckCircle2} title="员工工时审批" description={`当前 ${pendingApprovals.length} 条待处理`} />
        <div className="mt-3 space-y-2">
          {pendingApprovals.map((item) => <article className="rounded-lg border border-amber-200 bg-amber-50 p-3" key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <div><b>{profiles[item.profile_id]?.display_name ?? '员工'}</b><p className="mt-1 text-sm text-slate-600">{item.overtime_date} · {item.hours} 小时 · {auth.availableStores.find((store) => store.id === item.store_id)?.short_name}</p>{item.reason ? <p className="mt-1 text-xs text-slate-500">{item.reason}</p> : null}</div>
              <StatusBadge tone="warning">待审批</StatusBadge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2"><button className="ui-button-secondary" onClick={() => setReview({ request: item, action: 'rejected' })} type="button">驳回</button><button className="ui-button-primary" onClick={() => setReview({ request: item, action: 'approved' })} type="button">通过</button></div>
          </article>)}
          {!pendingApprovals.length ? <p className="py-2 text-sm text-slate-500">当前没有待审批的员工工时申请。</p> : null}
        </div>
      </SectionCard> : null}

      <SectionCard>
        <SectionHeader icon={Clock3} title={editingId ? `修改${workTerm}申请` : `填写${workTerm}`} />
        {editingId ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">修改后会重新进入审批，原审批结果暂时失效。</p> : null}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-sm font-semibold">{isPartTime ? '兼职门店' : '加班门店'}<select className="ui-input mt-1" onChange={(event) => setStoreId(event.target.value)} value={storeId}>{auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
          <label className="text-sm font-semibold">{workTerm}日期<input className="ui-input mt-1" max={today} min={earliestDate} onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label>
          <fieldset className="col-span-2"><legend className="text-sm font-semibold">{workTerm}</legend><button aria-expanded={hoursOpen} className="ui-input mt-1 flex items-center justify-between text-left font-semibold" onClick={() => setHoursOpen((value) => !value)} type="button"><span>{hours ? `${hours} 小时` : `点击选择${workTerm}`}</span><span className="text-slate-400">{hoursOpen ? '收起' : '展开'}</span></button>{hoursOpen ? <div className="mt-2 grid grid-cols-3 gap-2">{hourOptions.map((value) => <button aria-pressed={hours === String(value)} className={`min-h-10 rounded-lg border text-sm font-bold ${hours === String(value) ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-200 bg-white text-slate-700'}`} key={value} onClick={() => { setHours(String(value)); setHoursOpen(false); }} type="button">{value} 小时</button>)}</div> : null}</fieldset>
        </div>
        <label className="mt-3 block text-sm font-semibold">{workTerm}说明（选填）<textarea className="ui-input mt-1 min-h-16 py-2" onChange={(event) => setReason(event.target.value)} placeholder={`可简要说明${workTerm}完成的工作`} value={reason} /></label>
        <div className={`mt-3 grid gap-2 ${editingId ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {editingId ? <button className="ui-button-secondary" onClick={resetForm} type="button">取消修改</button> : null}
          <button className="ui-button-primary w-full" disabled={busy} onClick={() => void submit()} type="button">{busy ? '正在提交' : editingId ? '提交修改申请' : `提交${workTerm}`}</button>
        </div>
      </SectionCard>
    </> : null}

    {tab === 'records' ? <>
      <label className="ui-card block p-3 text-sm font-semibold text-slate-700">查看月份<input className="ui-input mt-1" max={today.slice(0, 7)} onChange={(event) => setRecordMonth(event.target.value)} type="month" value={recordMonth} /></label>
      <section className="grid grid-cols-2 gap-2">
        <SectionCard className="p-3"><p className="text-xs font-semibold text-slate-500">本月{workTerm}汇总</p><b className="mt-1 block text-xl text-slate-900">{approvedHours} 小时</b><p className="mt-1 text-[11px] text-slate-500">申报 {monthRows.length} 次 · 通过 {approvedRows.length} 次</p></SectionCard>
        <SectionCard className="p-3"><p className="text-xs font-semibold text-slate-500">本月{isPartTime ? '兼职薪资' : '加班工资'}汇总</p><b className="mt-1 block text-xl text-brand-700">{formatMoney(approvedWage)}</b><p className="mt-1 text-[11px] text-slate-500">仅统计已审批通过记录</p></SectionCard>
      </section>
      <SectionCard>
        <SectionHeader title={`${workTerm}记录`} description={`修改申请后需要重新审批，审批通过后才计入${isPartTime ? '兼职薪资' : '工资'}。`} />
        {status === 'loading' ? <LoadingState label={`正在加载${workTerm}记录`} /> : <div className="mt-3 space-y-2">
          {monthRows.map((item) => {
            const editable = submittedDateInChina(item.created_at) >= earliestDate;
            return <article className="rounded-lg bg-slate-50 p-3" key={item.id}>
              <div className="flex items-start justify-between gap-3"><div><b>{item.overtime_date} · {item.hours} 小时</b><p className="mt-1 text-xs text-slate-500">{auth.availableStores.find((store) => store.id === item.store_id)?.short_name ?? '门店'}{item.reason ? ` · ${item.reason}` : ''}</p>{item.review_note ? <p className="mt-1 text-xs text-red-700">审批说明：{item.review_note}</p> : null}</div><StatusBadge tone={statusTone[item.status]}>{item.status === 'pending' ? auth.profile?.role === 'manager' ? '待管理员审批' : '待店长审批' : statusLabel[item.status]}</StatusBadge></div>
              {editable ? <button className="ui-button-secondary mt-2 min-h-9 w-full text-xs" onClick={() => beginEdit(item)} type="button"><Pencil className="h-3.5 w-3.5" />申请修改</button> : null}
            </article>;
          })}
          {!monthRows.length ? <EmptyState title={`本月暂无${workTerm}记录`} /> : null}
        </div>}
      </SectionCard>
    </> : null}

    <ConfirmDialog confirmLabel={review?.action === 'approved' ? '确认通过' : '确认驳回'} danger={review?.action === 'rejected'} onCancel={() => { setReview(null); setReviewNote(''); }} onConfirm={() => void confirmReview()} open={Boolean(review)} title={review ? `${review.action === 'approved' ? '确认通过' : '驳回'}${profiles[review.request.profile_id]?.employment_type === 'part_time' ? '兼职工时' : '加班'}申请` : ''}>
      <p className="text-sm text-slate-600">{review?.request.overtime_date} · {review?.request.hours} 小时</p>
      <label className="mt-3 block text-sm font-semibold">审批说明{review?.action === 'approved' ? '（选填）' : ''}<textarea className="ui-input mt-1 min-h-20 py-2" onChange={(event) => setReviewNote(event.target.value)} value={reviewNote} /></label>
    </ConfirmDialog>
    <ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone} />
  </PageShell>;
}
