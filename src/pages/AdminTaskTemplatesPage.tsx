import { Archive, ClipboardPlus, ImagePlus, Plus, RefreshCw, Rocket, Save, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { SuccessToast } from '../components/feedback/SuccessToast';
import { featureFlags } from '../config/featureFlags';
import {
  categoryLabel,
  createEmptyTaskTemplate,
  createEmptyTemplateGroup,
  createEmptyTemplateItem,
  fieldTypeLabel,
  taskTemplateCategories,
  taskTemplateFieldTypes,
  type TaskTemplateDraft,
  type TaskTemplateGroupDraft,
  type TaskTemplateItemDraft,
} from '../features/task-templates/templateForm';
import { weeklyDeadlineOptions } from '../features/task-templates/recurrence';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import {
  archiveTaskTemplate,
  loadTaskTemplateDraft,
  loadTaskTemplates,
  publishTaskTemplate,
  saveTaskTemplate,
  uploadTaskTemplateReferenceImage,
  type TaskTemplateListItem,
} from '../services/task-templates.service';

type Filter = 'all' | typeof taskTemplateCategories[number];

const statusLabel = { archived: '已归档', draft: '草稿', published: '已发布' } as const;
const statusClass = { archived: 'bg-slate-100 text-slate-600', draft: 'bg-amber-50 text-amber-800', published: 'bg-brand-50 text-brand-700' } as const;

export function AdminTaskTemplatesPage() {
  const auth = useAuth();
  const [templates, setTemplates] = useState<TaskTemplateListItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [draft, setDraft] = useState<TaskTemplateDraft | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage('需要配置 Supabase 才能管理任务模板。'); return; }
    setStatus('loading');
    try { setTemplates(await loadTaskTemplates(supabase)); setStatus('ready'); setMessage(null); }
    catch (error) { setStatus('error'); setMessage(error instanceof Error ? error.message : '加载任务模板失败。'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const visibleTemplates = useMemo(() => templates.filter((template) => filter === 'all' || template.category === filter), [filter, templates]);

  if (!featureFlags.taskTemplates) {
    return <PageShell eyebrow="门店运营系统" title="任务模板暂未开放" backTo="/app"><p className="rounded-lg bg-white p-5 text-sm text-slate-600 shadow-sm">当前环境已关闭 V2 任务模板功能。</p></PageShell>;
  }

  const storeName = (id: string) => auth.availableStores.find((store) => store.id === id)?.short_name ?? '未知门店';

  const editTemplate = async (template: TaskTemplateListItem) => {
    if (!supabase) return;
    setMessage(null);
    setBusy(true);
    try { setDraft(await loadTaskTemplateDraft(supabase, template)); setMessage(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : '加载模板内容失败。'); }
    finally { setBusy(false); }
  };

  const save = async (publishAfterSave = false) => {
    if (!supabase || !draft) return;
    setBusy(true);
    try {
      const saved = await saveTaskTemplate(supabase, draft);
      if (publishAfterSave) {
        await publishTaskTemplate(supabase, saved.id);
        setDraft(null);
      } else {
        setDraft({ ...draft, id: saved.id });
      }
      await refresh();
      setMessage(null);
      setSuccessMessage(publishAfterSave ? '模板已保存并发布新版本，可用于后续任务。' : '模板草稿已保存。需要用于后续任务时，请点击发布新版本。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存模板失败。'); }
    finally { setBusy(false); }
  };

  const uploadReferenceImage = async (itemId: string, file: File | undefined) => {
    if (!supabase || !draft?.id || !file) return;
    setBusy(true);
    try {
      const uploaded = await uploadTaskTemplateReferenceImage(supabase, draft.id, itemId, file);
      setDraft((current) => current ? {
        ...current,
        groups: current.groups.map((group) => ({
          ...group,
          items: group.items.map((item) => item.id === itemId ? { ...item, referenceImagePath: uploaded.path, referenceImageUrl: uploaded.previewUrl } : item),
        })),
      } : current);
      setSuccessMessage('参考图片已上传，请点击“保存草稿”后写入模板。');
      setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : '上传参考图片失败。'); }
    finally { setBusy(false); }
  };

  const publish = async (template: TaskTemplateListItem) => {
    if (!supabase) return;
    if (!window.confirm(`确认发布“${template.name}”的新版本？已发布历史版本不会变化。`)) return;
    setBusy(true);
    try { await publishTaskTemplate(supabase, template.id); await refresh(); setMessage('模板新版本已发布。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '发布模板失败。'); }
    finally { setBusy(false); }
  };

  const archive = async (template: TaskTemplateListItem) => {
    if (!supabase || !window.confirm(`确认归档“${template.name}”？历史版本仍会保留。`)) return;
    setBusy(true);
    try { await archiveTaskTemplate(supabase, template.id); await refresh(); setMessage('模板已归档。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '归档模板失败。'); }
    finally { setBusy(false); }
  };

  return <PageShell eyebrow="门店运营系统 · 管理员" title="任务模板" backTo="/app/admin/tasks">
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">周清、月清与巡店模板</h2><p className="mt-1 text-sm text-slate-500">发布时生成不可变版本，阶段 6 将据此创建执行任务。</p></div><button aria-label="刷新模板" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200" onClick={() => void refresh()} type="button"><RefreshCw className="h-4 w-4" /></button></div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">{(['all', ...taskTemplateCategories] as const).map((value) => <button className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${filter === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`} key={value} onClick={() => setFilter(value)} type="button">{value === 'all' ? '全部' : categoryLabel[value]}</button>)}</div>
      <button className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white" onClick={() => setDraft(createEmptyTaskTemplate(auth.availableStores[0]?.id ? [auth.availableStores[0].id] : []))} type="button"><ClipboardPlus className="h-5 w-5" />新建模板</button>
    </section>

    {message ? <p className={`rounded-lg p-4 text-sm ${message.includes('失败') || message.includes('需要') ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-800'}`}>{message}</p> : null}
    {status === 'loading' ? <p className="rounded-lg bg-white p-5 font-semibold text-slate-600 shadow-sm">正在加载任务模板</p> : null}
    {status === 'ready' && visibleTemplates.length === 0 ? <p className="rounded-lg bg-white p-8 text-center text-slate-500 shadow-sm">当前分类还没有模板。</p> : null}
    {status === 'ready' ? <div className="grid gap-3 md:grid-cols-2">{visibleTemplates.map((template) => <article className="rounded-lg bg-white p-4 shadow-sm" key={template.id}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-brand-700">{categoryLabel[template.category]} · v{template.current_version}</p><h2 className="mt-1 text-lg font-bold text-slate-900">{template.name}</h2></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass[template.status]}`}>{statusLabel[template.status]}</span></div><p className="mt-2 line-clamp-2 text-sm text-slate-600">{template.description || '无额外说明'}</p><p className="mt-3 text-xs text-slate-500">适用：{template.storeIds.map(storeName).join('、') || '未配置门店'} · {template.requires_review ? '需要审核' : '无需审核'}</p>{template.status !== 'archived' ? <div className="mt-4 grid grid-cols-3 gap-2"><button className="min-h-10 rounded-lg border border-slate-200 text-sm font-bold" disabled={busy} onClick={() => void editTemplate(template)} type="button">编辑</button><button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-brand-600 text-sm font-bold text-white" disabled={busy || template.status === 'published'} onClick={() => void publish(template)} type="button"><Rocket className="h-4 w-4" />发布</button><button aria-label={`归档${template.name}`} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600" disabled={busy} onClick={() => void archive(template)} type="button"><Archive className="h-4 w-4" /></button></div> : null}</article>)}</div> : null}

    {draft ? <TemplateEditor busy={busy} draft={draft} errorMessage={message} onCancel={() => { setDraft(null); setMessage(null); }} onChange={setDraft} onPublishSave={() => void save(true)} onSave={() => void save()} onUploadReferenceImage={uploadReferenceImage} stores={auth.availableStores} /> : null}
    <SuccessToast message={successMessage} onClose={() => setSuccessMessage(null)} />
  </PageShell>;
}

function TemplateEditor({ busy, draft, errorMessage, onCancel, onChange, onPublishSave, onSave, onUploadReferenceImage, stores }: { busy: boolean; draft: TaskTemplateDraft; errorMessage: string | null; onCancel: () => void; onChange: (draft: TaskTemplateDraft) => void; onPublishSave: () => void; onSave: () => void; onUploadReferenceImage: (itemId: string, file: File | undefined) => void; stores: Array<{ id: string; name: string }> }) {
  const updateGroup = (index: number, group: TaskTemplateGroupDraft) => onChange({ ...draft, groups: draft.groups.map((entry, current) => current === index ? group : entry) });
  const removeGroup = (index: number) => onChange({ ...draft, groups: draft.groups.filter((_, current) => current !== index) });
  return <div className="fixed inset-0 z-40 overflow-y-auto bg-[#f4f7f3] p-4" role="dialog" aria-modal="true" aria-labelledby="template-editor-title"><div className="mx-auto max-w-3xl space-y-4 pb-24"><header className="sticky top-0 z-10 flex items-center justify-between rounded-lg bg-white p-4 shadow-sm"><div><p className="text-xs font-bold text-brand-700">{draft.id ? '编辑模板' : '新建模板'}</p><h2 className="text-xl font-bold" id="template-editor-title">{draft.name || '未命名模板'}</h2></div><button aria-label="关闭模板编辑" className="h-11 w-11 rounded-lg bg-slate-100" onClick={onCancel} type="button"><X className="mx-auto h-5 w-5" /></button></header>
    {errorMessage ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage}</p> : null}<section className="grid gap-3 rounded-lg bg-white p-4 shadow-sm sm:grid-cols-2"><label className="text-sm font-semibold">模板名称<input className="mt-1 min-h-11 w-full rounded-lg border p-3" onChange={(event) => onChange({ ...draft, name: event.target.value })} value={draft.name} /></label><label className="text-sm font-semibold">分类<select className="mt-1 min-h-11 w-full rounded-lg border px-3" onChange={(event) => onChange({ ...draft, category: event.target.value as TaskTemplateDraft['category'] })} value={draft.category}>{taskTemplateCategories.map((category) => <option key={category} value={category}>{categoryLabel[category]}</option>)}</select></label><label className="text-sm font-semibold sm:col-span-2">说明<textarea className="mt-1 min-h-20 w-full rounded-lg border p-3" onChange={(event) => onChange({ ...draft, description: event.target.value })} value={draft.description} /></label><p className="sm:col-span-2 rounded-lg bg-brand-50 p-3 text-xs leading-5 text-brand-800">模板中的截止规则只是“首次验收截止时间”的默认建议，不会自动发任务。是否创建单次或周期任务，请在“任务管理”发布时单独选择。</p><label className="text-sm font-semibold">默认验收周期<select className="mt-1 min-h-11 w-full rounded-lg border px-3" onChange={(event) => { const recurrence = event.target.value as TaskTemplateDraft['recurrence']; onChange({ ...draft, recurrence, recurrenceDay: recurrence === 'none' ? null : recurrence === 'weekly' ? Math.min(draft.recurrenceDay ?? 1, 7) : draft.recurrenceDay ?? 1 }); }} value={draft.recurrence}><option value="none">不设置默认周期</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label>{draft.recurrence !== 'none' ? <label className="text-sm font-semibold">默认验收截止日<select className="mt-1 min-h-11 w-full rounded-lg border px-3" onChange={(event) => onChange({ ...draft, recurrenceDay: Number(event.target.value) })} value={draft.recurrenceDay ?? ''}>{draft.recurrence === 'weekly' ? weeklyDeadlineOptions.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>) : Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>每月 {day} 日</option>)}</select></label> : null}<label className="text-sm font-semibold">默认验收时间<input className="mt-1 min-h-11 w-full rounded-lg border px-3" onChange={(event) => onChange({ ...draft, dueTime: event.target.value })} type="time" value={draft.dueTime} /></label><label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input checked={draft.requiresReview} onChange={(event) => onChange({ ...draft, requiresReview: event.target.checked })} type="checkbox" />需要管理员审核</label><label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input checked={draft.allowOverdue} onChange={(event) => onChange({ ...draft, allowOverdue: event.target.checked })} type="checkbox" />允许逾期补交</label><fieldset className="sm:col-span-2"><legend className="text-sm font-semibold">适用门店</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{stores.map((store) => <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm" key={store.id}><input checked={draft.storeIds.includes(store.id)} onChange={() => onChange({ ...draft, storeIds: draft.storeIds.includes(store.id) ? draft.storeIds.filter((id) => id !== store.id) : [...draft.storeIds, store.id] })} type="checkbox" />{store.name}</label>)}</div></fieldset></section>
    {!draft.id ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">请先保存草稿，再为各项目上传参考图片。</p> : null}
    {draft.groups.map((group, groupIndex) => <GroupEditor canUploadReference={Boolean(draft.id)} group={group} key={group.id} onChange={(value) => updateGroup(groupIndex, value)} onRemove={() => removeGroup(groupIndex)} onUploadReferenceImage={onUploadReferenceImage} />)}
    <button className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-brand-200 bg-white px-4 font-bold text-brand-700" onClick={() => onChange({ ...draft, groups: [...draft.groups, createEmptyTemplateGroup()] })} type="button"><Plus className="h-4 w-4" />添加分组</button>
    <div className="fixed inset-x-0 bottom-0 border-t bg-white p-3"><div className="mx-auto grid max-w-3xl grid-cols-3 gap-2"><button className="min-h-12 rounded-lg border font-bold" onClick={onCancel} type="button">取消</button><button className="min-h-12 rounded-lg border border-brand-200 font-bold text-brand-700 disabled:opacity-50" disabled={busy} onClick={onSave} type="button">保存草稿</button><button className="inline-flex min-h-12 items-center justify-center gap-1 rounded-lg bg-brand-600 px-2 font-bold text-white disabled:opacity-50" disabled={busy} onClick={onPublishSave} type="button"><Save className="h-4 w-4" />保存并发布</button></div></div>
  </div></div>;
}

function GroupEditor({ canUploadReference, group, onChange, onRemove, onUploadReferenceImage }: { canUploadReference: boolean; group: TaskTemplateGroupDraft; onChange: (group: TaskTemplateGroupDraft) => void; onRemove: () => void; onUploadReferenceImage: (itemId: string, file: File | undefined) => void }) {
  const updateItem = (index: number, item: TaskTemplateItemDraft) => onChange({ ...group, items: group.items.map((entry, current) => current === index ? item : entry) });
  return <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-start gap-3"><div className="grid flex-1 gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">分组名称<input className="mt-1 min-h-11 w-full rounded-lg border p-3" onChange={(event) => onChange({ ...group, title: event.target.value })} value={group.title} /></label><label className="text-sm font-semibold">分组说明<input className="mt-1 min-h-11 w-full rounded-lg border p-3" onChange={(event) => onChange({ ...group, description: event.target.value })} value={group.description} /></label></div><button aria-label="删除分组" className="mt-5 h-11 w-11 text-red-600" onClick={onRemove} type="button"><Trash2 className="mx-auto h-5 w-5" /></button></div><div className="mt-4 space-y-3">{group.items.map((item, index) => <ItemEditor canUploadReference={canUploadReference} item={item} key={item.id} onChange={(value) => updateItem(index, value)} onRemove={() => onChange({ ...group, items: group.items.filter((_, current) => current !== index) })} onUploadReferenceImage={onUploadReferenceImage} />)}</div><button className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-100 px-3 text-sm font-bold" onClick={() => onChange({ ...group, items: [...group.items, createEmptyTemplateItem()] })} type="button"><Plus className="h-4 w-4" />添加项目</button></section>;
}

function ItemEditor({ canUploadReference, item, onChange, onRemove, onUploadReferenceImage }: { canUploadReference: boolean; item: TaskTemplateItemDraft; onChange: (item: TaskTemplateItemDraft) => void; onRemove: () => void; onUploadReferenceImage: (itemId: string, file: File | undefined) => void }) {
  return <div className="rounded-lg border border-slate-200 p-3"><div className="flex items-start gap-2"><div className="grid flex-1 gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">项目名称<input className="mt-1 min-h-10 w-full rounded-lg border p-2" onChange={(event) => onChange({ ...item, label: event.target.value })} value={item.label} /></label><label className="text-sm font-semibold">字段类型<select className="mt-1 min-h-10 w-full rounded-lg border px-2" onChange={(event) => onChange({ ...item, fieldType: event.target.value as TaskTemplateItemDraft['fieldType'] })} value={item.fieldType}>{taskTemplateFieldTypes.map((type) => <option key={type} value={type}>{fieldTypeLabel[type]}</option>)}</select></label><label className="text-sm font-semibold sm:col-span-2">标准说明<input className="mt-1 min-h-10 w-full rounded-lg border p-2" onChange={(event) => onChange({ ...item, guidance: event.target.value })} value={item.guidance} /></label>{['single_choice', 'multi_choice'].includes(item.fieldType) ? <label className="text-sm font-semibold sm:col-span-2">选项（每行一个）<textarea className="mt-1 min-h-20 w-full rounded-lg border p-2" onChange={(event) => onChange({ ...item, optionsText: event.target.value })} value={item.optionsText} /></label> : null}<label className="text-sm font-semibold">图片要求<select className="mt-1 min-h-10 w-full rounded-lg border px-2" onChange={(event) => onChange({ ...item, imageRequirement: event.target.value as TaskTemplateItemDraft['imageRequirement'] })} value={item.imageRequirement}><option value="none">不要求</option><option value="single">至少一张</option><option value="multiple">多张图片</option></select></label><label className="flex items-end gap-2 pb-2 text-sm font-semibold"><input checked={item.isRequired} onChange={(event) => onChange({ ...item, isRequired: event.target.checked })} type="checkbox" />必填</label><div className="sm:col-span-2 rounded-lg bg-slate-50 p-2.5"><div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><b className="text-sm text-slate-800">参考图片（选填）</b><p className="mt-0.5 text-xs text-slate-500">供员工执行任务时查看，上传后请保存模板。</p></div>{item.referenceImageUrl ? <img alt={`${item.label || '任务项目'}参考图片`} className="h-14 w-14 rounded-lg border object-cover" src={item.referenceImageUrl} /> : null}<label className={`inline-flex min-h-10 items-center gap-1 rounded-lg border px-3 text-sm font-bold ${canUploadReference ? 'bg-white text-brand-700' : 'cursor-not-allowed text-slate-400'}`}><ImagePlus className="h-4 w-4" />上传<input accept="image/jpeg,image/png,image/webp" className="hidden" disabled={!canUploadReference} onChange={(event) => { onUploadReferenceImage(item.id, event.target.files?.[0]); event.currentTarget.value = ''; }} type="file" /></label></div></div></div><button aria-label="删除项目" className="h-10 w-10 text-red-600" onClick={onRemove} type="button"><Trash2 className="mx-auto h-4 w-4" /></button></div></div>;
}
