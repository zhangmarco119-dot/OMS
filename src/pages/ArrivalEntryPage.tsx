import { AlertCircle, History, PackagePlus, Plus, RefreshCcw, Save, Send } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ConfirmDialog, MobileActionBar } from '../components/ui/Actions';
import { featureFlags } from '../config/featureFlags';
import { canOperateV2Modules } from '../features/access/roleCapabilities';
import { ArrivalImageSection } from '../features/arrivals/ArrivalImageSection';
import { ArrivalItemCard } from '../features/arrivals/ArrivalItemCard';
import { generateArrivalSummary, getArrivalValidationIssues } from '../features/arrivals/arrivalForm';
import { useArrivalDraft } from '../features/arrivals/useArrivalDraft';
import { useAuth } from '../features/auth/AuthContext';
import { PRODUCT_CATEGORIES, DEFAULT_PRODUCT_CATEGORY, type ProductCategoryCode } from '../features/products/productCategories';
import type { ArrivalProductCreationRequestInput } from '../services/arrivals.service';

const saveStatusLabel = {
  error: '保存失败',
  idle: '等待自动保存',
  saved: '草稿已保存',
  saving: '正在保存',
} as const;

export function ArrivalEntryPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reportId = searchParams.get('reportId') ?? undefined;
  const canOperate = featureFlags.arrivalEntry && canOperateV2Modules(auth.profile?.role);
  const draft = useArrivalDraft(canOperate ? auth.profile?.id : undefined, canOperate ? auth.store?.id : undefined, reportId);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [showUnmatchedDialog, setShowUnmatchedDialog] = useState(false);
  const [productRequests, setProductRequests] = useState<ArrivalProductCreationRequestInput[]>([]);
  const [productRequestIssues, setProductRequestIssues] = useState<string[]>([]);
  const [productRequestMessage, setProductRequestMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const waybillImages = draft.images.filter((image) => image.image_type === 'waybill');
  const goodsImages = draft.images.filter((image) => image.image_type === 'goods');
  const summary = draft.form ? generateArrivalSummary(draft.form.items) : '';
  const validationIssues = draft.form ? getArrivalValidationIssues({
    goodsImageItemIds: goodsImages
      .filter((image) => image.arrival_item_id)
      .map((image) => image.arrival_item_id as string),
    items: draft.form.items,
    uploadCount: draft.uploadCount,
    waybillImageCount: waybillImages.length,
  }) : ['草稿尚未加载。'];

  if (!featureFlags.arrivalEntry) {
    return (
      <PageShell eyebrow="功能设置" title="到货上报入口未启用" backTo="/app">
        <div className="rounded-lg bg-white p-5 text-sm leading-6 text-slate-600 shadow-sm">当前环境已关闭到货上报入口。点货、订货和历史记录不受影响。</div>
      </PageShell>
    );
  }

  if (!canOperateV2Modules(auth.profile?.role)) {
    return (
      <PageShell eyebrow="账号权限" title="当前账号不能执行到货上报" backTo="/app">
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

  const resetCurrentDraft = async () => {
    if (resetting) return;
    setResetting(true);
    setActionMessage(null);
    try {
      await draft.resetDraft();
      setShowResetConfirm(false);
      setActionMessage('草稿已更新为当前时间，原有内容和图片已清空。');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '更新草稿失败。');
    } finally {
      setResetting(false);
    }
  };

  const confirmSubmit = async (requests: ArrivalProductCreationRequestInput[] = []) => {
    if (submitting) return;
    setSubmitting(true);
    setActionMessage(null);
    setProductRequestMessage(null);
    try {
      const reportId = await draft.submit(requests);
      setShowConfirm(false);
      setShowUnmatchedDialog(false);
      navigate(`/app/arrivals/${reportId}/success`, { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : '提交到货上报失败，请重试。';
      if (requests.length > 0) {
        setProductRequestMessage(message);
      } else {
        setActionMessage(message);
        setShowConfirm(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const requestSubmit = () => {
    if (validationIssues.length > 0) {
      setShowValidationDialog(true);
      return;
    }
    const unmatchedItems = draft.form?.items.filter((item) => item.isUnmatchedProduct || !item.productId) ?? [];
    const normalizedName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
    const duplicate = unmatchedItems
      .map((item) => ({
        existing: draft.products.find((product) => normalizedName(product.name) === normalizedName(item.productName)),
        item,
      }))
      .find((entry) => entry.existing);
    if (duplicate?.existing) {
      setActionMessage(`货品列表中已有货品“${duplicate.existing.name}”，不可以重复新增。请在产品名称的搜索结果中选择已有货品。`);
      return;
    }
    if (unmatchedItems.length > 0) {
      setProductRequests(unmatchedItems.map((item) => ({
        arrivalItemId: item.id,
        categoryCode: DEFAULT_PRODUCT_CATEGORY,
        countUnit: item.unit,
        name: item.productName,
        specification: item.spec,
      })));
      setProductRequestIssues([]);
      setProductRequestMessage(null);
      setShowUnmatchedDialog(true);
      return;
    }
    setProductRequests([]);
    setShowConfirm(true);
  };

  const updateProductRequest = (arrivalItemId: string, updates: Partial<ArrivalProductCreationRequestInput>) => {
    setProductRequests((current) => current.map((item) => item.arrivalItemId === arrivalItemId ? { ...item, ...updates } : item));
    setProductRequestIssues([]);
    setProductRequestMessage(null);
  };

  const continueWithProductRequests = () => {
    const issues = productRequests.flatMap((item, index) => {
      const missing: string[] = [];
      if (!item.name.trim()) missing.push('货品名称');
      if (!item.specification.trim()) missing.push('规格');
      if (!item.countUnit.trim()) missing.push('最小单位');
      if (!item.categoryCode) missing.push('货品分类');
      return missing.length > 0 ? [`未匹配货品 ${index + 1}：请填写${missing.join('、')}`] : [];
    });
    if (issues.length > 0) {
      setProductRequestIssues(issues);
      setProductRequestMessage(null);
      return;
    }
    setProductRequestIssues([]);
    void confirmSubmit(productRequests);
  };

  return (
    <PageShell eyebrow="门店运营系统 · 门店执行" title={reportId ? '修改到货上报' : '到货上报'} backTo={reportId ? '/app/arrivals/history' : '/app'} contentGapClassName="gap-3">
      <section className="rounded-lg bg-white p-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">当前门店</p>
            <h2 className="mt-1 font-bold text-slate-900">{auth.store?.name}</h2>
            <p className="mt-1 text-xs text-slate-500">到货编号：{draft.report.report_no}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${draft.saveStatus === 'error' ? 'bg-red-50 text-red-700' : draft.saveStatus === 'saved' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>
            {saveStatusLabel[draft.saveStatus]}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-slate-100 px-3 text-sm font-bold text-slate-700" to="/app/arrivals/history">
            <History className="h-4 w-4" aria-hidden="true" />
            查看到货历史
          </Link>
          {!reportId ? <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-bold text-amber-800" disabled={resetting || draft.saveStatus === 'saving'} onClick={() => setShowResetConfirm(true)} type="button"><RefreshCcw className="h-4 w-4" aria-hidden="true" />更新草稿</button> : null}
        </div>
      </section>

      <section className="rounded-lg bg-white p-3 shadow-sm">
        <div className="flex items-center gap-3">
          <PackagePlus className="h-5 w-5 text-brand-700" aria-hidden="true" />
          <h2 className="text-lg font-bold text-slate-900">到货信息</h2>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">到货日期<input className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-brand-500" onChange={(event) => draft.updateField('arrivalDate', event.target.value)} type="date" value={draft.form.arrivalDate} /></label>
          <label className="text-sm font-semibold text-slate-700">到货时间<input className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-brand-500" onChange={(event) => draft.updateField('arrivalTime', event.target.value)} type="time" value={draft.form.arrivalTime} /></label>
        </div>
        <label className="mt-2 block text-sm font-semibold text-slate-700">快递公司或配送方式（选填）<input className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-brand-500" onChange={(event) => draft.updateField('carrierName', event.target.value)} placeholder="例如：顺丰 / 门店配送" value={draft.form.carrierName} /></label>
        <label className="mt-2 block text-sm font-semibold text-slate-700">快递单号（选填）<input className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-brand-500" onChange={(event) => draft.updateField('trackingNo', event.target.value)} placeholder="扫描或填写快递单号" value={draft.form.trackingNo} /></label>
      </section>

      <ArrivalImageSection imageType="waybill" images={waybillImages} onDelete={draft.deleteImage} onUpload={draft.addImage} prompt="请拍摄完整的快递面单或配送标签，确保关键信息清晰可见。" title="快递面单照片" />
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs font-semibold text-brand-700">结构化明细</p><h2 className="mt-0.5 text-lg font-bold text-slate-900">产品明细</h2></div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm">{draft.form.items.length} 个产品</span>
        </div>
        {draft.form.items.map((item, index) => (
          <ArrivalItemCard
            canRemove={draft.form!.items.length > 1}
            index={index}
            item={item}
            images={goodsImages.filter((image) => image.arrival_item_id === item.id)}
            key={item.id}
            onChange={(next) => draft.updateItem(item.id, () => next)}
            onDeleteImage={draft.deleteImage}
            onRemove={() => { if (window.confirm('确认删除这个产品及其照片吗？')) void draft.removeItem(item.id); }}
            onUploadImage={(file, imageType, onProgress) => draft.addImage(file, imageType, onProgress, item.id)}
            products={draft.products}
          />
        ))}
        <button className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-brand-600 bg-white px-4 font-bold text-brand-700" onClick={draft.addItem} type="button"><Plus className="h-5 w-5" aria-hidden="true" />添加产品</button>
      </section>

      <section className="rounded-lg bg-brand-50 p-3">
        <p className="text-xs font-semibold text-brand-700">系统自动生成</p>
        <h2 className="mt-1 font-bold text-slate-900">规范到货描述</h2>
        <p className="mt-1 text-sm leading-5 text-slate-700">{summary || '完整填写产品名称、数量和最小计数单位后，系统会自动生成描述。'}</p>
      </section>

      <section className="rounded-lg bg-white p-3 shadow-sm">
        <label className="block text-sm font-semibold text-slate-700">补充备注（选填）<textarea className="mt-1 min-h-16 w-full rounded-lg border border-slate-200 p-2.5 outline-none focus:border-brand-500" onChange={(event) => draft.updateField('note', event.target.value)} placeholder="记录包装、数量或其他需要管理员注意的信息" value={draft.form.note} /></label>
      </section>

      {draft.message ? <p className="rounded-lg bg-red-50 p-4 text-sm leading-6 text-red-700">{draft.message}</p> : null}
      {actionMessage ? <p className={`rounded-lg p-4 text-sm leading-6 ${actionMessage.startsWith('草稿已更新') || actionMessage === '草稿已保存。' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{actionMessage}</p> : null}

      <MobileActionBar className="grid grid-cols-2 gap-2">
        <button className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 font-bold text-slate-800 disabled:opacity-50" disabled={draft.saveStatus === 'saving'} onClick={() => void saveManually()} type="button"><Save className="h-5 w-5" aria-hidden="true" />保存草稿</button>
        <button className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 font-bold disabled:opacity-50 ${validationIssues.length > 0 ? 'bg-slate-300 text-slate-700' : 'bg-brand-600 text-white'}`} disabled={submitting || draft.saveStatus === 'saving'} onClick={requestSubmit} type="button"><Send className="h-5 w-5" aria-hidden="true" />提交上报</button>
      </MobileActionBar>

      <ConfirmDialog confirmLabel={resetting ? '正在更新' : '清空并更新草稿'} danger onCancel={() => setShowResetConfirm(false)} onConfirm={() => void resetCurrentDraft()} open={showResetConfirm} title="确认更新当前草稿？">
        <p>这会清空当前草稿中的到货信息、产品明细和全部图片，并把到货日期、时间更新为现在。此操作无法撤销。</p>
      </ConfirmDialog>

      {showValidationDialog ? (
        <div className="ui-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="arrival-validation-title">
          <div className="ui-dialog-panel max-w-lg p-5">
            <div className="flex items-center gap-2 text-amber-800">
              <AlertCircle className="h-6 w-6 shrink-0" aria-hidden="true" />
              <h2 className="text-xl font-bold text-slate-900" id="arrival-validation-title">请先完善到货信息</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">以下内容尚未完成，完成后才能提交上报：</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-950">
              {validationIssues.map((issue) => <li className="rounded-md bg-amber-50 px-3 py-2" key={issue}>• {issue}</li>)}
            </ul>
            <button className="mt-5 min-h-12 w-full rounded-lg bg-brand-600 font-bold text-white" onClick={() => setShowValidationDialog(false)} type="button">我知道了</button>
          </div>
        </div>
      ) : null}

      {showConfirm ? (
        <div className="ui-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="arrival-confirm-title">
          <div className="ui-dialog-panel max-w-lg p-5">
            <h2 className="text-xl font-bold text-slate-900" id="arrival-confirm-title">确认提交到货上报</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-500">门店</dt><dd className="text-right font-semibold text-slate-900">{auth.store?.name}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">产品种类</dt><dd className="font-semibold text-slate-900">{draft.form.items.length}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">面单图片</dt><dd className="font-semibold text-slate-900">{waybillImages.length}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">货品图片</dt><dd className="font-semibold text-slate-900">{goodsImages.length} 张（每个产品均已上传）</dd></div>
            </dl>
            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">{summary}</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button className="min-h-12 rounded-lg border border-slate-200 font-bold text-slate-800" disabled={submitting} onClick={() => setShowConfirm(false)} type="button">返回修改</button>
              <button className="min-h-12 rounded-lg bg-brand-600 font-bold text-white disabled:bg-slate-300" disabled={submitting} onClick={() => void confirmSubmit()} type="button">{submitting ? '正在提交' : '确认提交'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {showUnmatchedDialog ? <div className="ui-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="arrival-unmatched-title">
        <div className="ui-dialog-panel max-h-[85dvh] max-w-lg overflow-y-auto p-5">
          <div className="flex items-center gap-2 text-amber-800"><AlertCircle className="h-6 w-6 shrink-0" /><h2 className="text-xl font-bold text-slate-900" id="arrival-unmatched-title">发现未匹配货品</h2></div>
          <p className="mt-3 text-sm leading-6 text-slate-600">仍可提交到货上报。是否同时申请把这些货品新增到货品库？申请将交由店长或管理员审核。</p>
          <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm leading-6 text-brand-900"><b>填写要求：</b>请按包装实物填写标准货品名称、完整规格、最小点货单位和正确分类。每种新货品只需申请一次；请勿使用简称、错别字或重复名称，审核通过后下次可直接选择。</div>
          <div className="mt-3 space-y-3">
            {productRequests.map((request, index) => <section className="rounded-xl border border-slate-200 bg-slate-50 p-3" key={request.arrivalItemId}>
              <b className="text-sm">未匹配货品 {index + 1}</b>
              <label className="mt-2 block text-xs font-semibold text-slate-600">货品名称<input className="ui-input mt-1" onChange={(event) => updateProductRequest(request.arrivalItemId, { name: event.target.value })} value={request.name} /></label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-slate-600">规格<input className="ui-input mt-1" onChange={(event) => updateProductRequest(request.arrivalItemId, { specification: event.target.value })} placeholder="例如 1kg/袋" value={request.specification} /></label>
                <label className="text-xs font-semibold text-slate-600">最小单位<input className="ui-input mt-1" onChange={(event) => updateProductRequest(request.arrivalItemId, { countUnit: event.target.value })} placeholder="例如 袋" value={request.countUnit} /></label>
              </div>
              <label className="mt-2 block text-xs font-semibold text-slate-600">货品分类<select className="ui-input mt-1" onChange={(event) => updateProductRequest(request.arrivalItemId, { categoryCode: event.target.value as ProductCategoryCode })} value={request.categoryCode}>{PRODUCT_CATEGORIES.map((category) => <option key={category.code} value={category.code}>{category.label}</option>)}</select></label>
            </section>)}
          </div>
          {productRequestIssues.length > 0 ? <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950" role="alert"><b>请补充以下信息：</b><ul className="mt-1 space-y-1">{productRequestIssues.map((issue) => <li key={issue}>• {issue}</li>)}</ul></div> : null}
          {productRequestMessage ? <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700" role="alert"><b>提交失败：</b>{productRequestMessage}</div> : null}
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <button className="ui-button-secondary" disabled={submitting} onClick={() => { setShowUnmatchedDialog(false); setProductRequests([]); setProductRequestIssues([]); setProductRequestMessage(null); }} type="button">返回修改</button>
            <button className="ui-button-secondary" disabled={submitting} onClick={() => { setShowUnmatchedDialog(false); setProductRequests([]); setShowConfirm(true); }} type="button">仅提交上报</button>
            <button className="ui-button-primary" disabled={submitting} onClick={continueWithProductRequests} type="button">{submitting ? '正在提交' : '提交并申请新增'}</button>
          </div>
        </div>
      </div> : null}
    </PageShell>
  );
}
