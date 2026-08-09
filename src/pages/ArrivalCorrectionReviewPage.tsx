import { Check, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { FeedbackBanner, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadArrivalCorrectionRequest, reviewArrivalCorrectionRequest } from '../services/arrivals.service';

type ReviewData = Awaited<ReturnType<typeof loadArrivalCorrectionRequest>>;

const formatTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export function ArrivalCorrectionReviewPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { requestId = '' } = useParams();
  const [data, setData] = useState<ReviewData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !['admin', 'manager'].includes(auth.profile?.role ?? '') || !requestId) {
      setStatus('error'); setMessage('当前账号不能审核到货更正申请。'); return;
    }
    setStatus('loading');
    try { setData(await loadArrivalCorrectionRequest(supabase, requestId)); setMessage(null); setStatus('ready'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '加载到货更正申请失败。'); setStatus('error'); }
  }, [auth.profile?.role, requestId]);
  useEffect(() => { void load(); }, [load]);

  const review = async (approve: boolean) => {
    if (!supabase || !data || busy) return;
    setBusy(true);
    try {
      await reviewArrivalCorrectionRequest(supabase, data.request.id, approve, note);
      window.dispatchEvent(new Event('storehub:todos-changed'));
      navigate('/app/todos', { replace: true });
    } catch (error) { setMessage(error instanceof Error ? error.message : '审核到货更正失败。'); }
    finally { setBusy(false); }
  };

  return <PageShell eyebrow="门店运营系统 · 到货审核" title="审核到货更正" backTo="/app/todos" contentGapClassName="gap-3">
    {status === 'loading' ? <LoadingState label="正在加载更正内容" /> : null}
    {status === 'error' ? <section className="ui-card p-5 text-sm text-red-700">{message}</section> : null}
    {status === 'ready' && data ? <>
      <section className="ui-card p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-brand-700">{data.report.report_no}</p><h2 className="mt-1 font-bold">{data.requesterName}提交的更正</h2></div><StatusBadge tone="warning">待审核</StatusBadge></div><p className="mt-2 text-sm text-slate-500">{data.request.requester_role === 'manager' ? '店长申请 · 仅管理员可审核' : '员工申请 · 店长或管理员可审核'} · {formatTime(data.request.created_at)}</p></section>
      {message ? <FeedbackBanner tone="danger">{message}</FeedbackBanner> : null}
      <section className="ui-card p-4"><h2 className="font-bold">基本信息更正</h2><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><Info label="到货日期" oldValue={data.report.arrival_date} value={data.request.proposed_fields.arrival_date} /><Info label="到货时间" oldValue={data.report.arrival_time?.slice(0, 5) ?? '—'} value={data.request.proposed_fields.arrival_time?.slice(0, 5) ?? '—'} /><Info label="配送方" oldValue={data.report.carrier_name ?? '—'} value={data.request.proposed_fields.carrier_name ?? '—'} /><Info label="快递单号" oldValue={data.report.tracking_no ?? '—'} value={data.request.proposed_fields.tracking_no ?? '—'} /></dl><div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><span className="text-xs text-slate-500">更正后备注</span><p className="mt-1">{data.request.proposed_fields.note || '—'}</p></div></section>
      <section className="ui-card p-4"><h2 className="font-bold">更正后的产品明细</h2><div className="mt-3 space-y-2">{data.request.proposed_items.map((item, index) => <div className="rounded-lg bg-slate-50 p-3" key={item.id}><div className="flex justify-between gap-3"><b>{index + 1}. {item.product_name_snapshot}</b><b className="text-brand-700">{item.quantity} {item.unit}</b></div>{item.note ? <p className="mt-1 text-xs text-slate-500">{item.note}</p> : null}</div>)}</div></section>
      <section className="ui-card p-4"><label className="block text-sm font-semibold">审核备注 / 拒绝原因（选填）<textarea className="ui-input mt-1 min-h-24 py-2" onChange={(event) => setNote(event.target.value)} value={note} /></label><div className="mt-3 grid grid-cols-2 gap-3"><button className="ui-button-secondary text-red-700" disabled={busy} onClick={() => void review(false)} type="button"><X className="h-5 w-5" />拒绝更正</button><button className="ui-button-primary" disabled={busy} onClick={() => void review(true)} type="button"><Check className="h-5 w-5" />同意并写入</button></div></section>
    </> : null}
  </PageShell>;
}

function Info({ label, oldValue, value }: { label: string; oldValue: string; value: string }) {
  const changed = oldValue !== value;
  return <div><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className={changed ? 'mt-1 font-bold text-brand-700' : 'mt-1 font-medium'}>{value}</dd>{changed ? <p className="mt-0.5 text-[11px] text-slate-400 line-through">原：{oldValue}</p> : null}</div>;
}
