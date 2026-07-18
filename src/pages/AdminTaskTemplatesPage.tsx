import { Archive, ClipboardPlus, Plus, RefreshCw, Rocket, Save, Trash2, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { SuccessToast } from '../components/feedback/SuccessToast';
import { featureFlags } from '../config/featureFlags';
import {
  categoryLabel,
  createEmptyTaskTemplate,
  createEmptyTemplateGroup,
  createEmptyTemplateItem,
  fieldTypeLabel,
  taskTemplateFieldTypes,
  type TaskTemplateDraft,
  type TaskTemplateGroupDraft,
  type TaskTemplateItemDraft,
} from '../features/task-templates/templateForm';
import { TaskTemplateReferenceImageUpload } from '../features/task-templates/TaskTemplateReferenceImageUpload';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import {
  archiveTaskTemplate,
  createTaskCategory,
  deleteTaskCategory,
  deleteArchivedTaskTemplate,
  deleteTaskTemplateReferenceImage,
  loadTaskTemplateDraft,
  loadTaskCategories,
  loadTaskTemplates,
  publishTaskTemplate,
  retractTaskTemplate,
  saveTaskTemplate,
  uploadTaskTemplateReferenceImage,
  type TaskTemplateListItem,
  type TaskCategoryRow,
} from '../services/task-templates.service';

type Filter = 'all' | string;
type TemplateScope = 'active' | 'archived';

const appendReferenceImage = (source: TaskTemplateDraft, itemId: string, path: string, previewUrl: string): TaskTemplateDraft => ({
  ...source,
  groups: source.groups.map((group) => ({
    ...group,
    items: group.items.map((item) => item.id === itemId ? {
      ...item,
      referenceImagePath: item.referenceImagePath ?? path,
      referenceImagePaths: [...item.referenceImagePaths, path],
      referenceImageUrl: item.referenceImageUrl ?? previewUrl,
      referenceImageUrls: [...item.referenceImageUrls, previewUrl],
    } : item),
  })),
});

const removeReferenceImage = (source: TaskTemplateDraft, itemId: string, remainingPaths: string[]): TaskTemplateDraft => ({
  ...source,
  groups: source.groups.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      if (item.id !== itemId) return item;
      const urlsByPath = new Map(item.referenceImagePaths.map((entry, index) => [entry, item.referenceImageUrls[index]]));
      const urls = remainingPaths.map((entry) => urlsByPath.get(entry)).filter((url): url is string => Boolean(url));
      return {
        ...item,
        referenceImagePath: remainingPaths[0] ?? null,
        referenceImagePaths: remainingPaths,
        referenceImageUrl: urls[0] ?? null,
        referenceImageUrls: urls,
      };
    }),
  })),
});

const statusLabel = { archived: '已归档', draft: '草稿', published: '已发布' } as const;
const statusClass = { archived: 'bg-slate-100 text-slate-600', draft: 'bg-amber-50 text-amber-800', published: 'bg-brand-50 text-brand-700' } as const;
const isTransientPreviewUrl = (url: string | null) => Boolean(url?.startsWith('blob:') || url?.startsWith('data:'));

const restoreTemplateDraft = (value: string): TaskTemplateDraft | null => {
  try {
    const parsed = JSON.parse(value) as TaskTemplateDraft;
    if (!parsed || !Array.isArray(parsed.groups)) return null;
    return {
      ...parsed,
      groups: parsed.groups.map((group) => ({
        ...group,
        items: group.items.map((item) => ({ ...item, referenceImagePath: item.referenceImagePath ?? null, referenceImageUrl: item.referenceImageUrl ?? null, referenceImagePaths: item.referenceImagePaths ?? (item.referenceImagePath ? [item.referenceImagePath] : []), referenceImageUrls: item.referenceImageUrls ?? (item.referenceImageUrl ? [item.referenceImageUrl] : []) })),
      })),
    };
  } catch { return null; }
};

export function AdminTaskTemplatesPage() {
  const auth = useAuth();
  const [templates, setTemplates] = useState<TaskTemplateListItem[]>([]);
  const [categories, setCategories] = useState<TaskCategoryRow[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [scope, setScope] = useState<TemplateScope>('active');
  const [selectedArchivedIds, setSelectedArchivedIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<TaskTemplateDraft | null>(null);
  const [restoredDraftKey, setRestoredDraftKey] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const draftRef = useRef<TaskTemplateDraft | null>(null);
  const draftStorageKey = auth.profile ? `storehub:v2-task-template-draft:${auth.profile.id}` : null;

  const refresh = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage('需要配置 Supabase 才能管理任务模板。'); return; }
    setStatus('loading');
    try {
      const [nextTemplates, nextCategories] = await Promise.all([loadTaskTemplates(supabase), loadTaskCategories(supabase)]);
      setTemplates(nextTemplates); setCategories(nextCategories); setStatus('ready'); setMessage(null);
    }
    catch (error) { setStatus('error'); setMessage(error instanceof Error ? error.message : '加载任务模板失败。'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!draftStorageKey || restoredDraftKey === draftStorageKey) return;
    const stored = window.localStorage.getItem(draftStorageKey);
    const restored = stored ? restoreTemplateDraft(stored) : null;
    if (restored) setDraft(restored);
    setRestoredDraftKey(draftStorageKey);
  }, [draftStorageKey, restoredDraftKey]);
  useEffect(() => {
    if (!draftStorageKey || restoredDraftKey !== draftStorageKey) return;
    if (draft) {
      const persistedDraft = { ...draft, groups: draft.groups.map((group) => ({ ...group, items: group.items.map((item) => ({ ...item, referenceImageUrl: isTransientPreviewUrl(item.referenceImageUrl) ? null : item.referenceImageUrl, referenceImageUrls: item.referenceImageUrls.filter((url) => !isTransientPreviewUrl(url)) })) })) };
      window.localStorage.setItem(draftStorageKey, JSON.stringify(persistedDraft));
    }
    else window.localStorage.removeItem(draftStorageKey);
  }, [draft, draftStorageKey, restoredDraftKey]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  const visibleTemplates = useMemo(() => templates.filter((template) => (scope === 'archived' ? template.status === 'archived' : template.status !== 'archived') && (filter === 'all' || template.category === filter)), [filter, scope, templates]);
  const categoryName = (code: string) => categories.find((item) => item.code === code)?.label ?? categoryLabel[code] ?? code;

  if (!featureFlags.taskTemplates) {
    return <PageShell eyebrow="门店运营系统" title="任务模板暂未开放" backTo="/app"><p className="rounded-lg bg-white p-5 text-sm text-slate-600 shadow-sm">当前环境已关闭任务模板功能。</p></PageShell>;
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
      const savedDraft = { ...draft, id: saved.id };
      if (publishAfterSave) {
        await publishTaskTemplate(supabase, saved.id);
        setDraft(null);
      } else {
        setDraft(savedDraft);
      }
      await refresh();
      setMessage(null);
      setSuccessMessage(publishAfterSave ? '模板已保存并发布新版本，可用于后续任务。' : '模板草稿已保存。需要用于后续任务时，请点击发布新版本。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存模板失败。'); }
    finally { setBusy(false); }
  };

  const uploadReferenceImage = async (itemId: string, file: File, onProgress: (progress: number) => void) => {
    const currentDraft = draftRef.current;
    if (!supabase || !currentDraft) throw new Error('模板草稿尚未加载。');
    setBusy(true);
    try {
      // Always persist the complete browser draft first. A template may already
      // have an id while a newly added item still exists only in the browser; in
      // that case skipping save makes the image upload impossible to attach.
      const saved = await saveTaskTemplate(supabase, currentDraft);
      const savedDraft = { ...currentDraft, id: saved.id };
      draftRef.current = savedDraft;
      setDraft(savedDraft);
      const uploaded = await uploadTaskTemplateReferenceImage(supabase, saved.id, itemId, file, onProgress);
      // The upload service has already linked the image to this item atomically.
      // Avoid rewriting the full template from a potentially stale browser draft.
      const uploadedDraft = appendReferenceImage(draftRef.current ?? savedDraft, itemId, uploaded.path, uploaded.previewUrl);
      draftRef.current = uploadedDraft;
      setDraft(uploadedDraft);
      setSuccessMessage('参考图片已上传并保存。若模板已发布，请发布新版本后再用于任务。');
      setMessage(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '上传参考图片失败。';
      setMessage(errorMessage);
      throw new Error(errorMessage);
    }
    finally { setBusy(false); }
  };

  const deleteReferenceImage = async (itemId: string, path: string) => {
    const currentDraft = draftRef.current;
    if (!supabase || !currentDraft?.id) throw new Error('模板草稿尚未保存，无法删除参考图片。');
    setBusy(true);
    try {
      const remainingPaths = await deleteTaskTemplateReferenceImage(supabase, currentDraft.id, itemId, path);
      const updatedDraft = removeReferenceImage(draftRef.current ?? currentDraft, itemId, remainingPaths);
      draftRef.current = updatedDraft;
      setDraft(updatedDraft);
      setSuccessMessage('参考图片已删除。');
      setMessage(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '删除参考图片失败。';
      setMessage(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setBusy(false);
    }
  };

  const publish = async (template: TaskTemplateListItem) => {
    if (!supabase) return;
    if (!window.confirm(`确认发布“${template.name}”的新版本？已发布历史版本不会变化。`)) return;
    setBusy(true);
    try { await publishTaskTemplate(supabase, template.id); await refresh(); setSuccessMessage('模板新版本已发布。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '发布模板失败。'); }
    finally { setBusy(false); }
  };

  const archive = async (template: TaskTemplateListItem) => {
    if (!supabase || !window.confirm(`确认归档“${template.name}”？历史版本仍会保留。`)) return;
    setBusy(true);
    try { await archiveTaskTemplate(supabase, template.id); await refresh(); setSuccessMessage('模板已归档。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '归档模板失败。'); }
    finally { setBusy(false); }
  };

  const retract = async (template: TaskTemplateListItem) => {
    if (!supabase || !window.confirm(`确认撤回任务模板“${template.name}”吗？撤回后员工和店长将不再看到该模板。`)) return;
    setBusy(true);
    try { await retractTaskTemplate(supabase, template.id); await refresh(); setSuccessMessage('任务模板已撤回并恢复为待发布草稿。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '撤回任务模板失败。'); }
    finally { setBusy(false); }
  };

  const deleteArchived = async (template: TaskTemplateListItem) => {
    if (!supabase || !window.confirm(`确认永久删除已归档模板“${template.name}”？没有任务历史的模板将被删除。`)) return;
    setBusy(true);
    try { await deleteArchivedTaskTemplate(supabase, template.id); await refresh(); setSuccessMessage('已归档模板已删除。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '删除已归档模板失败。'); }
    finally { setBusy(false); }
  };

  const deleteArchivedBatch = async () => {
    if (!supabase || !selectedArchivedIds.length || !window.confirm(`确认永久删除选中的 ${selectedArchivedIds.length} 个已归档模板？存在任务历史的模板会保留并列入失败结果。`)) return;
    setBusy(true); setMessage(null);
    let deleted = 0; const failed: string[] = [];
    for (const template of visibleTemplates.filter((item) => selectedArchivedIds.includes(item.id))) {
      try { await deleteArchivedTaskTemplate(supabase, template.id); deleted += 1; }
      catch { failed.push(template.name); }
    }
    setSelectedArchivedIds([]); setBusy(false); await refresh();
    if (failed.length) setMessage(`已删除 ${deleted} 个，${failed.length} 个未删除：${failed.join('、')}`);
    else setSuccessMessage(`已永久删除 ${deleted} 个已归档模板。`);
  };

  const addCategory = async () => {
    if (!supabase || !newCategoryName.trim()) { setMessage('请输入任务分类名称。'); return; }
    setBusy(true);
    try { await createTaskCategory(supabase, newCategoryName.trim()); setNewCategoryName(''); await refresh(); setSuccessMessage('任务分类已新建。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '新建任务分类失败。'); }
    finally { setBusy(false); }
  };

  const removeCategory = async (category: TaskCategoryRow) => {
    if (!supabase || category.is_system || !window.confirm(`确认删除任务分类“${category.label}”？分类下仍有模板时不能删除。`)) return;
    setBusy(true);
    try { await deleteTaskCategory(supabase, category.code); if (filter === category.code) setFilter('all'); await refresh(); setSuccessMessage('任务分类已删除。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '删除任务分类失败。'); }
    finally { setBusy(false); }
  };

  return <PageShell eyebrow="门店运营系统 · 管理员" title="任务模板" backTo="/app/admin/tasks">
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">周清、月清与巡店模板</h2><p className="mt-1 text-sm text-slate-500">发布后生成不可变版本，可用于创建执行任务。</p></div><button aria-label="刷新模板" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200" onClick={() => void refresh()} type="button"><RefreshCw className="h-4 w-4" /></button></div>
      <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1"><button className={`min-h-10 rounded-md text-sm font-bold ${scope === 'active' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setScope('active')} type="button">当前模板</button><button className={`min-h-10 rounded-md text-sm font-bold ${scope === 'archived' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setScope('archived')} type="button">已归档模板</button></div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{(['all', ...categories.map((item) => item.code)]).map((value) => <button className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${filter === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`} key={value} onClick={() => setFilter(value)} type="button">{value === 'all' ? '全部' : categoryName(value)}</button>)}</div>
      {scope === 'active' ? <div className="mt-4 flex flex-wrap gap-2"><button className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white" onClick={() => setDraft(createEmptyTaskTemplate(auth.availableStores[0]?.id ? [auth.availableStores[0].id] : []))} type="button"><ClipboardPlus className="h-5 w-5" />新建模板</button><button className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-brand-200 bg-white px-4 font-bold text-brand-700" onClick={() => setCategoryManagerOpen(true)} type="button"><Plus className="h-4 w-4" />分类管理</button></div> : null}
      {scope === 'archived' && visibleTemplates.length ? <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3"><label className="text-sm font-bold"><input checked={selectedArchivedIds.length === visibleTemplates.length} className="mr-2" onChange={(event) => setSelectedArchivedIds(event.target.checked ? visibleTemplates.map((item) => item.id) : [])} type="checkbox" />全选</label><button className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-red-600 px-3 text-sm font-bold text-white disabled:opacity-40" disabled={busy || !selectedArchivedIds.length} onClick={() => void deleteArchivedBatch()} type="button"><Trash2 className="h-4 w-4" />批量删除（{selectedArchivedIds.length}）</button></div> : null}
      {scope === 'archived' && visibleTemplates.length ? <div className="mt-2 grid gap-2 rounded-lg border border-slate-200 p-3">{visibleTemplates.map((template) => <label className="flex min-h-9 cursor-pointer items-center rounded-md px-2 text-sm font-semibold hover:bg-slate-50" key={template.id}><input checked={selectedArchivedIds.includes(template.id)} className="mr-2 h-4 w-4" onChange={(event) => setSelectedArchivedIds((current) => event.target.checked ? [...new Set([...current, template.id])] : current.filter((id) => id !== template.id))} type="checkbox" />{template.name}</label>)}</div> : null}
    </section>

    {status === 'error' && message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}
    {status === 'loading' ? <p className="rounded-lg bg-white p-5 font-semibold text-slate-600 shadow-sm">正在加载任务模板</p> : null}
    {status === 'ready' && visibleTemplates.length === 0 ? <p className="rounded-lg bg-white p-8 text-center text-slate-500 shadow-sm">{scope === 'archived' ? '暂无已归档模板。' : '当前分类还没有模板。'}</p> : null}
    {status === 'ready' ? <div className="grid gap-3 md:grid-cols-2">{visibleTemplates.map((template) => <article className="rounded-lg bg-white p-4 shadow-sm" key={template.id}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-brand-700">{categoryName(template.category)} · v{template.current_version}</p><h2 className="mt-1 text-lg font-bold text-slate-900">{template.name}</h2></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass[template.status]}`}>{statusLabel[template.status]}</span></div><p className="mt-2 line-clamp-2 text-sm text-slate-600">{template.description || '无额外说明'}</p><p className="mt-3 text-xs text-slate-500">适用：{template.storeIds.map(storeName).join('、') || '未配置门店'} · {template.requires_review ? '需要审核' : '无需审核'}</p>{template.status !== 'archived' ? <div className="mt-4 grid grid-cols-3 gap-2"><button className="min-h-10 rounded-lg border border-slate-200 text-sm font-bold" disabled={busy} onClick={() => void editTemplate(template)} type="button">编辑</button>{template.status === 'published' ? <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-amber-200 text-sm font-bold text-amber-800" disabled={busy} onClick={() => void retract(template)} type="button"><Undo2 className="h-4 w-4" />撤回</button> : <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-brand-600 text-sm font-bold text-white" disabled={busy} onClick={() => void publish(template)} type="button"><Rocket className="h-4 w-4" />发布</button>}<button aria-label={`归档${template.name}`} className={`inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border text-sm font-bold ${template.status === 'published' ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400' : 'border-slate-200 text-slate-600'}`} disabled={busy || template.status === 'published'} onClick={() => void archive(template)} type="button"><Archive className="h-4 w-4" />归档</button></div> : <button className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-red-200 text-sm font-bold text-red-700" disabled={busy} onClick={() => void deleteArchived(template)} type="button"><Trash2 className="h-4 w-4" />删除模板</button>}</article>)}</div> : null}

    {draft ? <TemplateEditor busy={busy} categories={categories} draft={draft} errorMessage={message} onCancel={() => { setDraft(null); setMessage(null); }} onChange={setDraft} onDeleteReferenceImage={deleteReferenceImage} onPublishSave={() => void save(true)} onSave={() => void save()} onUploadReferenceImage={uploadReferenceImage} stores={auth.availableStores} /> : null}
    {categoryManagerOpen ? <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 p-4"><section className="mx-auto mt-10 max-w-lg rounded-xl bg-white p-4"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">任务分类管理</h2><button className="ui-icon-button" onClick={() => setCategoryManagerOpen(false)} type="button"><X className="h-5 w-5" /></button></div><div className="mt-3 flex gap-2"><input className="ui-input" onChange={(event) => setNewCategoryName(event.target.value)} placeholder="输入新分类名称" value={newCategoryName} /><button className="ui-button-primary shrink-0" disabled={busy} onClick={() => void addCategory()} type="button">新建</button></div><div className="mt-4 space-y-2">{categories.map((category) => <div className="flex min-h-11 items-center justify-between rounded-lg bg-slate-50 px-3" key={category.code}><b className="text-sm">{category.label}</b>{category.is_system ? <span className="text-xs text-slate-400">系统分类</span> : <button className="text-sm font-bold text-red-600" disabled={busy} onClick={() => void removeCategory(category)} type="button">删除</button>}</div>)}</div></section></div> : null}
    <ActionFeedbackDialog message={message ?? ''} onClose={() => setMessage(null)} open={status !== 'error' && Boolean(message)} title="操作未完成" tone="warning" />
    <SuccessToast message={successMessage} onClose={() => setSuccessMessage(null)} />
  </PageShell>;
}

function TemplateEditor({ busy, categories, draft, errorMessage, onCancel, onChange, onDeleteReferenceImage, onPublishSave, onSave, onUploadReferenceImage, stores }: { busy: boolean; categories: TaskCategoryRow[]; draft: TaskTemplateDraft; errorMessage: string | null; onCancel: () => void; onChange: (draft: TaskTemplateDraft) => void; onDeleteReferenceImage: (itemId: string, path: string) => Promise<void>; onPublishSave: () => void; onSave: () => void; onUploadReferenceImage: (itemId: string, file: File, onProgress: (progress: number) => void) => Promise<void>; stores: Array<{ id: string; name: string }> }) {
  const updateGroup = (index: number, group: TaskTemplateGroupDraft) => onChange({ ...draft, groups: draft.groups.map((entry, current) => current === index ? group : entry) });
  const removeGroup = (index: number) => onChange({ ...draft, groups: draft.groups.filter((_, current) => current !== index) });
  return <div className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog" aria-modal="true" aria-labelledby="template-editor-title"><div className="mx-auto max-w-3xl space-y-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))]"><header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5"><div><p className="text-xs font-bold text-brand-700">{draft.id ? '编辑模板' : '新建模板'}</p><h2 className="text-xl font-bold" id="template-editor-title">{draft.name || '未命名模板'}</h2></div><button aria-label="关闭模板编辑" className="ui-icon-button" onClick={onCancel} type="button"><X className="h-5 w-5" /></button></header>
    {errorMessage ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage}</p> : null}<section className="grid gap-3 rounded-lg bg-white p-4 shadow-sm sm:grid-cols-2"><label className="text-sm font-semibold">模板名称<input className="mt-1 min-h-11 w-full rounded-lg border p-3" onChange={(event) => onChange({ ...draft, name: event.target.value })} value={draft.name} /></label><label className="text-sm font-semibold">分类<select className="mt-1 min-h-11 w-full rounded-lg border px-3" onChange={(event) => onChange({ ...draft, category: event.target.value })} value={draft.category}>{categories.map((category) => <option key={category.code} value={category.code}>{category.label}</option>)}</select></label><label className="text-sm font-semibold sm:col-span-2">说明<textarea className="mt-1 min-h-20 w-full rounded-lg border p-3" onChange={(event) => onChange({ ...draft, description: event.target.value })} value={draft.description} /></label><p className="sm:col-span-2 rounded-lg bg-brand-50 p-3 text-xs leading-5 text-brand-800">任务模板只定义检查内容。单次任务的验收时间，以及周期任务的发布周期和验收周期，统一在“任务发布”时设置。</p><label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input checked={draft.requiresReview} onChange={(event) => onChange({ ...draft, requiresReview: event.target.checked })} type="checkbox" />需要管理员审核</label><label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input checked={draft.allowOverdue} onChange={(event) => onChange({ ...draft, allowOverdue: event.target.checked })} type="checkbox" />允许逾期补交</label><fieldset className="sm:col-span-2"><legend className="text-sm font-semibold">适用门店</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{stores.map((store) => <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm" key={store.id}><input checked={draft.storeIds.includes(store.id)} onChange={() => onChange({ ...draft, storeIds: draft.storeIds.includes(store.id) ? draft.storeIds.filter((id) => id !== store.id) : [...draft.storeIds, store.id] })} type="checkbox" />{store.name}</label>)}</div></fieldset></section>
    {!draft.id ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">选择参考图片后会先显示缩略图，并自动保存完整模板草稿、立即上传图片。请先填写模板名称、分组名称和项目名称等必填内容。</p> : null}
    {draft.groups.map((group, groupIndex) => <GroupEditor busy={busy} group={group} groupNumber={groupIndex + 1} key={group.id} onChange={(value) => updateGroup(groupIndex, value)} onDeleteReferenceImage={onDeleteReferenceImage} onRemove={() => removeGroup(groupIndex)} onUploadReferenceImage={onUploadReferenceImage} />)}
    <button className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-brand-200 bg-white px-4 font-bold text-brand-700" onClick={() => onChange({ ...draft, groups: [...draft.groups, createEmptyTemplateGroup()] })} type="button"><Plus className="h-4 w-4" />添加分组</button>
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 px-3 pt-2.5 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur"><div className="mx-auto grid max-w-3xl grid-cols-[3rem_1fr_1fr] gap-2"><button aria-label="取消模板编辑" className="ui-icon-button" onClick={onCancel} type="button"><X className="h-5 w-5" /></button><button className="ui-button-secondary px-2" disabled={busy} onClick={onSave} type="button">保存草稿</button><button className="ui-button-primary px-2" disabled={busy} onClick={onPublishSave} type="button"><Save className="h-4 w-4" />保存并发布</button></div></div>
  </div></div>;
}

function GroupEditor({ busy, group, groupNumber, onChange, onDeleteReferenceImage, onRemove, onUploadReferenceImage }: { busy: boolean; group: TaskTemplateGroupDraft; groupNumber: number; onChange: (group: TaskTemplateGroupDraft) => void; onDeleteReferenceImage: (itemId: string, path: string) => Promise<void>; onRemove: () => void; onUploadReferenceImage: (itemId: string, file: File, onProgress: (progress: number) => void) => Promise<void> }) {
  const updateItem = (index: number, item: TaskTemplateItemDraft) => onChange({ ...group, items: group.items.map((entry, current) => current === index ? item : entry) });
  return <section className="rounded-lg bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2"><span className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-bold text-white">分组 {groupNumber}</span><p className="text-xs text-slate-500">分组编号自动生成</p></div><div className="flex items-start gap-3"><div className="grid flex-1 gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">分组名称<input className="mt-1 min-h-11 w-full rounded-lg border p-3" onChange={(event) => onChange({ ...group, title: event.target.value })} value={group.title} /></label><label className="text-sm font-semibold">分组说明<input className="mt-1 min-h-11 w-full rounded-lg border p-3" onChange={(event) => onChange({ ...group, description: event.target.value })} value={group.description} /></label></div><button aria-label="删除分组" className="mt-5 h-11 w-11 text-red-600" onClick={onRemove} type="button"><Trash2 className="mx-auto h-5 w-5" /></button></div><div className="mt-4 space-y-3">{group.items.map((item, index) => <ItemEditor busy={busy} item={item} itemNumber={`${groupNumber}.${index + 1}`} key={item.id} onChange={(value) => updateItem(index, value)} onDeleteReferenceImage={onDeleteReferenceImage} onRemove={() => onChange({ ...group, items: group.items.filter((_, current) => current !== index) })} onUploadReferenceImage={onUploadReferenceImage} />)}</div><button className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-100 px-3 text-sm font-bold" onClick={() => onChange({ ...group, items: [...group.items, createEmptyTemplateItem()] })} type="button"><Plus className="h-4 w-4" />添加项目</button></section>;
}

function LegacyItemEditor({ busy, item, itemNumber, onChange, onRemove, onUploadReferenceImage }: { busy: boolean; item: TaskTemplateItemDraft; itemNumber: string; onChange: (item: TaskTemplateItemDraft) => void; onRemove: () => void; onUploadReferenceImage: (itemId: string, file: File, onProgress: (progress: number) => void) => Promise<void> }) {
  return <div className="rounded-lg border border-slate-200 p-3"><div className="mb-2 flex items-center gap-2"><span className="rounded-md bg-slate-800 px-2 py-1 text-xs font-bold text-white">项目 {itemNumber}</span><span className="text-xs text-slate-500">项目编号自动生成</span></div><div className="flex items-start gap-2"><div className="grid flex-1 gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">项目名称<input className="mt-1 min-h-10 w-full rounded-lg border p-2" onChange={(event) => onChange({ ...item, label: event.target.value })} value={item.label} /></label><label className="text-sm font-semibold">字段类型<select className="mt-1 min-h-10 w-full rounded-lg border px-2" onChange={(event) => onChange({ ...item, fieldType: event.target.value as TaskTemplateItemDraft['fieldType'] })} value={item.fieldType}>{taskTemplateFieldTypes.map((type) => <option key={type} value={type}>{fieldTypeLabel[type]}</option>)}</select></label><label className="text-sm font-semibold sm:col-span-2">标准说明<input className="mt-1 min-h-10 w-full rounded-lg border p-2" onChange={(event) => onChange({ ...item, guidance: event.target.value })} value={item.guidance} /></label>{['single_choice', 'multi_choice'].includes(item.fieldType) ? <label className="text-sm font-semibold sm:col-span-2">选项（每行一个）<textarea className="mt-1 min-h-20 w-full rounded-lg border p-2" onChange={(event) => onChange({ ...item, optionsText: event.target.value })} value={item.optionsText} /></label> : null}<label className="text-sm font-semibold">图片要求<select className="mt-1 min-h-10 w-full rounded-lg border px-2" onChange={(event) => onChange({ ...item, imageRequirement: event.target.value as TaskTemplateItemDraft['imageRequirement'] })} value={item.imageRequirement}><option value="none">不要求</option><option value="single">至少一张</option><option value="multiple">多张图片</option></select></label><label className="flex items-end gap-2 pb-2 text-sm font-semibold"><input checked={item.isRequired} onChange={(event) => onChange({ ...item, isRequired: event.target.checked })} type="checkbox" />必填</label><div className="sm:col-span-2 rounded-lg bg-slate-50 p-2.5"><div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><b className="text-sm text-slate-800">参考图片（选填）</b><p className="mt-0.5 text-xs text-slate-500">选择后立即显示本地缩略图，并自动上传保存；支持多选。</p></div><TaskTemplateReferenceImageUpload disabled={busy} onUpload={(file, onProgress) => onUploadReferenceImage(item.id, file, onProgress)} /></div></div></div><button aria-label="删除项目" className="h-10 w-10 text-red-600" onClick={onRemove} type="button"><Trash2 className="mx-auto h-4 w-4" /></button></div></div>;
}

function ItemEditor(props: { busy: boolean; item: TaskTemplateItemDraft; itemNumber: string; onChange: (item: TaskTemplateItemDraft) => void; onDeleteReferenceImage: (itemId: string, path: string) => Promise<void>; onRemove: () => void; onUploadReferenceImage: (itemId: string, file: File, onProgress: (progress: number) => void) => Promise<void> }) {
  const { item } = props;
  const [activeReferenceUrl, setActiveReferenceUrl] = useState<string | null>(null);
  const removeReference = async (index: number) => {
    if (!window.confirm('删除这张参考图片吗？保存模板后将不再向员工展示。')) return;
    const path = item.referenceImagePaths[index];
    if (!path) return;
    await props.onDeleteReferenceImage(item.id, path);
  };
  return <><LegacyItemEditor {...props} />{item.referenceImageUrls.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">{item.referenceImageUrls.map((url, index) => <div className="relative" key={item.referenceImagePaths[index] ?? url}><button aria-label={`全屏查看参考图片 ${index + 1}`} className="block overflow-hidden rounded-lg border" onClick={() => setActiveReferenceUrl(url)} type="button"><img alt={`参考图片 ${index + 1}`} className="h-16 w-16 object-cover" src={url} /></button><button aria-label={`删除参考图片 ${index + 1}`} className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-red-600 text-xs font-bold text-white" disabled={props.busy} onClick={() => void removeReference(index)} type="button">×</button></div>)}</div> : null}{activeReferenceUrl ? <div aria-label="管理员参考图片全屏预览" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4" onClick={() => setActiveReferenceUrl(null)} role="dialog"><button aria-label="关闭参考图片预览" className="absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white" onClick={() => setActiveReferenceUrl(null)} type="button"><X className="h-6 w-6" /></button><img alt="管理员参考图片大图" className="max-h-full max-w-full object-contain" onClick={() => setActiveReferenceUrl(null)} src={activeReferenceUrl} /></div> : null}</>;
}
