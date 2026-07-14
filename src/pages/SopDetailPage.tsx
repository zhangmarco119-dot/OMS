import { BookOpenCheck, ExternalLink, Rocket, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { SuccessToast } from '../components/feedback/SuccessToast';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/Feedback';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadTaskTemplates, type TaskTemplateListItem } from '../services/task-templates.service';
import { loadSopDetail, publishSop, saveSop, type SopListItem } from '../services/v2-content.service';

type PublishSettings = {
  effectiveAt: string;
  roles: Array<'staff' | 'manager'>;
  silent: boolean;
  storeIds: string[];
  taskTemplateId: string | null;
};

const toLocalDateTimeInput = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function SopDetailPage() {
  const auth = useAuth();
  const { sopId } = useParams();
  const [sop, setSop] = useState<SopListItem | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState<{ alt: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TaskTemplateListItem[]>([]);
  const [publishSettings, setPublishSettings] = useState<PublishSettings>({ effectiveAt: '', roles: ['staff', 'manager'], silent: true, storeIds: [], taskTemplateId: null });

  const load = useCallback(async () => {
    if (!supabase || !sopId) { setStatus('error'); setMessage('无法识别该 SOP。'); return; }
    setStatus('loading');
    try {
      const [loaded, nextTemplates] = await Promise.all([
        loadSopDetail(supabase, sopId),
        auth.profile?.role === 'admin' ? loadTaskTemplates(supabase) : Promise.resolve([]),
      ]);
      const found = loaded && (loaded.status === 'published' || auth.profile?.role === 'admin') ? loaded : null;
      setSop(found);
      setTemplates(nextTemplates);
      if (found) setPublishSettings({
        effectiveAt: toLocalDateTimeInput(found.effective_at),
        roles: found.roles,
        silent: true,
        storeIds: found.storeIds,
        taskTemplateId: nextTemplates.some((template) => template.id === found.taskTemplateId && template.status === 'published') ? found.taskTemplateId : null,
      });
      setStatus('ready');
      setMessage(null);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '加载 SOP 详情失败。');
    }
  }, [auth.profile?.role, sopId]);
  useEffect(() => { void load(); }, [load]);

  const images = sop?.assetUrls.filter((asset) => asset.asset_kind === 'step').sort((left, right) => left.sort_order - right.sort_order) ?? [];
  const documents = sop?.assetUrls.filter((asset) => asset.asset_kind === 'attachment') ?? [];
  const canPublish = auth.profile?.role === 'admin' && sop?.status === 'draft';
  const toggleRole = (role: 'staff' | 'manager') => setPublishSettings((current) => ({
    ...current,
    roles: current.roles.includes(role) ? current.roles.filter((entry) => entry !== role) : [...current.roles, role],
  }));
  const toggleStore = (storeId: string) => setPublishSettings((current) => ({
    ...current,
    storeIds: current.storeIds.includes(storeId) ? current.storeIds.filter((id) => id !== storeId) : [...current.storeIds, storeId],
  }));
  const confirmPublish = async () => {
    const client = supabase;
    if (!client || !sop || !canPublish) return;
    if (!images.length) { setMessage('发布 SOP 前请至少添加一个图片步骤。'); return; }
    if (images.some((asset) => !asset.step_text.trim())) { setMessage('每一张步骤图片都需要填写对应的步骤说明。'); return; }
    if (!publishSettings.roles.length || !publishSettings.storeIds.length) { setMessage('请至少选择一个适用角色和门店。'); return; }
    setBusy(true); setMessage(null);
    try {
      await saveSop(client, {
        body: sop.body,
        category: sop.category,
        effectiveAt: publishSettings.effectiveAt,
        id: sop.id,
        roles: publishSettings.roles,
        storeIds: publishSettings.storeIds,
        taskTemplateId: publishSettings.taskTemplateId,
        title: sop.title,
      });
      await publishSop(client, sop.id, { silent: publishSettings.silent });
      setSuccess(publishSettings.silent ? 'SOP 已静默发布。' : 'SOP 已发布并通知适用员工。');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发布 SOP 失败。');
    } finally { setBusy(false); }
  };

  return <PageShell eyebrow={sop?.category ?? 'SOP 手册'} title={sop?.title ?? 'SOP 详情'} backTo={auth.profile?.role === 'admin' ? '/app/admin/sops' : '/app/sops'} contentGapClassName="gap-3">
    {status === 'error' && message ? <ErrorState message={message} onRetry={() => void load()} /> : null}
    {status === 'loading' ? <LoadingState label="正在加载完整 SOP" /> : null}
    {status === 'ready' && !sop ? <EmptyState description="该 SOP 可能尚未发布、已归档，或不适用于当前门店。" icon={BookOpenCheck} title="无法查看 SOP" /> : null}
    {sop ? <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {sop.body ? <section className="border-b border-slate-100 p-4"><h2 className="text-sm font-bold text-slate-900">整体说明</h2><p className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-slate-700">{sop.body}</p></section> : null}
      {images.length ? <div className="grid grid-cols-2 gap-px bg-slate-200" data-testid="sop-detail-step-grid">{images.map((asset, index) => <section className="min-w-0 bg-white" key={asset.id}><div className="bg-slate-50 px-2 py-1.5 text-xs font-bold text-brand-700">步骤 {index + 1}</div><p className="min-h-12 whitespace-pre-wrap px-2 py-2 text-xs leading-5 text-slate-800 sm:text-sm">{asset.step_text || `请按图示完成第 ${index + 1} 步。`}</p><button aria-label={`放大查看步骤 ${index + 1} 图片`} className="block w-full bg-white" onClick={() => setActiveImage({ alt: asset.file_name, url: asset.signedUrl })} type="button"><img alt={`${sop.title} 步骤 ${index + 1}`} className="aspect-[4/3] w-full bg-slate-50 object-contain" src={asset.signedUrl} /></button></section>)}</div> : <section className="p-5"><p className="text-sm text-slate-500">该 SOP 暂无分步图片，请按整体说明执行。</p></section>}
      {documents.length ? <section className="border-t border-slate-100 p-4"><h2 className="text-sm font-bold">附件</h2><div className="mt-2 flex flex-wrap gap-2">{documents.map((asset) => <a className="ui-button-secondary" href={asset.signedUrl} key={asset.id} rel="noreferrer" target="_blank"><ExternalLink className="h-4 w-4" />{asset.file_name}</a>)}</div></section> : null}
    </article> : null}
    {canPublish ? <section className="ui-card space-y-4 p-4" id="sop-publish-settings">
      <div><p className="text-xs font-bold text-brand-700">发布前最后一步</p><h2 className="mt-1 text-lg font-bold text-slate-900">发布基本设置</h2><p className="mt-1 text-sm leading-6 text-slate-500">上方内容就是员工看到的 SOP。确认预览无误后，再设置生效时间和可见范围。</p></div>
      <label className="block text-sm font-semibold text-slate-700">生效时间（不填则立即生效）<input className="ui-input mt-1.5" onChange={(event) => setPublishSettings((current) => ({ ...current, effectiveAt: event.target.value }))} type="datetime-local" value={publishSettings.effectiveAt} /></label>
      <fieldset><legend className="text-sm font-semibold text-slate-700">适用角色</legend><div className="mt-2 grid grid-cols-2 gap-2"><label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm"><input checked={publishSettings.roles.includes('staff')} onChange={() => toggleRole('staff')} type="checkbox" />员工</label><label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm"><input checked={publishSettings.roles.includes('manager')} onChange={() => toggleRole('manager')} type="checkbox" />店长</label></div></fieldset>
      <fieldset><legend className="text-sm font-semibold text-slate-700">适用门店</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{auth.availableStores.map((store) => <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm" key={store.id}><input checked={publishSettings.storeIds.includes(store.id)} onChange={() => toggleStore(store.id)} type="checkbox" />{store.name}</label>)}</div></fieldset>
      <details className="rounded-xl border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-800">高级选项</summary><div className="mt-3"><label className="block text-sm font-semibold text-slate-700">关联任务模板（选填）<select aria-label="关联任务模板" className="ui-input mt-1.5" onChange={(event) => setPublishSettings((current) => ({ ...current, taskTemplateId: event.target.value || null }))} value={publishSettings.taskTemplateId ?? ''}><option value="">不关联任务模板</option>{templates.filter((template) => template.status === 'published').map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><p className="mt-2 text-xs leading-5 text-slate-500">关联后可在任务执行场景中明确对应的标准制作流程，不会自动发布任务。</p></div></details>
      <label className="flex min-h-12 items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm"><input checked={publishSettings.silent} className="mt-1" onChange={(event) => setPublishSettings((current) => ({ ...current, silent: event.target.checked }))} type="checkbox" /><span><span className="block font-bold text-brand-900">静默发布</span><span className="mt-1 block leading-5 text-brand-800">默认勾选。员工可以查看 SOP，但不会收到发布通知。</span></span></label>
      <button className="ui-button-primary w-full" disabled={busy} onClick={() => void confirmPublish()} type="button"><Rocket className="h-4 w-4" />{busy ? '正在发布' : '确认发布 SOP'}</button>
    </section> : null}
    {activeImage ? <div aria-label="SOP 步骤图片全屏预览" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4" onClick={() => setActiveImage(null)} role="dialog"><button aria-label="关闭图片预览" className="absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white" onClick={() => setActiveImage(null)} type="button"><X className="h-6 w-6" /></button><img alt={activeImage.alt} className="max-h-full max-w-full object-contain" onClick={() => setActiveImage(null)} src={activeImage.url} /></div> : null}
    <ActionFeedbackDialog message={message ?? ''} onClose={() => setMessage(null)} open={status === 'ready' && Boolean(message)} title="暂时无法发布" tone="warning" />
    <SuccessToast message={success} onClose={() => setSuccess(null)} />
  </PageShell>;
}
