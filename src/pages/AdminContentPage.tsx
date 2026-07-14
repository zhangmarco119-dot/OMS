import { Archive, Download, FileText, FileUp, FolderPlus, Pin, Plus, RefreshCw, Rocket, Save, Trash2, Undo2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { SuccessToast } from '../components/feedback/SuccessToast';
import { FeedbackBanner } from '../components/ui/Feedback';
import { useAuth } from '../features/auth/AuthContext';
import { createSopBatchTemplate, importSopBatch } from '../features/content/sopBatchImport';
import { formatSopActionError, type SopSaveStage } from '../features/content/sopFeedback';
import { SopImageUpload, type SopImageUploadStatus } from '../features/content/SopImageUpload';
import { supabase } from '../lib/supabase';
import { loadTaskTemplates, type TaskTemplateListItem } from '../services/task-templates.service';
import {
  archiveSop,
  createEmptyNoticeDraft,
  createEmptySopDraft,
  createSopCategory,
  deleteSopCategory,
  deleteSopAsset,
  deleteNotice,
  loadNotices,
  loadSopCategories,
  loadSops,
  publishNotice,
  publishSop,
  retractNotice,
  saveNotice,
  saveSop,
  uploadSopAsset,
  uploadNoticeAsset,
  updateSopAssetSteps,
  type NoticeDraft,
  type NoticeListItem,
  type SopDraft,
  type SopListItem,
  type SopCategoryRow,
} from '../services/v2-content.service';

type ContentTab = 'notices' | 'sops';
type ContentRecipient = { display_name: string; id: string; role: 'staff' | 'manager'; store_id: string };

const noticeStatus: Record<NoticeListItem['status'], string> = { draft: '草稿', published: '已发布', retracted: '已撤回' };
const sopStatus: Record<SopListItem['status'], string> = { archived: '已归档', draft: '草稿', published: '已发布' };

export function AdminContentPage() {
  const auth = useAuth();
  const [tab, setTab] = useState<ContentTab>('notices');
  const [notices, setNotices] = useState<NoticeListItem[]>([]);
  const [sops, setSops] = useState<SopListItem[]>([]);
  const [sopCategories, setSopCategories] = useState<SopCategoryRow[]>([]);
  const [templates, setTemplates] = useState<TaskTemplateListItem[]>([]);
  const [recipientProfiles, setRecipientProfiles] = useState<ContentRecipient[]>([]);
  const [noticeDraft, setNoticeDraft] = useState<NoticeDraft | null>(null);
  const [sopDraft, setSopDraft] = useState<SopDraft | null>(null);
  const [showSopBatchImport, setShowSopBatchImport] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sopDraftRef = useRef<SopDraft | null>(null);
  const sopsRef = useRef<SopListItem[]>([]);

  useEffect(() => { sopDraftRef.current = sopDraft; }, [sopDraft]);
  useEffect(() => { sopsRef.current = sops; }, [sops]);

  const updateSopDraft = (nextDraft: SopDraft | null) => {
    sopDraftRef.current = nextDraft;
    setSopDraft(nextDraft);
  };

  const updateSops = (nextSops: SopListItem[]) => {
    sopsRef.current = nextSops;
    setSops(nextSops);
  };

  const refresh = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage('缺少 Supabase 配置，暂时无法管理公告和 SOP。'); return; }
    setStatus('loading');
    try { const [nextNotices, nextSops, nextCategories, nextTemplates, profiles] = await Promise.all([loadNotices(supabase), loadSops(supabase), loadSopCategories(supabase), loadTaskTemplates(supabase), supabase.from('profiles').select('id,display_name,role,store_id').in('role', ['staff', 'manager']).eq('is_active', true).is('deleted_at', null)]); if (profiles.error) throw new Error(profiles.error.message); setNotices(nextNotices); setSops(nextSops); setSopCategories(nextCategories); setTemplates(nextTemplates); setRecipientProfiles((profiles.data ?? []) as ContentRecipient[]); setStatus('ready'); setMessage(null); }
    catch (error) { setStatus('error'); setMessage(error instanceof Error ? error.message : '加载公告和 SOP 失败。'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const defaultStores = auth.availableStores.map((store) => store.id);
  const storeName = (id: string) => auth.availableStores.find((store) => store.id === id)?.short_name ?? '未知门店';

  const saveNoticeDraft = async (publishAfterSave = false) => {
    if (!supabase || !noticeDraft) return;
    setBusy(true);
    try { const saved = await saveNotice(supabase, noticeDraft); if (publishAfterSave) await publishNotice(supabase, saved.id); setNoticeDraft(null); await refresh(); setSuccess(publishAfterSave ? '公告已发布。' : '公告草稿已保存。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存公告失败。'); }
    finally { setBusy(false); }
  };
  const saveSopDraft = async (publishAfterSave = false, changes: SopEditorChanges = { existingSteps: [], pendingAssets: [] }) => {
    if (!supabase || !sopDraft || !auth.profile) return false;
    setBusy(true);
    setMessage(null);
    let stage: SopSaveStage = 'saving';
    try {
      const saved = await saveSop(supabase, sopDraft);
      updateSopDraft({ ...sopDraft, id: saved.id });
      stage = 'uploading';
      await updateSopAssetSteps(supabase, changes.existingSteps);
      for (const asset of changes.pendingAssets) await uploadSopAsset(supabase, { file: asset.file, profileId: auth.profile.id, sopId: saved.id, sortOrder: asset.sortOrder, stepText: asset.stepText });
      if (publishAfterSave) {
        stage = 'publishing';
        await publishSop(supabase, saved.id);
      }
      await refresh();
      setSuccess(publishAfterSave ? `SOP 已发布，${changes.pendingAssets.length ? `并上传 ${changes.pendingAssets.length} 个步骤或附件。` : '员工端将按生效时间展示。'}` : `SOP 草稿已保存${changes.pendingAssets.length ? `，已上传 ${changes.pendingAssets.length} 个步骤或附件。` : '。'}`);
      return true;
    }
    catch (error) { setMessage(formatSopActionError(stage, error)); return false; }
    finally { setBusy(false); }
  };
  const run = async (action: () => Promise<unknown>, successText: string) => {
    setBusy(true); setMessage(null);
    try { await action(); await refresh(); setSuccess(successText); }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失败。'); }
    finally { setBusy(false); }
  };
  const removeSopAsset = async (asset: SopListItem['assetUrls'][number]) => {
    const client = supabase;
    if (!client) return;
    setBusy(true); setMessage(null);
    try {
      await deleteSopAsset(client, asset);
      updateSops(sopsRef.current.map((sop) => ({ ...sop, assetUrls: sop.assetUrls.filter((entry) => entry.id !== asset.id) })));
      setSuccess('SOP 图片已删除。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除 SOP 图片失败。');
    } finally { setBusy(false); }
  };
  const uploadSopImage = async (file: File, onProgress: (progress: number) => void) => {
    const client = supabase; const profile = auth.profile; const currentDraft = sopDraftRef.current;
    if (!client || !profile || !currentDraft) throw new Error('SOP 草稿尚未加载。');
    setBusy(true); setMessage(null);
    try {
      // Persist the complete browser draft first. New SOPs need a durable id
      // before Storage and v2_sop_assets can form one atomic upload chain.
      const saved = await saveSop(client, currentDraft);
      const savedDraft = { ...currentDraft, id: saved.id };
      updateSopDraft(savedDraft);
      const existingSop = sopsRef.current.find((sop) => sop.id === saved.id);
      const sortOrder = Math.max(-1, ...(existingSop?.assetUrls.filter((asset) => asset.mime_type.startsWith('image/')).map((asset) => asset.sort_order) ?? [])) + 1;
      const uploaded = await uploadSopAsset(client, { file, profileId: profile.id, sopId: saved.id, sortOrder, stepText: '' }, onProgress);
      const nextSop: SopListItem = existingSop
        ? { ...existingSop, ...saved, assetUrls: [...existingSop.assetUrls, uploaded], roles: savedDraft.roles, storeIds: savedDraft.storeIds, taskTemplateId: savedDraft.taskTemplateId }
        : { ...saved, assetUrls: [uploaded], roles: savedDraft.roles, storeIds: savedDraft.storeIds, taskTemplateId: savedDraft.taskTemplateId };
      updateSops(existingSop
        ? sopsRef.current.map((sop) => sop.id === saved.id ? nextSop : sop)
        : [nextSop, ...sopsRef.current]);
      setSuccess('SOP 图片已上传并保存。');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '上传 SOP 图片失败。';
      setMessage(errorMessage);
      throw new Error(errorMessage);
    } finally { setBusy(false); }
  };
  const uploadNotice = async (file: File | undefined) => {
    const client = supabase; const profile = auth.profile; const noticeId = noticeDraft?.id;
    if (!file || !client || !profile || !noticeId) return;
    await run(() => uploadNoticeAsset(client, { file, noticeId, profileId: profile.id }), '公告附件已上传。');
  };
  const addSopCategory = async () => {
    const client = supabase; const profile = auth.profile;
    if (!client || !profile) return;
    const name = newCategoryName.trim();
    if (!name) { setMessage('请填写 SOP 分类名称。'); return; }
    await run(() => createSopCategory(client, { name, profileId: profile.id }), `SOP 分类“${name}”已创建。`);
    setNewCategoryName('');
  };
  const removeSopCategory = async (category: SopCategoryRow) => {
    const client = supabase;
    if (!client) return;
    const usageCount = sopsRef.current.filter((sop) => sop.category === category.name).length;
    if (usageCount > 0) {
      setMessage(`分类“${category.name}”仍有 ${usageCount} 个 SOP 在使用，请先修改这些 SOP 的分类。`);
      return;
    }
    if (!window.confirm(`确定删除 SOP 分类“${category.name}”吗？`)) return;
    await run(() => deleteSopCategory(client, category.id), `SOP 分类“${category.name}”已删除。`);
  };
  const runSopBatchImport = async (workbookFile: File, imageFiles: File[]) => {
    if (!supabase || !auth.profile) return false;
    setBusy(true); setMessage(null);
    try {
      const result = await importSopBatch(supabase, { imageFiles, profileId: auth.profile.id, stores: auth.availableStores, workbookFile });
      await refresh();
      setShowSopBatchImport(false);
      setSuccess(`批量导入完成：${result.imported} 个 SOP 草稿，${result.steps} 个图片步骤。`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'SOP 批量导入失败。');
      return false;
    } finally { setBusy(false); }
  };

  return <PageShell eyebrow="门店运营系统 · 管理员" title="公告与 SOP 管理" backTo="/app">
    <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-brand-700">门店内容管理</p><p className="mt-1 text-sm text-slate-500">公告按门店发布；SOP 同时按门店、角色和生效时间控制可见范围。</p></div><button aria-label="刷新内容" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200" onClick={() => void refresh()} type="button"><RefreshCw className="h-4 w-4" /></button></div><div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"><button className={`min-h-10 rounded-md text-sm font-bold ${tab === 'notices' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setTab('notices')} type="button">公告</button><button className={`min-h-10 rounded-md text-sm font-bold ${tab === 'sops' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setTab('sops')} type="button">SOP</button></div></section>
    {message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}
    {status === 'loading' ? <p className="rounded-lg bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">正在加载内容</p> : null}
    {tab === 'notices' ? <section className="space-y-3"><button className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white" onClick={() => { setSopDraft(null); setNoticeDraft(createEmptyNoticeDraft(defaultStores)); }} type="button"><Plus className="h-4 w-4" />新建公告</button>{notices.map((notice) => <article className="rounded-lg bg-white p-4 shadow-sm" key={notice.id}><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1 text-xs font-bold text-brand-700">{notice.is_pinned ? <><Pin className="h-3.5 w-3.5" />置顶</> : '公告'} · {noticeStatus[notice.status]}</p><h2 className="mt-1 text-lg font-bold text-slate-900">{notice.title}</h2><p className="mt-2 text-xs text-slate-500">门店：{notice.storeIds.map(storeName).join('、')} · {notice.readCount}/{notice.recipientCount} 已读{notice.expires_at ? ` · ${new Date(notice.expires_at).toLocaleDateString('zh-CN')} 到期` : ''}</p></div></div><p className="mt-3 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{notice.body || '暂无正文内容。'}</p><details className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><summary className="cursor-pointer font-bold text-slate-700">查看已读/未读人员</summary><div className="mt-2 grid gap-1">{notice.recipients.map((recipient) => { const profile = recipientProfiles.find((item) => item.id === recipient.profileId); return <p key={recipient.profileId} className="text-slate-600">{recipient.firstReadAt ? '已读' : '未读'} · {profile?.display_name ?? '已离职/未知账号'} · {recipient.firstReadAt ? new Date(recipient.firstReadAt).toLocaleString('zh-CN') : '尚未打开'}</p>; })}</div></details><div className="mt-4 grid grid-cols-3 gap-2"><button className="min-h-10 rounded-lg border border-slate-200 text-sm font-bold" disabled={busy} onClick={() => setNoticeDraft({ body: notice.body, expiresAt: notice.expires_at?.slice(0, 16) ?? '', id: notice.id, isPinned: notice.is_pinned, recipientIds: notice.recipientIds, requiresAcknowledgment: notice.requires_acknowledgment, storeIds: notice.storeIds, title: notice.title })} type="button">编辑</button>{notice.status !== 'published' ? <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-brand-600 text-sm font-bold text-white" disabled={busy} onClick={() => void run(() => publishNotice(supabase!, notice.id), '公告已发布。')} type="button"><Rocket className="h-4 w-4" />发布</button> : <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-amber-200 text-sm font-bold text-amber-800" disabled={busy} onClick={() => void run(() => retractNotice(supabase!, notice.id), '公告已撤回。')} type="button"><Undo2 className="h-4 w-4" />撤回</button>}<button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-red-200 text-sm font-bold text-red-700" disabled={busy} onClick={() => { if (window.confirm(`确定删除公告“${notice.title}”吗？删除后不可恢复。`)) void run(() => deleteNotice(supabase!, notice), '公告已删除。'); }} type="button"><Trash2 className="h-4 w-4" />删除</button></div></article>)}</section> : null}
    {tab === 'sops' ? <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2"><button className="ui-button-primary px-2" onClick={() => { setMessage(null); setNoticeDraft(null); setSopDraft(createEmptySopDraft(defaultStores)); }} type="button"><Plus className="h-4 w-4" />新建 SOP</button><button className="ui-button-secondary px-2" onClick={() => { setMessage(null); setShowSopBatchImport(true); }} type="button"><Upload className="h-4 w-4" />批量导入</button></div>
      <section className="ui-card p-4"><div className="flex items-center gap-2"><FolderPlus className="h-5 w-5 text-brand-700" /><h2 className="font-bold">SOP 分类管理</h2></div><div className="mt-3 flex gap-2"><label className="min-w-0 flex-1"><span className="sr-only">新分类名称</span><input className="ui-input" onChange={(event) => setNewCategoryName(event.target.value)} placeholder="例如：果茶制作" value={newCategoryName} /></label><button className="ui-button-primary shrink-0 px-4" disabled={busy} onClick={() => void addSopCategory()} type="button">创建</button></div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{sopCategories.map((entry) => { const usageCount = sops.filter((sop) => sop.category === entry.name).length; return <div className="flex min-w-0 items-center gap-1 rounded-lg bg-brand-50 py-1.5 pl-3 pr-1" key={entry.id}><span className="min-w-0 flex-1 truncate text-xs font-bold text-brand-700">{entry.name}<span className="ml-1 text-slate-500">{usageCount}</span></span><button aria-label={`删除分类 ${entry.name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-red-700 hover:bg-red-50 disabled:opacity-40" disabled={busy} onClick={() => void removeSopCategory(entry)} type="button"><Trash2 className="h-4 w-4" /></button></div>; })}</div><p className="mt-2 text-xs leading-5 text-slate-500">数字表示该分类下的 SOP 数量；仍在使用的分类需先调整 SOP 后才能删除。</p></section>
      {sops.map((sop) => <article className="ui-card overflow-hidden" key={sop.id}>{sop.assetUrls.find((asset) => asset.mime_type.startsWith('image/')) ? <img alt={`${sop.title} 制作预览`} className="aspect-[16/7] w-full object-cover" src={sop.assetUrls.find((asset) => asset.mime_type.startsWith('image/'))?.signedUrl} /> : null}<div className="p-4"><p className="text-xs font-bold text-brand-700">{sop.category} · v{sop.version} · {sopStatus[sop.status]}</p><h2 className="mt-1 text-lg font-bold text-slate-900">{sop.title}</h2><p className="mt-2 text-xs text-slate-500">门店：{sop.storeIds.map(storeName).join('、')} · 角色：{sop.roles.map((role) => role === 'staff' ? '员工' : '店长').join('、')}</p>{sop.taskTemplateId ? <p className="mt-1 text-xs text-slate-500">关联任务模板：{templates.find((template) => template.id === sop.taskTemplateId)?.name ?? '已关联模板'}</p> : null}<p className="mt-3 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{sop.body || '暂无整体说明。'}</p><p className="mt-2 text-xs text-slate-500">图片步骤 {sop.assetUrls.filter((asset) => asset.mime_type.startsWith('image/')).length} 个 · 附件 {sop.assetUrls.filter((asset) => !asset.mime_type.startsWith('image/')).length} 个</p><div className="mt-4 grid grid-cols-3 gap-2"><button className="ui-button-secondary px-2" disabled={busy} onClick={() => { setMessage(null); setSopDraft({ body: sop.body, category: sop.category, effectiveAt: sop.effective_at?.slice(0, 16) ?? '', id: sop.id, roles: sop.roles, storeIds: sop.storeIds, taskTemplateId: sop.taskTemplateId, title: sop.title }); }} type="button">编辑</button>{sop.status !== 'published' ? <button className="ui-button-primary px-2" disabled={busy} onClick={() => { setSopDraft({ body: sop.body, category: sop.category, effectiveAt: sop.effective_at?.slice(0, 16) ?? '', id: sop.id, roles: sop.roles, storeIds: sop.storeIds, taskTemplateId: sop.taskTemplateId, title: sop.title }); }} type="button"><Rocket className="h-4 w-4" />编辑发布</button> : <button className="ui-button-secondary px-2" disabled={busy} onClick={() => void run(() => archiveSop(supabase!, sop.id), 'SOP 已归档。')} type="button"><Archive className="h-4 w-4" />归档</button>}<span className="flex min-h-11 items-center justify-center rounded-lg bg-slate-50 px-1 text-center text-xs text-slate-500">{sop.effective_at ? `生效 ${new Date(sop.effective_at).toLocaleDateString('zh-CN')}` : '立即生效'}</span></div></div></article>)}
    </section> : null}
    {noticeDraft ? <NoticeEditor busy={busy} draft={noticeDraft} onCancel={() => setNoticeDraft(null)} onChange={setNoticeDraft} onPublish={() => void saveNoticeDraft(true)} onSave={() => void saveNoticeDraft()} onUpload={uploadNotice} recipients={recipientProfiles} stores={auth.availableStores} /> : null}
    {sopDraft ? <SopEditor busy={busy} categories={sopCategories.map((entry) => entry.name)} draft={sopDraft} errorMessage={message} existingAssets={sops.find((sop) => sop.id === sopDraft.id)?.assetUrls ?? []} onCancel={() => updateSopDraft(null)} onChange={updateSopDraft} onDeleteAsset={removeSopAsset} onPublish={(changes) => saveSopDraft(true, changes)} onSave={(changes) => saveSopDraft(false, changes)} onUploadImage={uploadSopImage} stores={auth.availableStores} templates={templates} /> : null}
    {showSopBatchImport ? <SopBatchImporter busy={busy} errorMessage={message} onCancel={() => setShowSopBatchImport(false)} onImport={runSopBatchImport} /> : null}
    <SuccessToast message={success} onClose={() => setSuccess(null)} />
  </PageShell>;
}

function StorePicker({ selected, stores, onChange }: { selected: string[]; stores: Array<{ id: string; name: string }>; onChange: (ids: string[]) => void }) {
  return <fieldset><legend className="text-sm font-semibold">适用门店</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{stores.map((store) => <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm" key={store.id}><input checked={selected.includes(store.id)} onChange={() => onChange(selected.includes(store.id) ? selected.filter((id) => id !== store.id) : [...selected, store.id])} type="checkbox" />{store.name}</label>)}</div></fieldset>;
}

export function NoticeEditor({ busy, draft, onCancel, onChange, onPublish, onSave, onUpload, recipients, stores }: { busy: boolean; draft: NoticeDraft; onCancel: () => void; onChange: (value: NoticeDraft) => void; onPublish: () => void; onSave: () => void; onUpload: (file: File | undefined) => Promise<void>; recipients: ContentRecipient[]; stores: Array<{ id: string; name: string }> }) {
  const [roleFilter, setRoleFilter] = useState<'all' | 'staff' | 'manager'>('all');
  const visibleRecipients = recipients.filter((recipient) => draft.storeIds.includes(recipient.store_id) && (roleFilter === 'all' || recipient.role === roleFilter));
  const selectAll = () => onChange({ ...draft, recipientIds: visibleRecipients.map((recipient) => recipient.id) });
  return <div className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog" aria-modal="true" aria-labelledby="notice-editor-title">
    <div className="mx-auto max-w-3xl space-y-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
      <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5"><div><p className="text-xs font-bold text-brand-700">公告编辑</p><h2 className="text-xl font-bold" id="notice-editor-title">{draft.id ? '编辑公告' : '新建公告'}</h2></div><button aria-label="关闭公告编辑" className="ui-icon-button" onClick={onCancel} type="button"><X className="h-5 w-5" /></button></header>
      <section className="ui-card space-y-4 p-4">
        <label className="block text-sm font-semibold text-slate-700">公告标题<input className="ui-input mt-1.5" onChange={(event) => onChange({ ...draft, title: event.target.value })} value={draft.title} /></label>
        <label className="block text-sm font-semibold text-slate-700">公告正文<textarea className="ui-input mt-1.5 min-h-40 py-3 leading-7" onChange={(event) => onChange({ ...draft, body: event.target.value })} value={draft.body} /></label>
        <label className="block text-sm font-semibold text-slate-700">失效时间（可选）<input className="ui-input mt-1.5" onChange={(event) => onChange({ ...draft, expiresAt: event.target.value })} type="datetime-local" value={draft.expiresAt} /></label>
        <div className="grid gap-2 sm:grid-cols-2"><label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold"><input checked={draft.isPinned} onChange={(event) => onChange({ ...draft, isPinned: event.target.checked })} type="checkbox" />置顶显示</label><label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold"><input checked={draft.requiresAcknowledgment} onChange={(event) => onChange({ ...draft, requiresAcknowledgment: event.target.checked })} type="checkbox" />要求接收人确认（计入待办）</label></div>
        <StorePicker onChange={(storeIds) => onChange({ ...draft, recipientIds: draft.recipientIds.filter((id) => recipients.some((recipient) => recipient.id === id && storeIds.includes(recipient.store_id))), storeIds })} selected={draft.storeIds} stores={stores} />
        <div><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">接收人员（已选 {draft.recipientIds.length} 人）</p><button className="ui-button-secondary px-3" onClick={selectAll} type="button">全选当前结果</button></div><div className="mt-2 grid grid-cols-3 gap-2"><button className={`min-h-11 rounded-lg border px-2 text-sm ${roleFilter === 'all' ? 'border-brand-600 bg-brand-50 font-bold text-brand-700' : 'border-slate-200'}`} onClick={() => setRoleFilter('all')} type="button">全部</button><button className={`min-h-11 rounded-lg border px-2 text-sm ${roleFilter === 'staff' ? 'border-brand-600 bg-brand-50 font-bold text-brand-700' : 'border-slate-200'}`} onClick={() => setRoleFilter('staff')} type="button">员工</button><button className={`min-h-11 rounded-lg border px-2 text-sm ${roleFilter === 'manager' ? 'border-brand-600 bg-brand-50 font-bold text-brand-700' : 'border-slate-200'}`} onClick={() => setRoleFilter('manager')} type="button">店长</button></div><div className="mt-2 grid gap-2 sm:grid-cols-2">{visibleRecipients.map((recipient) => <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm" key={recipient.id}><input checked={draft.recipientIds.includes(recipient.id)} onChange={() => onChange({ ...draft, recipientIds: draft.recipientIds.includes(recipient.id) ? draft.recipientIds.filter((id) => id !== recipient.id) : [...draft.recipientIds, recipient.id] })} type="checkbox" />{recipient.display_name} · {recipient.role === 'staff' ? '员工' : '店长'}</label>)}</div></div>
        {draft.id ? <label className="ui-button-secondary w-fit cursor-pointer"><FileUp className="h-4 w-4" />上传图片或 PDF<input accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={busy} onChange={(event) => { void onUpload(event.target.files?.[0]); event.currentTarget.value = ''; }} type="file" /></label> : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">保存草稿后即可上传图片或 PDF 附件。</p>}
      </section>
    </div>
    <EditorActions busy={busy} onCancel={onCancel} onPublish={onPublish} onSave={onSave} publishLabel="发布公告" />
  </div>;
}

type PendingSopAsset = { file: File; key: string; previewUrl: string | null; sortOrder: number; stepText: string };
type ExistingSopStep = { id: string; sortOrder: number; stepText: string };
type SopEditorChanges = { existingSteps: ExistingSopStep[]; pendingAssets: Array<{ file: File; sortOrder: number; stepText: string }> };

export function SopEditor({ busy, categories, draft, errorMessage, existingAssets, onCancel, onChange, onDeleteAsset, onPublish, onSave, onUploadImage, stores, templates }: {
  busy: boolean;
  categories: string[];
  draft: SopDraft;
  errorMessage: string | null;
  existingAssets: SopListItem['assetUrls'];
  onCancel: () => void;
  onChange: (value: SopDraft) => void;
  onDeleteAsset: (asset: SopListItem['assetUrls'][number]) => Promise<void>;
  onPublish: (changes: SopEditorChanges) => Promise<boolean>;
  onSave: (changes: SopEditorChanges) => Promise<boolean>;
  onUploadImage: (file: File, onProgress: (progress: number) => void) => Promise<void>;
  stores: Array<{ id: string; name: string }>;
  templates: TaskTemplateListItem[];
}) {
  const [pendingAssets, setPendingAssets] = useState<PendingSopAsset[]>([]);
  const [existingSteps, setExistingSteps] = useState<ExistingSopStep[]>(() => existingAssets.filter((asset) => asset.mime_type.startsWith('image/')).map((asset) => ({ id: asset.id, sortOrder: asset.sort_order, stepText: asset.step_text })));
  const [activeImage, setActiveImage] = useState<{ alt: string; url: string } | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<SopImageUploadStatus>({ hasErrors: false, isUploading: false });
  const previewUrls = useRef<string[]>([]);

  useEffect(() => () => previewUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  useEffect(() => {
    setExistingSteps((current) => existingAssets.filter((asset) => asset.mime_type.startsWith('image/')).map((asset) => current.find((entry) => entry.id === asset.id) ?? { id: asset.id, sortOrder: asset.sort_order, stepText: asset.step_text }));
  }, [existingAssets]);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setPendingAssets((current) => {
      const firstOrder = Math.max(-1, ...existingSteps.map((step) => step.sortOrder), ...current.map((asset) => asset.sortOrder)) + 1;
      const additions = Array.from(files).map((file, index) => {
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
        if (previewUrl) previewUrls.current.push(previewUrl);
        return { file, key: `${file.name}-${file.size}-${file.lastModified}-${index}`, previewUrl, sortOrder: firstOrder + index, stepText: '' };
      });
      return [...current, ...additions];
    });
  };

  const removePending = (key: string) => {
    setPendingAssets((current) => {
      const target = current.find((asset) => asset.key === key);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrls.current = previewUrls.current.filter((url) => url !== target.previewUrl);
      }
      return current.filter((asset) => asset.key !== key);
    });
  };

  const submit = async (action: (changes: SopEditorChanges) => Promise<boolean>, publish: boolean) => {
    if (uploadStatus.isUploading) { setValidationMessage('图片仍在上传，请等待上传完成后再保存或发布。'); return; }
    if (uploadStatus.hasErrors) { setValidationMessage('仍有图片上传失败，请重试或移除失败图片后再继续。'); return; }
    if (publish && existingSteps.length === 0) { setValidationMessage('发布 SOP 前请至少添加一个图片步骤。'); return; }
    if (publish && existingSteps.some((step) => !step.stepText.trim())) { setValidationMessage('每一张步骤图片都需要填写对应的步骤说明。'); return; }
    setValidationMessage(null);
    const succeeded = await action({ existingSteps, pendingAssets: pendingAssets.map((asset) => ({ file: asset.file, sortOrder: asset.sortOrder, stepText: asset.stepText })) });
    if (!succeeded) return;
    pendingAssets.forEach((asset) => { if (asset.previewUrl) URL.revokeObjectURL(asset.previewUrl); });
    previewUrls.current = [];
    setPendingAssets([]);
  };

  const existingImages = existingAssets.filter((asset) => asset.mime_type.startsWith('image/')).sort((left, right) => left.sort_order - right.sort_order);
  const existingDocuments = existingAssets.filter((asset) => !asset.mime_type.startsWith('image/'));
  const pendingDocuments = pendingAssets.filter((asset) => !asset.file.type.startsWith('image/'));

  return <div className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog" aria-modal="true" aria-labelledby="sop-editor-title">
    <div className="mx-auto max-w-3xl space-y-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
      <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5">
        <div className="min-w-0"><p className="text-xs font-bold text-brand-700">食品制作 SOP</p><h2 className="truncate text-xl font-bold" id="sop-editor-title">{draft.id ? '编辑制作流程' : '新建制作流程'}</h2></div>
        <button aria-label="关闭 SOP 编辑" className="ui-icon-button" onClick={onCancel} type="button"><X className="h-5 w-5" /></button>
      </header>

      {errorMessage || validationMessage ? <FeedbackBanner title="SOP 操作未完成" tone="danger">{errorMessage ?? validationMessage}</FeedbackBanner> : null}

      <section className="ui-card grid gap-3 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><p className="text-xs font-bold text-brand-700">01 · 基本信息</p><h3 className="mt-1 font-bold text-slate-900">这份 SOP 制作什么？</h3></div>
        <label className="text-sm font-semibold text-slate-700">产品或流程名称<input className="ui-input mt-1.5" onChange={(event) => onChange({ ...draft, title: event.target.value })} placeholder="例如：芒果酸奶碗（标准版）" value={draft.title} /></label>
        <label className="text-sm font-semibold text-slate-700">制作分类<select className="ui-input mt-1.5" onChange={(event) => onChange({ ...draft, category: event.target.value })} value={draft.category}><option value="">请选择分类</option>{!categories.includes(draft.category) && draft.category ? <option value={draft.category}>{draft.category}</option> : null}{categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
      </section>

      <section className="ui-card p-4">
        <div><p className="text-xs font-bold text-brand-700">02 · 图片步骤</p><h3 className="mt-1 font-bold text-slate-900">每一步都是一张图片加一段文字</h3><p className="mt-1 text-sm leading-6 text-slate-500">按制作顺序选择图片，然后在每张图片下填写用量、操作和合格标准。员工端会将全部步骤连续拼成一个页面。</p></div>
        {!draft.id ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-800">首次选择图片时会自动保存 SOP 草稿。请先填写产品或流程名称；分类、门店和角色也必须保持有效。</p> : null}
        <SopImageUpload disabled={busy} onStatusChange={setUploadStatus} onUpload={onUploadImage} />
        {existingImages.length ? <div className="mt-3 space-y-3">
          {existingImages.map((asset, index) => { const step = existingSteps.find((entry) => entry.id === asset.id) ?? { id: asset.id, sortOrder: asset.sort_order, stepText: asset.step_text }; return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" key={asset.id}><button aria-label={`放大查看制作图片 ${index + 1}`} className="block w-full" onClick={() => setActiveImage({ alt: asset.file_name, url: asset.signedUrl })} type="button"><img alt={asset.file_name} className="max-h-96 w-full bg-slate-50 object-contain" src={asset.signedUrl} /></button><div className="space-y-2 p-3"><div className="flex items-center gap-2"><label className="text-xs font-bold text-slate-600">步骤序号<input className="ml-2 h-9 w-20 rounded-lg border border-slate-200 px-2" min="1" onChange={(event) => setExistingSteps((current) => current.map((entry) => entry.id === asset.id ? { ...entry, sortOrder: Math.max(0, Number(event.target.value) - 1) } : entry))} type="number" value={step.sortOrder + 1} /></label><span className="min-w-0 flex-1 truncate text-xs text-slate-500">已上传</span><button aria-label={`删除 ${asset.file_name}`} className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" disabled={busy} onClick={() => { if (window.confirm(`确定删除制作图片“${asset.file_name}”吗？`)) void onDeleteAsset(asset); }} type="button"><Trash2 className="h-4 w-4" /></button></div><label className="block text-sm font-semibold">步骤说明<textarea className="ui-input mt-1.5 min-h-24 py-2" onChange={(event) => setExistingSteps((current) => current.map((entry) => entry.id === asset.id ? { ...entry, stepText: event.target.value } : entry))} placeholder="填写该图对应的用量、操作和合格标准" value={step.stepText} /></label></div></div>; })}
        </div> : uploadStatus.isUploading || uploadStatus.hasErrors ? null : <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">尚未上传图片。选择后会立即显示缩略图，并自动保存到当前 SOP。</p>}
      </section>

      <section className="ui-card p-4">
        <p className="text-xs font-bold text-brand-700">03 · 整体说明</p><label className="mt-1 block text-sm font-semibold text-slate-700">SOP 用途、适用范围或特别提醒（可选）<textarea className="ui-input mt-1.5 min-h-32 py-3 leading-7" onChange={(event) => onChange({ ...draft, body: event.target.value })} placeholder="例如：适用于标准版芒果酸奶碗；制作前需确认顾客过敏信息。" value={draft.body} /></label>
      </section>

      <section className="ui-card space-y-4 p-4">
        <div><p className="text-xs font-bold text-brand-700">04 · 发布范围</p><h3 className="mt-1 font-bold text-slate-900">谁可以看到这份 SOP？</h3></div>
        <label className="block text-sm font-semibold text-slate-700">生效时间（不填则发布后立即生效）<input className="ui-input mt-1.5" onChange={(event) => onChange({ ...draft, effectiveAt: event.target.value })} type="datetime-local" value={draft.effectiveAt} /></label>
        <fieldset><legend className="text-sm font-semibold text-slate-700">适用角色</legend><div className="mt-2 grid grid-cols-2 gap-2"><label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm"><input checked={draft.roles.includes('staff')} onChange={() => onChange({ ...draft, roles: draft.roles.includes('staff') ? draft.roles.filter((role) => role !== 'staff') : [...draft.roles, 'staff'] })} type="checkbox" />员工</label><label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm"><input checked={draft.roles.includes('manager')} onChange={() => onChange({ ...draft, roles: draft.roles.includes('manager') ? draft.roles.filter((role) => role !== 'manager') : [...draft.roles, 'manager'] })} type="checkbox" />店长</label></div></fieldset>
        <StorePicker onChange={(storeIds) => onChange({ ...draft, storeIds })} selected={draft.storeIds} stores={stores} />
        <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-700">高级设置：关联任务模板</summary><label className="mt-3 block text-sm font-semibold text-slate-700">关联任务模板<select className="ui-input mt-1.5" onChange={(event) => onChange({ ...draft, taskTemplateId: event.target.value || null })} value={draft.taskTemplateId ?? ''}><option value="">不关联</option>{templates.filter((template) => template.status === 'published').map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label></details>
        {draft.id ? <label className="ui-button-secondary w-fit cursor-pointer"><FileUp className="h-4 w-4" />补充 PDF 文件<input accept="application/pdf" className="hidden" disabled={busy} multiple onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ''; }} type="file" /></label> : null}
        {existingDocuments.length || pendingDocuments.length ? <div className="space-y-2">{existingDocuments.map((asset) => <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-2" key={asset.id}><FileText className="h-4 w-4 text-slate-500" /><span className="min-w-0 flex-1 truncate text-sm">{asset.file_name}</span><button aria-label={`删除 ${asset.file_name}`} className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" onClick={() => { if (window.confirm(`确定删除附件“${asset.file_name}”吗？`)) void onDeleteAsset(asset); }} type="button"><Trash2 className="h-4 w-4" /></button></div>)}{pendingDocuments.map((asset) => <div className="flex items-center gap-2 rounded-lg bg-brand-50 p-2" key={asset.key}><FileText className="h-4 w-4 text-brand-700" /><span className="min-w-0 flex-1 truncate text-sm">{asset.file.name}（待上传）</span><button aria-label={`移除 ${asset.file.name}`} className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" onClick={() => removePending(asset.key)} type="button"><Trash2 className="h-4 w-4" /></button></div>)}</div> : null}
      </section>
    </div>
    <EditorActions busy={busy} onCancel={onCancel} onPublish={() => void submit(onPublish, true)} onSave={() => void submit(onSave, false)} publishLabel="发布 SOP" />
    {activeImage ? <div aria-label="SOP 图片全屏预览" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4" onClick={() => setActiveImage(null)} role="dialog"><button aria-label="关闭图片预览" className="absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white" onClick={() => setActiveImage(null)} type="button"><X className="h-6 w-6" /></button><img alt={activeImage.alt} className="max-h-full max-w-full object-contain" onClick={() => setActiveImage(null)} src={activeImage.url} /></div> : null}
  </div>;
}

function SopBatchImporter({ busy, errorMessage, onCancel, onImport }: { busy: boolean; errorMessage: string | null; onCancel: () => void; onImport: (workbookFile: File, imageFiles: File[]) => Promise<boolean> }) {
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([createSopBatchTemplate()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'SOP批量导入模板.xlsx'; anchor.click();
    URL.revokeObjectURL(url);
  };
  const submit = async () => {
    if (!workbookFile) { setLocalError('请先选择 SOP Excel 清单。'); return; }
    if (!imageFiles.length) { setLocalError('请选择 Excel 中列出的全部步骤图片。'); return; }
    setLocalError(null);
    await onImport(workbookFile, imageFiles);
  };
  return <div className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto bg-canvas px-3 pt-3" role="dialog" aria-modal="true" aria-labelledby="sop-batch-title"><div className="mx-auto max-w-2xl space-y-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))]"><header className="ui-card sticky top-0 z-20 flex items-center justify-between p-4"><div><p className="text-xs font-bold text-brand-700">SOP 批量导入</p><h2 className="text-xl font-bold" id="sop-batch-title">Excel 清单＋步骤图片</h2></div><button aria-label="关闭 SOP 批量导入" className="ui-icon-button" onClick={onCancel} type="button"><X className="h-5 w-5" /></button></header>{localError || errorMessage ? <FeedbackBanner title="无法开始导入" tone="danger">{localError ?? errorMessage}</FeedbackBanner> : null}<section className="ui-card space-y-4 p-4"><p className="text-sm leading-7 text-slate-600">模板中每一行代表一个“图片＋文字”步骤，同一产品的多行会合并为一个 SOP。导入后统一保存为草稿，请检查后手动发布。</p><button className="ui-button-secondary w-full" onClick={downloadTemplate} type="button"><Download className="h-4 w-4" />下载 Excel 模板</button><label className="block text-sm font-semibold">1. 选择已填写的 Excel<input accept=".xlsx,.xls" className="ui-input mt-2 py-2" onChange={(event) => setWorkbookFile(event.target.files?.[0] ?? null)} type="file" /></label>{workbookFile ? <p className="rounded-lg bg-brand-50 p-3 text-sm text-brand-800">已选：{workbookFile.name}</p> : null}<label className="block text-sm font-semibold">2. 选择 Excel 中的全部图片<input accept="image/jpeg,image/png,image/webp" className="ui-input mt-2 py-2" multiple onChange={(event) => setImageFiles(Array.from(event.target.files ?? []))} type="file" /></label><p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">已选择 {imageFiles.length} 张图片。文件名必须与 Excel 中完全一致。</p></section></div><div className="safe-bottom fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 px-3 pt-2.5"><div className="mx-auto grid max-w-2xl grid-cols-2 gap-2"><button className="ui-button-secondary" onClick={onCancel} type="button">取消</button><button className="ui-button-primary" disabled={busy} onClick={() => void submit()} type="button"><Upload className="h-4 w-4" />{busy ? '正在导入' : '开始导入草稿'}</button></div></div></div>;
}

function EditorActions({ busy, onCancel, onPublish, onSave, publishLabel = '保存并发布' }: { busy: boolean; onCancel: () => void; onPublish: () => void; onSave: () => void; publishLabel?: string }) {
  return <div className="safe-bottom fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 px-3 pt-2.5 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur"><div className="mx-auto grid max-w-3xl grid-cols-[3rem_1fr_1fr] gap-2"><button aria-label="取消编辑" className="ui-icon-button" onClick={onCancel} type="button"><X className="h-5 w-5" /></button><button className="ui-button-secondary px-2" disabled={busy} onClick={onSave} type="button">保存草稿</button><button className="ui-button-primary px-2" disabled={busy} onClick={onPublish} type="button"><Save className="h-4 w-4" />{publishLabel}</button></div></div>;
}
