import { AlertCircle, CheckCircle2, History, PackagePlus, Plus, Save, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { featureFlags } from '../config/featureFlags';
import { canOperateV2Modules } from '../features/access/roleCapabilities';
import { ArrivalImageSection } from '../features/arrivals/ArrivalImageSection';
import { ArrivalItemCard } from '../features/arrivals/ArrivalItemCard';
import { generateArrivalSummary, getArrivalValidationIssues } from '../features/arrivals/arrivalForm';
import { useArrivalDraft } from '../features/arrivals/useArrivalDraft';
import { useAuth } from '../features/auth/AuthContext';

const saveStatusLabel = {
  error: '保存失败',
  idle: '等待自动保存',
  saved: '草稿已保存',
  saving: '正在保存',
} as const;

export function ArrivalEntryPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const canOperate = featureFlags.arrivalEntry && canOperateV2Modules(auth.profile?.role);
  const draft = useArrivalDraft(canOperate ? auth.profile?.id : undefined, canOperate ? auth.store?.id : undefined);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const waybillImages = draft.images.filter((image) => image.image_type === 'waybill');
  const goodsImages = draft.images.filter((image) => image.image_type === 'goods');
  const summary = draft.form ? generateArrivalSummary(draft.form.items) : '';
  const validationIssues = useMemo(() => draft.form ? getArrivalValidationIssues({
    goodsImageCount: goodsImages.length,
    items: draft.form.items,
    uploadCount: draft.uploadCount,
    waybillImageCount: waybillImages.length,
  }) : ['草稿尚未加载。'], [draft.form, draft.uploadCount, goodsImages.length, waybillImages.length]);

  if (!featureFlags.arrivalEntry) {
    return (
      <PageShell eyebrow="V2 功能开关" title="到货上报入口未启用" backTo="/app">
        <div className="rounded-lg bg-white p-5 text-sm leading-6 text-slate-600 shadow-sm">当前环境已关闭 V2 到货入口。原有点货、订货和历史记录不受影响。</div>
      </PageShell>
    );
  }

  if (!canOperateV2Modules(auth.profile?.role)) {
    return (
      <PageShell eyebrow="V2 角色边界" title="当前账号不能执行到货上报" backTo="/app">
        <div className="rounded-lg bg-white p-5 shadow-sm"><p className="text-sm leading-6 text-slate-600">到货上报的门店执行端仅向员工和店长开放。管理员将在独立的到货中心查看消息、记录和每日汇总。</p></div>
      </PageShell>
    );
  }

  if (draft.loadStatus === 'loading') {
    return (
      <PageShell eyebrow="门店运营系统" title="到货上报" backTo="/app">
        <div className="space-y-3" aria-label="正在加载到货草稿">
          {[1, 2, 3].map((item) => <div className="h-32 animate-pulse rounded-lg bg-white shadow-sm" key={item} />)}
        </div>
      </PageShell>
    );
  }

  if (draft.loadStatus === 'error' || !draft.form || !draft.report) {
    return (
      <PageShell eyebrow="门店运营系统" title="到货上报加载失败" backTo="/app">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <p className="text-sm leading-6 text-red-700">{draft.message ?? '无法加载到货草稿，请检查网络和数据库 migration。'}</p>
          <button className="mt-4 min-h-12 w-full rounded-lg bg-brand-600 px-4 font-bold text-white" onClick={draft.reload} type="button">重新加载</button>
        </div>
      </PageShell>
    );
  }

  const saveManually = async () => {
    setActionMessage(null);
    try {
      await draft.saveNow();
      setActionMessage('草稿已保存。');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '保存草稿失败。');
    }
  };

  const confirmSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setActionMessage(null);
    try {
      const reportId = await draft.submit();
      setShowConfirm(false);
      navigate(`/app/arrivals/${reportId}/success`, { replace: true });
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '提交到货上报失败，请重试。');
      setShowConfirm(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell eyebrow="门店运营系统 · 门店执行" title="到货上报" backTo="/app">
      <section className="rounded-lg bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">当前门店</p>
            <h2 className="mt-1 font-bold text-slate-900">{auth.store?.name}</h2>
            <p className="mt-2 text-xs text-slate-500">到货编号：{draft.report.report_no}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${draft.saveStatus === 'error' ? 'bg-red-50 text-red-700' : draft.saveStatus === 'saved' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>
            {saveStatusLabel[draft.saveStatus]}
          </span>
        </div>
        <Link className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-100 px-4 font-bold text-slate-700" to="/app/arrivals/history">
          <History className="h-5 w-5" aria-hidden="true" />
          查看到货历史
        </Link>
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <PackagePlus className="h-5 w-5 text-brand-700" aria-hidden="true" />
          <h2 className="text-lg font-bold text-slate-900">到货信息</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">到货日期<input className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-brand-500" onChange={(event) => draft.updateField('arrivalDate', event.target.value)} type="date" value={draft.form.arrivalDate} /></label>
          <label className="text-sm font-semibold text-slate-700">到货时间<input className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-brand-500" onChange={(event) => draft.updateField('arrivalTime', event.target.value)} type="time" value={draft.form.arrivalTime} /></label>
        </div>
        <label className="mt-4 block text-sm font-semibold text-slate-700">快递公司或配送方式（选填）<input className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-brand-500" onChange={(event) => draft.updateField('carrierName', event.target.value)} placeholder="例如：顺丰 / 门店配送" value={draft.form.carrierName} /></label>
        <label className="mt-4 block text-sm font-semibold text-slate-700">快递单号（选填）<input className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-brand-500" onChange={(event) => draft.updateField('trackingNo', event.target.value)} placeholder="扫描或填写快递单号" value={draft.form.trackingNo} /></label>
      </section>

      <ArrivalImageSection imageType="waybill" images={waybillImages} onDelete={draft.deleteImage} onUpload={draft.addImage} prompt="请拍摄完整的快递面单或配送标签，确保关键信息清晰可见。" title="快递面单照片" />
      <ArrivalImageSection imageType="goods" images={goodsImages} onDelete={draft.deleteImage} onUpload={draft.addImage} prompt="请拆开包装后拍摄内部实际货品，确保货品和数量尽量清晰。" title="拆包货品照片" />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs font-semibold text-brand-700">结构化明细</p><h2 className="mt-1 text-lg font-bold text-slate-900">产品明细</h2></div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm">{draft.form.items.length} 个产品</span>
        </div>
        {draft.form.items.map((item, index) => (
          <ArrivalItemCard
            canRemove={draft.form!.items.length > 1}
            index={index}
            item={item}
            key={item.id}
            onChange={(next) => draft.updateItem(item.id, () => next)}
            onRemove={() => { if (window.confirm('确认删除这个产品吗？')) draft.removeItem(item.id); }}
            products={draft.products}
          />
        ))}
        <button className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-brand-600 bg-white px-4 font-bold text-brand-700" onClick={draft.addItem} type="button"><Plus className="h-5 w-5" aria-hidden="true" />添加产品</button>
      </section>

      <section className="rounded-lg bg-brand-50 p-4">
        <p className="text-xs font-semibold text-brand-700">系统自动生成</p>
        <h2 className="mt-1 font-bold text-slate-900">规范到货描述</h2>
        <p className="mt-3 text-sm leading-7 text-slate-700">{summary || '完整填写产品名称、数量和单位后，系统会自动生成描述。'}</p>
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <label className="block text-sm font-semibold text-slate-700">补充备注（选填）<textarea className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 p-3 outline-none focus:border-brand-500" onChange={(event) => draft.updateField('note', event.target.value)} placeholder="记录包装、数量或其他需要管理员注意的信息" value={draft.form.note} /></label>
      </section>

      {draft.message || actionMessage ? <p className="rounded-lg bg-red-50 p-4 text-sm leading-6 text-red-700">{actionMessage ?? draft.message}</p> : null}

      {validationIssues.length > 0 ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2"><AlertCircle className="h-5 w-5 text-amber-700" aria-hidden="true" /><h2 className="font-bold text-amber-950">提交前还需完成</h2></div>
          <ul className="mt-3 space-y-1 text-sm leading-6 text-amber-900">{validationIssues.map((issue) => <li key={issue}>• {issue}</li>)}</ul>
        </section>
      ) : (
        <p className="flex items-center gap-2 rounded-lg bg-brand-50 p-4 text-sm font-semibold text-brand-700"><CheckCircle2 className="h-5 w-5" aria-hidden="true" />信息完整，可以提交。</p>
      )}

      <div className="safe-bottom sticky bottom-20 z-10 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur">
        <button className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 font-bold text-slate-800 disabled:opacity-50" disabled={draft.saveStatus === 'saving'} onClick={() => void saveManually()} type="button"><Save className="h-5 w-5" aria-hidden="true" />保存草稿</button>
        <button className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 font-bold text-white disabled:bg-slate-300" disabled={validationIssues.length > 0 || submitting || draft.saveStatus === 'saving'} onClick={() => setShowConfirm(true)} type="button"><Send className="h-5 w-5" aria-hidden="true" />提交上报</button>
      </div>

      {showConfirm ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/45 p-4 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="arrival-confirm-title">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl">
            <h2 className="text-xl font-bold text-slate-900" id="arrival-confirm-title">确认提交到货上报</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-500">门店</dt><dd className="text-right font-semibold text-slate-900">{auth.store?.name}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">产品种类</dt><dd className="font-semibold text-slate-900">{draft.form.items.length}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">面单图片</dt><dd className="font-semibold text-slate-900">{waybillImages.length}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">货品图片</dt><dd className="font-semibold text-slate-900">{goodsImages.length}</dd></div>
            </dl>
            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">{summary}</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button className="min-h-12 rounded-lg border border-slate-200 font-bold text-slate-800" disabled={submitting} onClick={() => setShowConfirm(false)} type="button">返回修改</button>
              <button className="min-h-12 rounded-lg bg-brand-600 font-bold text-white disabled:bg-slate-300" disabled={submitting} onClick={() => void confirmSubmit()} type="button">{submitting ? '正在提交' : '确认提交'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
