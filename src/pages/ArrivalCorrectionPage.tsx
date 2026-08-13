import { Plus, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ConfirmDialog, MobileActionBar } from '../components/ui/Actions';
import { FeedbackBanner, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { arrivalDraftItemSchema, createEmptyArrivalItem, type ArrivalDraftItem } from '../features/arrivals/arrivalForm';
import { applyAiArrivalDraftPatch, type ArrivalCorrectionDraft } from '../features/ai-review/arrivalAiDraftPatch';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import type { Json } from '../types/database';
import {
  adminUpdateArrivalReport,
  loadArrivalCorrectionEditor,
  loadLatestArrivalCorrection,
  submitArrivalCorrectionRequest,
  type ArrivalCorrectionEditorData,
  type ArrivalCorrectionFields,
  type ProductRow,
} from '../services/arrivals.service';

type CorrectionForm = ArrivalCorrectionDraft;

const createForm = (data: ArrivalCorrectionEditorData): CorrectionForm => ({
  fields: {
    arrival_date: data.report.arrival_date,
    arrival_time: data.report.arrival_time?.slice(0, 5) ?? null,
    carrier_name: data.report.carrier_name,
    note: data.report.note,
    tracking_no: data.report.tracking_no,
  },
  items: data.items,
});

export function ArrivalCorrectionPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { reportId = '' } = useParams();
  const [data, setData] = useState<ArrivalCorrectionEditorData | null>(null);
  const [form, setForm] = useState<CorrectionForm | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isAdmin = auth.profile?.role === 'admin';
  const detailPath = isAdmin ? `/app/admin/arrivals/${reportId}` : `/app/arrivals/${reportId}`;

  const load = useCallback(async () => {
    if (!supabase || !reportId || !['staff', 'manager', 'admin'].includes(auth.profile?.role ?? '')) {
      setStatus('error');
      setMessage('当前账号不能修改到货信息。');
      return;
    }
    setStatus('loading');
    try {
      const [editor, latest] = await Promise.all([
        loadArrivalCorrectionEditor(supabase, reportId),
        loadLatestArrivalCorrection(supabase, reportId),
      ]);
      const hasStoreAccess = auth.availableStores.some((store) => store.id === editor.report.store_id);
      const canEdit = hasStoreAccess
        && ['submitted', 'viewed'].includes(editor.report.status)
        && (isAdmin || auth.profile?.role === 'manager' || editor.report.reported_by === auth.profile?.id);
      if (!canEdit) throw new Error('员工只能修改自己提交的到货信息；店长和管理员可以修改授权门店的到货信息。');
      setData(editor);
      const routeState = location.state as { aiDraftPatch?: unknown; aiModifiedValue?: Json; aiSuggestionId?: string } | null;
      const adminAiRouteState = isAdmin ? routeState : null;
      setForm(adminAiRouteState?.aiDraftPatch
        ? applyAiArrivalDraftPatch(createForm(editor), adminAiRouteState.aiDraftPatch, adminAiRouteState.aiModifiedValue, editor.products)
        : createForm(editor));
      setHasPendingRequest(latest?.status === 'pending');
      setMessage(null);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载到货更正页面失败。');
      setStatus('error');
    }
  }, [auth.availableStores, auth.profile?.id, auth.profile?.role, isAdmin, location.state, reportId]);

  useEffect(() => { void load(); }, [load]);

  const updateField = (key: keyof ArrivalCorrectionFields, value: string) => {
    setForm((current) => current ? { ...current, fields: { ...current.fields, [key]: value || null } } : current);
  };
  const updateItem = (id: string, next: ArrivalDraftItem) => {
    setForm((current) => current ? { ...current, items: current.items.map((item) => item.id === id ? next : item) } : current);
  };
  const selectProduct = (item: ArrivalDraftItem, product: ProductRow | undefined) => {
    if (!product) {
      updateItem(item.id, { ...item, isUnmatchedProduct: true, productId: null });
      return;
    }
    updateItem(item.id, {
      ...item,
      isUnmatchedProduct: false,
      productId: product.id,
      productName: product.name,
      spec: product.spec,
      unit: product.count_unit,
    });
  };

  const validationIssues = !form ? ['更正内容尚未加载。'] : [
    ...(!form.fields.arrival_date ? ['请选择到货日期。'] : []),
    ...form.items.flatMap((item, index) => {
      const parsed = arrivalDraftItemSchema.safeParse(item);
      return parsed.success ? [] : [`产品 ${index + 1}：${parsed.error.issues[0]?.message ?? '信息不完整。'}`];
    }),
    ...(form.items.length === 0 ? ['至少保留一个产品。'] : []),
  ];

  const submit = async () => {
    if (!supabase || !data || !form || submitting || validationIssues.length > 0) return;
    setSubmitting(true);
    try {
      if (isAdmin) await adminUpdateArrivalReport(supabase, data.report.id, form.fields, form.items);
      else await submitArrivalCorrectionRequest(supabase, data.report.id, form.fields, form.items);
      window.dispatchEvent(new Event('storehub:todos-changed'));
      navigate(`${detailPath}?correction=${isAdmin ? 'updated' : 'submitted'}`, { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交到货更正申请失败。');
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  };

  return <PageShell eyebrow={`门店运营系统 · ${isAdmin ? '管理员更正' : '到货更正'}`} title="修改到货信息" backTo={detailPath} contentGapClassName="gap-3">
    {status === 'loading' ? <LoadingState label="正在加载到货信息" /> : null}
    {status === 'error' ? <section className="ui-card p-5"><p className="text-sm text-red-700">{message}</p><button className="ui-button-secondary mt-3 w-full" onClick={() => void load()} type="button">重新加载</button></section> : null}
    {status === 'ready' && data && form ? <>
      <section className="ui-card p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-brand-700">{data.report.report_no}</p><h2 className="mt-1 font-bold">{data.report.reporter_name_snapshot}提交的到货记录</h2></div><StatusBadge tone={isAdmin ? 'success' : 'warning'}>{isAdmin ? '管理员直接修改' : '更正后需审核'}</StatusBadge></div>
        <p className="mt-3 text-sm leading-6 text-slate-600">这里只修改文字和产品明细，原有面单及拆包照片会保留。{isAdmin ? '保存后将立即写入正式到货记录。' : '审核通过前，历史记录不会发生变化。'}</p>
      </section>
      {isAdmin && (location.state as { aiSuggestionId?: string } | null)?.aiSuggestionId ? <FeedbackBanner title="已带入 AI 建议" tone="info">建议只填入当前更正草稿，尚未修改正式到货记录。请逐项核对后再使用原保存按钮。</FeedbackBanner> : null}
      {hasPendingRequest ? <FeedbackBanner title="已有待审核更正" tone="warning">当前记录已经有一份待审核申请，请等待审核完成后再提交新的更正。</FeedbackBanner> : null}
      {message ? <FeedbackBanner tone="danger">{message}</FeedbackBanner> : null}
      <section className="ui-card p-4">
        <h2 className="font-bold">到货基本信息</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-sm font-semibold">到货日期<input className="ui-input mt-1" onChange={(event) => updateField('arrival_date', event.target.value)} type="date" value={form.fields.arrival_date} /></label>
          <label className="text-sm font-semibold">到货时间<input className="ui-input mt-1" onChange={(event) => updateField('arrival_time', event.target.value)} type="time" value={form.fields.arrival_time ?? ''} /></label>
        </div>
        <label className="mt-3 block text-sm font-semibold">配送方（选填）<input className="ui-input mt-1" onChange={(event) => updateField('carrier_name', event.target.value)} value={form.fields.carrier_name ?? ''} /></label>
        <label className="mt-3 block text-sm font-semibold">快递单号（选填）<input className="ui-input mt-1" onChange={(event) => updateField('tracking_no', event.target.value)} value={form.fields.tracking_no ?? ''} /></label>
        <label className="mt-3 block text-sm font-semibold">备注（选填）<textarea className="ui-input mt-1 min-h-20 py-2" onChange={(event) => updateField('note', event.target.value)} value={form.fields.note ?? ''} /></label>
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-bold">产品明细</h2><span className="text-xs text-slate-500">{form.items.length} 项</span></div>
        {form.items.map((item, index) => <article className="ui-card p-4" key={item.id}>
          <div className="flex items-center justify-between"><b>产品 {index + 1}</b><button aria-label={`删除产品 ${index + 1}`} className="ui-icon-button text-red-700" disabled={form.items.length <= 1} onClick={() => setForm((current) => current ? { ...current, items: current.items.filter((entry) => entry.id !== item.id).map((entry, nextIndex) => ({ ...entry, sortOrder: nextIndex })) } : current)} type="button"><Trash2 className="h-4 w-4" /></button></div>
          <label className="mt-3 block text-sm font-semibold">选择本店货品<select className="ui-input mt-1" onChange={(event) => selectProduct(item, data.products.find((product) => product.id === event.target.value))} value={item.productId ?? ''}><option value="">手动填写 / 未匹配货品</option>{data.products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.spec || '无规格'}</option>)}</select></label>
          <label className="mt-3 block text-sm font-semibold">产品名称<input className="ui-input mt-1" onChange={(event) => updateItem(item.id, { ...item, isUnmatchedProduct: true, productId: null, productName: event.target.value, spec: '' })} value={item.productName} /></label>
          <div className="mt-3 grid grid-cols-2 gap-3"><label className="text-sm font-semibold">数量<input className="ui-input mt-1" inputMode="decimal" min="0" onChange={(event) => updateItem(item.id, { ...item, quantity: event.target.value })} step="0.001" type="number" value={item.quantity} /></label><label className="text-sm font-semibold">单位<input className="ui-input mt-1" onChange={(event) => updateItem(item.id, { ...item, unit: event.target.value })} value={item.unit} /></label></div>
          <label className="mt-3 block text-sm font-semibold">产品备注（选填）<input className="ui-input mt-1" onChange={(event) => updateItem(item.id, { ...item, note: event.target.value })} value={item.note} /></label>
        </article>)}
        <button className="ui-button-secondary w-full" onClick={() => setForm((current) => current ? { ...current, items: [...current.items, createEmptyArrivalItem(current.items.length)] } : current)} type="button"><Plus className="h-5 w-5" />添加产品</button>
      </section>
      {validationIssues.length > 0 ? <FeedbackBanner title="请完善更正内容" tone="warning">{validationIssues[0]}</FeedbackBanner> : null}
      <MobileActionBar><button className="ui-button-primary w-full" disabled={hasPendingRequest || submitting || validationIssues.length > 0} onClick={() => setConfirming(true)} type="button"><Send className="h-5 w-5" />{isAdmin ? '保存到货更正' : '提交更正审核'}</button></MobileActionBar>
      <ConfirmDialog confirmLabel={submitting ? '正在保存' : isAdmin ? '确认保存' : '确认提交审核'} onCancel={() => setConfirming(false)} onConfirm={() => void submit()} open={confirming} title={isAdmin ? '保存到货更正？' : '提交到货更正申请？'}><p>{isAdmin ? '保存后会立即更新正式到货记录，原有照片保持不变。' : auth.profile?.role === 'manager' ? '店长提交的更正将由管理员审核，审核通过后写入到货记录。' : '更正将由店长或管理员审核，审核通过后写入到货记录。'}</p></ConfirmDialog>
    </> : null}
  </PageShell>;
}
