import { Archive, Download, FileText, FileUp, FolderPlus, ImageIcon, Pin, Plus, RefreshCw, Rocket, Save, Trash2, Undo2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { SuccessToast } from '../components/feedback/SuccessToast';
import { FeedbackBanner } from '../components/ui/Feedback';
import { useAuth } from '../features/auth/AuthContext';
import { createSopBatchTemplate, importSopBatch } from '../features/content/sopBatchImport';
import { formatSopActionError, type SopSaveStage } from '../features/content/sopFeedback';
import { SopImageUpload, type SopImageUploadStatus } from '../features/content/SopImageUpload';
import { moveSopStep, normalizeSopSteps, type OrderedSopStep } from '../features/content/sopSteps';
import { getSopPreviewAsset } from '../features/content/sopPreview';
import { TaskTemplateReferenceImageUpload } from '../features/task-templates/TaskTemplateReferenceImageUpload';
import { supabase } from '../lib/supabase';
import { loadTaskTemplates, type TaskTemplateListItem } from '../services/task-templates.service';
import {
  archiveSop,
  createEmptyNoticeDraft,
  createEmptySopDraft,
  createSopCategory,
  deleteArchivedSop,
  deleteSopCategory,
  deleteSopAsset,
  deleteNotice,
  loadNotices,
  loadSopCategories,
  loadSops,
  publishNotice,
  publishSop,
  retractSop,
  reorderSopAssets,
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

export type AdminContentSection = 'notices' | 'sops';
type ContentRecipient = { display_name: string; id: string; role: 'staff' | 'manager'; store_id: string };

const noticeStatus: Record<NoticeListItem['status'], string> = { draft: '草稿', published: '已发布', retracted: '已撤回' };
const sopStatus: Record<SopListItem['status'], string> = { archived: '已归档', draft: '待发布', published: '已发布' };

export function AdminContentPage({ section }: { section: AdminContentSection }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [notices, setNotices] = useState<NoticeListItem[]>([]);
  const [sops, setSops] = useState<SopListItem[]>([]);
  const [sopCategories, setSopCategories] = useState<SopCategoryRow[]>([]);
  const [templates, setTemplates] = useState<TaskTemplateListItem[]>([]);
  const [recipientProfiles, setRecipientProfiles] = useState<ContentRecipient[]>([]);
  const [noticeDraft, setNoticeDraft] = useState<NoticeDraft | null>(null);
  const [sopDraft, setSopDraft] = useState<SopDraft | null>(null);
  const [showSopBatchImport, setShowSopBatchImport] = useState(false);
  const [showSopCategoryManager, setShowSopCategoryManager] = useState(false);
  const [showSopArchiveManager, setShowSopArchiveManager] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [sopCategoryFilter, setSopCategoryFilter] = useState('all');
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

  const withOrderedImages = (sop: SopListItem, orderedAssetIds: string[]): SopListItem => {
    const byId = new Map(sop.assetUrls.map((asset) => [asset.id, asset]));
    const images = orderedAssetIds.flatMap((id, index) => {
      const asset = byId.get(id);
      return asset ? [{ ...asset, sort_order: index }] : [];
    });
    return { ...sop, assetUrls: [...images, ...sop.assetUrls.filter((asset) => asset.asset_kind !== 'step')] };
  };

  const refresh = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage(`缺少 Supabase 配置，暂时无法管理${section === 'notices' ? '公告' : ' SOP'}。`); return; }
    setStatus('loading');
    try {
      if (section === 'notices') {
        const [nextNotices, profiles] = await Promise.all([
          loadNotices(supabase),
          supabase.from('profiles').select('id,display_name,role,store_id').in('role', ['staff', 'manager']).eq('is_active', true).is('deleted_at', null),
        ]);
        if (profiles.error) throw new Error(profiles.error.message);
        setNotices(nextNotices);
        setRecipientProfiles((profiles.data ?? []) as ContentRecipient[]);
      } else {
        const [nextSops, nextCategories, nextTemplates] = await Promise.all([
          loadSops(supabase),
          loadSopCategories(supabase),
          loadTaskTemplates(supabase),
        ]);
        sopsRef.current = nextSops;
        setSops(nextSops);
        setSopCategories(nextCategories);
        setTemplates(nextTemplates);
      }
      setStatus('ready');
      setMessage(null);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : `加载${section === 'notices' ? '公告' : ' SOP'}失败。`);
    }
  }, [section]);
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
  const saveSopDraft = async (publishAfterSave = false, changes: SopEditorChanges = { existingSteps: [], pendingAssets: [], silentPublish: false }) => {
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
        await publishSop(supabase, saved.id, { silent: changes.silentPublish });
      }
      await refresh();
      setSuccess(publishAfterSave
        ? changes.silentPublish
          ? 'SOP 已静默发布，员工可以查看，但不会收到发布通知。'
          : `SOP 已发布，${changes.pendingAssets.length ? `并上传 ${changes.pendingAssets.length} 个步骤或附件。` : '员工端将按生效时间展示。'}`
        : `SOP 草稿已保存${changes.pendingAssets.length ? `，已上传 ${changes.pendingAssets.length} 个步骤或附件。` : '。'}`);
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
    const owner = sopsRef.current.find((sop) => sop.assetUrls.some((entry) => entry.id === asset.id));
    if (!owner) return;
    setBusy(true); setMessage(null);
    try {
      const deletion = await deleteSopAsset(client, asset);
      const remainingIds = owner.assetUrls
        .filter((entry) => entry.id !== asset.id && entry.asset_kind === 'step')
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((entry) => entry.id);
      updateSops(sopsRef.current.map((sop) => sop.id === owner.id
        ? withOrderedImages({ ...sop, assetUrls: sop.assetUrls.filter((entry) => entry.id !== asset.id) }, remainingIds)
        : sop));
      await reorderSopAssets(client, owner.id, remainingIds);
      if (deletion.storageCleanupFailed) setMessage('记录已删除，但存储文件清理失败，请联系管理员处理。');
      setSuccess(asset.asset_kind === 'step'
        ? 'SOP 图片已删除，步骤序号已自动更新。'
        : asset.asset_kind === 'cover'
          ? 'SOP 产品图已删除，列表将自动使用最后一个步骤图。'
          : 'SOP 附件已删除。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除 SOP 图片失败。');
    } finally { setBusy(false); }
  };
  const uploadSopImage = async (file: File, insertAt: number, onProgress: (progress: number) => void) => {
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
      const currentImages = [...(existingSop?.assetUrls.filter((asset) => asset.asset_kind === 'step') ?? [])].sort((left, right) => left.sort_order - right.sort_order);
      const targetIndex = Math.max(0, Math.min(insertAt, currentImages.length));
      const uploaded = await uploadSopAsset(client, { file, profileId: profile.id, sopId: saved.id, sortOrder: targetIndex, stepText: '' }, onProgress);
      currentImages.splice(targetIndex, 0, uploaded);
      const orderedAssetIds = currentImages.map((entry) => entry.id);
      try {
        await reorderSopAssets(client, saved.id, orderedAssetIds);
      } catch (error) {
        await deleteSopAsset(client, uploaded).catch(() => undefined);
        throw error;
      }
      const nextSop: SopListItem = existingSop
        ? withOrderedImages({ ...existingSop, ...saved, assetUrls: [...existingSop.assetUrls, uploaded], roles: savedDraft.roles, storeIds: savedDraft.storeIds, taskTemplateId: savedDraft.taskTemplateId }, orderedAssetIds)
        : { ...saved, assetUrls: [{ ...uploaded, sort_order: 0 }], roles: savedDraft.roles, storeIds: savedDraft.storeIds, taskTemplateId: savedDraft.taskTemplateId };
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
  const uploadSopCover = async (file: File, onProgress: (progress: number) => void) => {
    const client = supabase; const profile = auth.profile; const currentDraft = sopDraftRef.current;
    if (!client || !profile || !currentDraft) throw new Error('SOP 草稿尚未加载。');
    setBusy(true); setMessage(null);
    try {
      const saved = await saveSop(client, currentDraft);
      const savedDraft = { ...currentDraft, id: saved.id };
      updateSopDraft(savedDraft);
      const existingSop = sopsRef.current.find((sop) => sop.id === saved.id);
      const oldCovers = existingSop?.assetUrls.filter((asset) => asset.asset_kind === 'cover') ?? [];
      const uploaded = await uploadSopAsset(client, {
        assetKind: 'cover', file, profileId: profile.id, sopId: saved.id, sortOrder: 0, stepText: '',
      }, onProgress);
      const baseAssets = existingSop?.assetUrls.filter((asset) => asset.asset_kind !== 'cover') ?? [];
      const nextSop: SopListItem = existingSop
        ? { ...existingSop, ...saved, assetUrls: [...baseAssets, uploaded], roles: savedDraft.roles, storeIds: savedDraft.storeIds, taskTemplateId: savedDraft.taskTemplateId }
        : { ...saved, assetUrls: [uploaded], roles: savedDraft.roles, storeIds: savedDraft.storeIds, taskTemplateId: savedDraft.taskTemplateId };
      updateSops(existingSop
        ? sopsRef.current.map((sop) => sop.id === saved.id ? nextSop : sop)
        : [nextSop, ...sopsRef.current]);
      for (const cover of oldCovers) await deleteSopAsset(client, cover).catch(() => undefined);
      setSuccess('SOP 产品图已上传并立即设为列表预览图。');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '上传 SOP 产品图失败。';
      setMessage(errorMessage);
      throw new Error(errorMessage);
    } finally { setBusy(false); }
  };
  const reorderSopImages = async (orderedAssetIds: string[]) => {
    const client = supabase; const sopId = sopDraftRef.current?.id;
    if (!client || !sopId) throw new Error('请先保存 SOP 草稿后再调整步骤顺序。');
    setBusy(true); setMessage(null);
    try {
      await reorderSopAssets(client, sopId, orderedAssetIds);
      updateSops(sopsRef.current.map((sop) => sop.id === sopId ? withOrderedImages(sop, orderedAssetIds) : sop));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '保存 SOP 步骤顺序失败。';
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
    if (sopCategoryFilter === category.name) setSopCategoryFilter('all');
  };
  const removeArchivedSop = async (sop: SopListItem) => {
    const client = supabase;
    if (!client || sop.status !== 'archived') return;
    if (!window.confirm(`确定永久删除已归档 SOP“${sop.title}”吗？相关图片和附件也会删除，且无法恢复。`)) return;
    await run(() => deleteArchivedSop(client, sop), `已归档 SOP“${sop.title}”已永久删除。`);
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

  const activeSops = sops.filter((sop) => sop.status !== 'archived');
  const archivedSops = sops.filter((sop) => sop.status === 'archived');
  const visibleSops = sopCategoryFilter === 'all' ? activeSops : activeSops.filter((sop) => sop.category === sopCategoryFilter);

  const pageCopy = section === 'notices'
    ? { description: '创建和发布门店公告，并查看员工已读情况。', label: '门店公告', title: '公告管理' }
    : { description: '创建、发布、分类和归档门店标准作业流程。', label: '标准作业流程', title: 'SOP 管理' };

  return <PageShell eyebrow="门店运营系统 · 管理员" title={pageCopy.title} backTo="/app/workbench">
    <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-brand-700">{pageCopy.label}</p><p className="mt-1 text-sm text-slate-500">{pageCopy.description}</p></div><button aria-label={`刷新${pageCopy.title}`} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200" onClick={() => void refresh()} type="button"><RefreshCw className="h-4 w-4" /></button></div></section>
    {message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}
    {status === 'loading' ? <p className="rounded-lg bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">正在加载内容</p> : null}
    {section === 'notices' ? <section className="space-y-3"><button className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white" onClick={() => { setSopDraft(null); setNoticeDraft(createEmptyNoticeDraft(defaultStores)); }} type="button"><Plus className="h-4 w-4" />新建公告</button>{notices.map((notice) => <article className="rounded-lg bg-white p-4 shadow-sm" key={notice.id}><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1 text-xs font-bold text-brand-700">{notice.is_pinned ? <><Pin className="h-3.5 w-3.5" />置顶</> : '公告'} · {noticeStatus[notice.status]}</p><h2 className="mt-1 text-lg font-bold text-slate-900">{notice.title}</h2><p className="mt-2 text-xs text-slate-500">门店：{notice.storeIds.map(storeName).join('、')} · {notice.readCount}/{notice.recipientCount} 已读{notice.expires_at ? ` · ${new Date(notice.expires_at).toLocaleDateString('zh-CN')} 到期` : ''}</p></div></div><p className="mt-3 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{notice.body || '暂无正文内容。'}</p><details className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><summary className="cursor-pointer font-bold text-slate-700">查看已读/未读人员</summary><div className="mt-2 grid gap-1">{notice.recipients.map((recipient) => { const profile = recipientProfiles.find((item) => item.id === recipient.profileId); return <p key={recipient.profileId} className="text-slate-600">{recipient.firstReadAt ? '已读' : '未读'} · {profile?.display_name ?? '已离职/未知账号'} · {recipient.firstReadAt ? new Date(recipient.firstReadAt).toLocaleString('zh-CN') : '尚未打开'}</p>; })}</div></details><div className="mt-4 grid grid-cols-3 gap-2"><button className="min-h-10 rounded-lg border border-slate-200 text-sm font-bold" disabled={busy} onClick={() => setNoticeDraft({ body: notice.body, expiresAt: notice.expires_at?.slice(0, 16) ?? '', id: notice.id, isPinned: notice.is_pinned, recipientIds: notice.recipientIds, requiresAcknowledgment: notice.requires_acknowledgment, storeIds: notice.storeIds, title: notice.title })} type="button">编辑</button>{notice.status !== 'published' ? <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-brand-600 text-sm font-bold text-white" disabled={busy} onClick={() => void run(() => publishNotice(supabase!, notice.id), '公告已发布。')} type="button"><Rocket className="h-4 w-4" />发布</button> : <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-amber-200 text-sm font-bold text-amber-800" disabled={busy} onClick={() => void run(() => retractNotice(supabase!, notice.id), '公告已撤回。')} type="button"><Undo2 className="h-4 w-4" />撤回</button>}<button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-red-200 text-sm font-bold text-red-700" disabled={busy} onClick={() => { if (window.confirm(`确定删除公告“${notice.title}”吗？删除后不可恢复。`)) void run(() => deleteNotice(supabase!, notice), '公告已删除。'); }} type="button"><Trash2 className="h-4 w-4" />删除</button></div></article>)}</section> : null}
    {section === 'sops' ? <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button className="ui-button-primary px-1 text-sm" onClick={() => { setMessage(null); setNoticeDraft(null); setSopDraft(createEmptySopDraft(defaultStores)); }} type="button"><Plus className="h-4 w-4" />新建 SOP</button>
        <button className="ui-button-secondary px-1 text-sm" onClick={() => { setMessage(null); setShowSopBatchImport(true); }} type="button"><Upload className="h-4 w-4" />批量导入</button>
        <button className="ui-button-secondary px-1 text-sm" onClick={() => { setMessage(null); setShowSopCategoryManager(true); }} type="button"><FolderPlus className="h-4 w-4" />分类管理</button>
        <button className="ui-button-secondary px-1 text-sm" onClick={() => { setMessage(null); setShowSopArchiveManager(true); }} type="button"><Archive className="h-4 w-4" />已归档（{archivedSops.length}）</button>
      </div>
      <section className="ui-card flex items-end gap-3 p-3">
        <label className="min-w-0 flex-1 text-sm font-bold text-slate-700">分类查看
          <select className="ui-input mt-1.5" onChange={(event) => setSopCategoryFilter(event.target.value)} value={sopCategoryFilter}>
            <option value="all">全部分类</option>
            {sopCategories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
          </select>
        </label>
        <span className="pb-3 text-xs text-slate-500">{visibleSops.length} 个 SOP</span>
      </section>
      {visibleSops.length === 0 ? <p className="ui-card p-6 text-center text-sm text-slate-500">当前分类暂无 SOP。</p> : null}
      {visibleSops.map((sop) => {
        const preview = getSopPreviewAsset(sop);
        const edit = () => { setMessage(null); setSopDraft({ body: sop.body, category: sop.category, effectiveAt: sop.effective_at?.slice(0, 16) ?? '', id: sop.id, roles: sop.roles, storeIds: sop.storeIds, taskTemplateId: sop.taskTemplateId, title: sop.title }); };
        const openPreview = () => navigate(`/app/sops/${sop.id}`);
        return <article aria-label={`预览 SOP ${sop.title}`} className="ui-card cursor-pointer p-3 transition hover:border-brand-200 hover:shadow-md" key={sop.id} onClick={(event) => { if (!(event.target as HTMLElement).closest('button,a,input,select,textarea')) openPreview(); }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openPreview(); } }} role="link" tabIndex={0}>
          <div className="flex gap-3">
            {preview ? <img alt={`${sop.title} 产品预览`} className="h-20 w-20 shrink-0 rounded-xl bg-slate-100 object-cover" src={preview.signedUrl} /> : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><ImageIcon className="h-7 w-7" /></div>}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-xs font-bold text-brand-700">{sop.category}</p><div className="shrink-0 text-right text-[11px] leading-4 text-slate-500"><p className="font-bold text-slate-700">{sopStatus[sop.status]}</p><p>{sop.effective_at ? `${new Date(sop.effective_at).toLocaleDateString('zh-CN')} 生效` : '尚未设置生效时间'}</p></div></div>
              <h2 className="mt-1 truncate text-base font-bold text-slate-900">{sop.title}</h2>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{sop.storeIds.map(storeName).join('、')} · {sop.roles.map((role) => role === 'staff' ? '员工' : '店长').join('、')}</p>
              <p className="mt-1 text-xs text-slate-500">步骤 {sop.assetUrls.filter((asset) => asset.asset_kind === 'step').length} · 附件 {sop.assetUrls.filter((asset) => asset.asset_kind === 'attachment').length}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button className="ui-button-secondary min-h-10 px-2 text-sm" disabled={busy} onClick={edit} type="button">编辑</button>
            {sop.status === 'draft' ? <button className="ui-button-primary min-h-10 px-2 text-sm" disabled={busy} onClick={edit} type="button"><Rocket className="h-4 w-4" />发布</button> : <button className="ui-button-secondary min-h-10 px-1 text-sm text-amber-800" disabled={busy} onClick={() => { if (window.confirm(`确定撤销发布 SOP“${sop.title}”吗？撤销后员工将无法查看，并恢复为待发布草稿。`)) void run(() => retractSop(supabase!, sop.id), 'SOP 已撤销发布并恢复为待发布草稿。'); }} type="button"><Undo2 className="h-4 w-4" />撤销发布</button>}
            <button className={`min-h-10 rounded-lg border px-2 text-sm font-bold ${sop.status === 'published' ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400' : 'border-slate-200 bg-white text-slate-700'}`} disabled={busy || sop.status === 'published'} onClick={() => { if (window.confirm(`确定归档 SOP“${sop.title}”吗？归档后请到“已归档”中管理。`)) void run(() => archiveSop(supabase!, sop.id), 'SOP 已归档。'); }} type="button"><span className="inline-flex items-center justify-center gap-1"><Archive className="h-4 w-4" />归档</span></button>
          </div>
        </article>;
      })}
    </section> : null}
    {noticeDraft ? <NoticeEditor busy={busy} draft={noticeDraft} onCancel={() => setNoticeDraft(null)} onChange={setNoticeDraft} onPublish={() => void saveNoticeDraft(true)} onSave={() => void saveNoticeDraft()} onUpload={uploadNotice} recipients={recipientProfiles} stores={auth.availableStores} /> : null}
    {sopDraft ? <SopEditor busy={busy} categories={sopCategories.map((entry) => entry.name)} draft={sopDraft} errorMessage={message} existingAssets={sops.find((sop) => sop.id === sopDraft.id)?.assetUrls ?? []} onCancel={() => updateSopDraft(null)} onChange={updateSopDraft} onDeleteAsset={removeSopAsset} onPublish={(changes) => saveSopDraft(true, changes)} onReorderImages={reorderSopImages} onSave={(changes) => saveSopDraft(false, changes)} onUploadCover={uploadSopCover} onUploadImage={uploadSopImage} status={sops.find((sop) => sop.id === sopDraft.id)?.status ?? 'new'} stores={auth.availableStores} templates={templates} /> : null}
    {showSopBatchImport ? <SopBatchImporter busy={busy} errorMessage={message} onCancel={() => setShowSopBatchImport(false)} onImport={runSopBatchImport} /> : null}
    {showSopCategoryManager ? <SopCategoryManager busy={busy} categories={sopCategories} errorMessage={message} newCategoryName={newCategoryName} onChangeName={setNewCategoryName} onClose={() => { setMessage(null); setShowSopCategoryManager(false); }} onCreate={addSopCategory} onDelete={removeSopCategory} sops={sops} /> : null}
    {showSopArchiveManager ? <SopArchiveManager busy={busy} onClose={() => { setMessage(null); setShowSopArchiveManager(false); }} onDelete={removeArchivedSop} sops={archivedSops} /> : null}
    <SuccessToast message={success} onClose={() => setSuccess(null)} />
  </PageShell>;
}

export function AdminAnnouncementsPage() {
  return <AdminContentPage section="notices" />;
}

export function AdminSopsPage() {
  return <AdminContentPage section="sops" />;
}

function StorePicker({ selected, stores, onChange }: { selected: string[]; stores: Array<{ id: string; name: string }>; onChange: (ids: string[]) => void }) {
  return <fieldset><legend className="text-sm font-semibold">适用门店</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{stores.map((store) => <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm" key={store.id}><input checked={selected.includes(store.id)} onChange={() => onChange(selected.includes(store.id) ? selected.filter((id) => id !== store.id) : [...selected, store.id])} type="checkbox" />{store.name}</label>)}</div></fieldset>;
}

function SopCategoryManager({ busy, categories, errorMessage, newCategoryName, onChangeName, onClose, onCreate, onDelete, sops }: {
  busy: boolean;
  categories: SopCategoryRow[];
  errorMessage: string | null;
  newCategoryName: string;
  onChangeName: (value: string) => void;
  onClose: () => void;
  onCreate: () => Promise<void>;
  onDelete: (category: SopCategoryRow) => Promise<void>;
  sops: SopListItem[];
}) {
  return <div aria-labelledby="sop-category-title" aria-modal="true" className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog">
    <div className="mx-auto max-w-2xl space-y-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5">
        <div><p className="text-xs font-bold text-brand-700">SOP 管理 · 分类管理</p><h2 className="text-xl font-bold" id="sop-category-title">制作分类</h2></div>
        <button aria-label="关闭 SOP 分类管理" className="ui-icon-button" onClick={onClose} type="button"><X className="h-5 w-5" /></button>
      </header>
      {errorMessage ? <FeedbackBanner title="分类操作未完成" tone="danger">{errorMessage}</FeedbackBanner> : null}
      <section className="ui-card p-4">
        <h3 className="font-bold text-slate-900">新建分类</h3>
        <div className="mt-3 flex gap-2"><label className="min-w-0 flex-1"><span className="sr-only">新分类名称</span><input className="ui-input" onChange={(event) => onChangeName(event.target.value)} placeholder="例如：果茶制作" value={newCategoryName} /></label><button className="ui-button-primary shrink-0 px-4" disabled={busy} onClick={() => void onCreate()} type="button">创建</button></div>
      </section>
      <section className="ui-card p-4">
        <div className="flex items-center justify-between gap-2"><h3 className="font-bold text-slate-900">已有分类</h3><span className="text-xs text-slate-500">{categories.length} 个</span></div>
        <div className="mt-3 divide-y divide-slate-100">{categories.map((category) => {
          const usageCount = sops.filter((sop) => sop.category === category.name).length;
          return <div className="flex items-center gap-3 py-2" key={category.id}><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><FolderPlus className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{category.name}</p><p className="text-xs text-slate-500">{usageCount} 个 SOP 正在使用</p></div><button aria-label={`删除分类 ${category.name}`} className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" disabled={busy || usageCount > 0} onClick={() => void onDelete(category)} title={usageCount > 0 ? '请先修改该分类下的 SOP' : '删除分类'} type="button"><Trash2 className="h-4 w-4" /></button></div>;
        })}</div>
        {!categories.length ? <p className="mt-3 rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">还没有 SOP 分类。</p> : null}
        <p className="mt-3 text-xs leading-5 text-slate-500">正在被 SOP 使用的分类不能直接删除，请先编辑对应 SOP 并更换分类。</p>
      </section>
    </div>
  </div>;
}

function SopArchiveManager({ busy, onClose, onDelete, sops }: {
  busy: boolean;
  onClose: () => void;
  onDelete: (sop: SopListItem) => Promise<void>;
  sops: SopListItem[];
}) {
  return <div aria-labelledby="sop-archive-title" aria-modal="true" className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog">
    <div className="mx-auto max-w-2xl space-y-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5">
        <div><p className="text-xs font-bold text-brand-700">SOP 管理 · 独立归档区</p><h2 className="text-xl font-bold" id="sop-archive-title">已归档 SOP</h2></div>
        <button aria-label="关闭已归档 SOP" className="ui-icon-button" onClick={onClose} type="button"><X className="h-5 w-5" /></button>
      </header>
      {sops.length ? <section className="space-y-2">{sops.map((sop) => {
        const preview = getSopPreviewAsset(sop);
        return <article className="ui-card flex items-center gap-3 p-3" key={sop.id}>
          {preview ? <img alt={`${sop.title} 归档预览`} className="h-16 w-16 shrink-0 rounded-lg bg-slate-100 object-cover" src={preview.signedUrl} /> : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400"><ImageIcon className="h-6 w-6" /></div>}
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-brand-700">{sop.category}</p><h3 className="mt-1 truncate font-bold text-slate-900">{sop.title}</h3><p className="mt-1 text-xs text-slate-500">已归档 · 步骤 {sop.assetUrls.filter((asset) => asset.asset_kind === 'step').length}</p></div>
          <button aria-label={`永久删除 ${sop.title}`} className="ui-icon-button h-10 w-10 shrink-0 border-transparent bg-red-50 text-red-700" disabled={busy} onClick={() => void onDelete(sop)} type="button"><Trash2 className="h-4 w-4" /></button>
        </article>;
      })}</section> : <p className="ui-card p-6 text-center text-sm text-slate-500">暂无已归档 SOP。</p>}
      <p className="px-2 text-xs leading-5 text-slate-500">永久删除会同时清理该 SOP 的产品图、制作步骤图片和附件，删除后无法恢复。</p>
    </div>
  </div>;
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
type ExistingSopStep = OrderedSopStep;
type SopEditorChanges = { existingSteps: ExistingSopStep[]; pendingAssets: Array<{ file: File; sortOrder: number; stepText: string }>; silentPublish: boolean };

export function SopEditor({ busy, categories, draft, errorMessage, existingAssets, onCancel, onChange, onDeleteAsset, onPublish, onReorderImages, onSave, onUploadCover, onUploadImage, status, stores, templates }: {
  busy: boolean;
  categories: string[];
  draft: SopDraft;
  errorMessage: string | null;
  existingAssets: SopListItem['assetUrls'];
  onCancel: () => void;
  onChange: (value: SopDraft) => void;
  onDeleteAsset: (asset: SopListItem['assetUrls'][number]) => Promise<void>;
  onPublish: (changes: SopEditorChanges) => Promise<boolean>;
  onReorderImages: (orderedAssetIds: string[]) => Promise<void>;
  onSave: (changes: SopEditorChanges) => Promise<boolean>;
  onUploadCover: (file: File, onProgress: (progress: number) => void) => Promise<void>;
  onUploadImage: (file: File, insertAt: number, onProgress: (progress: number) => void) => Promise<void>;
  status: SopListItem['status'] | 'new';
  stores: Array<{ id: string; name: string }>;
  templates: TaskTemplateListItem[];
}) {
  const [pendingAssets, setPendingAssets] = useState<PendingSopAsset[]>([]);
  const [existingSteps, setExistingSteps] = useState<ExistingSopStep[]>(() => normalizeSopSteps(existingAssets.filter((asset) => asset.asset_kind === 'step').map((asset) => ({ id: asset.id, sortOrder: asset.sort_order, stepText: asset.step_text }))));
  const [activeImage, setActiveImage] = useState<{ alt: string; url: string } | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<SopImageUploadStatus>({ hasErrors: false, isUploading: false });
  const [silentPublish, setSilentPublish] = useState(true);
  const previewUrls = useRef<string[]>([]);

  useEffect(() => () => previewUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  useEffect(() => {
    setExistingSteps((current) => normalizeSopSteps(existingAssets.filter((asset) => asset.asset_kind === 'step').map((asset) => current.find((entry) => entry.id === asset.id) ?? { id: asset.id, sortOrder: asset.sort_order, stepText: asset.step_text })));
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
    const normalizedSteps = normalizeSopSteps(existingSteps);
    if (publish && normalizedSteps.some((step) => !step.stepText.trim())) { setValidationMessage('每一张步骤图片都需要填写对应的步骤说明。'); return; }
    setValidationMessage(null);
    const succeeded = await action({ existingSteps: normalizedSteps, pendingAssets: pendingAssets.map((asset) => ({ file: asset.file, sortOrder: asset.sortOrder, stepText: asset.stepText })), silentPublish });
    if (!succeeded) return;
    pendingAssets.forEach((asset) => { if (asset.previewUrl) URL.revokeObjectURL(asset.previewUrl); });
    previewUrls.current = [];
    setPendingAssets([]);
  };

  const stepOrder = new Map(existingSteps.map((step) => [step.id, step.sortOrder]));
  const existingImages = existingAssets.filter((asset) => asset.asset_kind === 'step').sort((left, right) => (stepOrder.get(left.id) ?? left.sort_order) - (stepOrder.get(right.id) ?? right.sort_order));
  const existingCovers = existingAssets.filter((asset) => asset.asset_kind === 'cover').sort((left, right) => right.created_at.localeCompare(left.created_at));
  const existingCover = existingCovers[0] ?? null;
  const existingDocuments = existingAssets.filter((asset) => asset.asset_kind === 'attachment');
  const pendingDocuments = pendingAssets.filter((asset) => !asset.file.type.startsWith('image/'));

  const changeStepPosition = async (stepId: string, targetIndex: number) => {
    const previous = existingSteps;
    const next = moveSopStep(previous, stepId, targetIndex);
    setExistingSteps(next);
    setValidationMessage(null);
    try {
      await onReorderImages(next.map((step) => step.id));
    } catch (error) {
      setExistingSteps(previous);
      setValidationMessage(error instanceof Error ? error.message : '保存步骤顺序失败，请重试。');
    }
  };

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
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
          <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-800">产品预览图（选填）</p><p className="mt-1 text-xs leading-5 text-slate-500">用于管理员 SOP 列表的小图预览；未上传时自动使用最后一个制作步骤图片。</p></div><TaskTemplateReferenceImageUpload disabled={busy} multiple={false} onUpload={onUploadCover} /></div>
          {existingCover ? <div className="mt-3 flex items-center gap-3 rounded-lg bg-white p-2"><button aria-label="放大查看 SOP 产品图" className="shrink-0" onClick={() => setActiveImage({ alt: existingCover.file_name, url: existingCover.signedUrl })} type="button"><img alt={`${draft.title || 'SOP'} 产品图`} className="h-20 w-20 rounded-lg object-cover" src={existingCover.signedUrl} /></button><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{existingCover.file_name}</p><p className="mt-1 text-xs text-brand-700">当前列表预览图</p></div><button aria-label="删除 SOP 产品图" className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" disabled={busy} onClick={() => { if (window.confirm('确定删除当前产品预览图吗？删除后将自动使用最后一个步骤图。')) void onDeleteAsset(existingCover); }} type="button"><Trash2 className="h-4 w-4" /></button></div> : null}
        </div>
      </section>

      <section className="ui-card p-4">
        <div><p className="text-xs font-bold text-brand-700">02 · 图片步骤</p><h3 className="mt-1 font-bold text-slate-900">每一步都是一张图片加一段文字</h3><p className="mt-1 text-sm leading-6 text-slate-500">按制作顺序选择图片，然后在每张图片下填写用量、操作和合格标准。员工端会将全部步骤连续拼成一个页面。</p></div>
        {!draft.id ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-800">首次选择图片时会自动保存 SOP 草稿。请先填写产品或流程名称；分类、门店和角色也必须保持有效。</p> : null}
        <SopImageUpload disabled={busy} onStatusChange={setUploadStatus} onUpload={onUploadImage} stepCount={existingImages.length} />
        {existingImages.length ? <div className="mt-3 grid grid-cols-2 gap-2" data-testid="sop-step-grid">
          {existingImages.map((asset, index) => { const step = existingSteps.find((entry) => entry.id === asset.id) ?? { id: asset.id, sortOrder: index, stepText: asset.step_text }; return <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white" key={asset.id}><button aria-label={`放大查看制作图片 ${index + 1}`} className="block w-full" onClick={() => setActiveImage({ alt: asset.file_name, url: asset.signedUrl })} type="button"><img alt={asset.file_name} className="aspect-[4/3] w-full bg-slate-50 object-cover" src={asset.signedUrl} /></button><div className="space-y-2 p-2"><div className="flex items-end gap-1"><label className="min-w-0 flex-1 text-[11px] font-bold text-slate-600">步骤序号<select aria-label={`调整 ${asset.file_name} 的步骤序号`} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-1 text-sm" disabled={busy} onChange={(event) => void changeStepPosition(asset.id, Number(event.target.value))} value={step.sortOrder}>{existingImages.map((_, position) => <option key={position} value={position}>第 {position + 1} 步</option>)}</select></label><button aria-label={`删除 ${asset.file_name}`} className="ui-icon-button h-9 w-9 shrink-0 border-transparent bg-red-50 text-red-700" disabled={busy} onClick={() => { if (window.confirm(`确定删除制作图片“${asset.file_name}”吗？`)) void onDeleteAsset(asset); }} type="button"><Trash2 className="h-4 w-4" /></button></div><label className="block text-xs font-semibold">步骤说明<textarea className="ui-input mt-1 min-h-20 px-2 py-2 text-sm leading-5" onChange={(event) => setExistingSteps((current) => current.map((entry) => entry.id === asset.id ? { ...entry, stepText: event.target.value } : entry))} placeholder="用量、操作和标准" value={step.stepText} /></label></div></div>; })}
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
        {status !== 'published' ? <label className="flex min-h-12 items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm"><input checked={silentPublish} className="mt-1" onChange={(event) => setSilentPublish(event.target.checked)} type="checkbox" /><span><span className="block font-bold text-brand-900">静默发布</span><span className="mt-1 block leading-5 text-brand-800">发布后员工和店长可以正常查看 SOP，但不会收到新的发布通知。</span></span></label> : null}
        <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-700">高级设置：关联任务模板</summary><label className="mt-3 block text-sm font-semibold text-slate-700">关联任务模板<select className="ui-input mt-1.5" onChange={(event) => onChange({ ...draft, taskTemplateId: event.target.value || null })} value={draft.taskTemplateId ?? ''}><option value="">不关联</option>{templates.filter((template) => template.status === 'published').map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label></details>
        {draft.id ? <label className="ui-button-secondary w-fit cursor-pointer"><FileUp className="h-4 w-4" />补充 PDF 文件<input accept="application/pdf" className="hidden" disabled={busy} multiple onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ''; }} type="file" /></label> : null}
        {existingDocuments.length || pendingDocuments.length ? <div className="space-y-2">{existingDocuments.map((asset) => <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-2" key={asset.id}><FileText className="h-4 w-4 text-slate-500" /><span className="min-w-0 flex-1 truncate text-sm">{asset.file_name}</span><button aria-label={`删除 ${asset.file_name}`} className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" onClick={() => { if (window.confirm(`确定删除附件“${asset.file_name}”吗？`)) void onDeleteAsset(asset); }} type="button"><Trash2 className="h-4 w-4" /></button></div>)}{pendingDocuments.map((asset) => <div className="flex items-center gap-2 rounded-lg bg-brand-50 p-2" key={asset.key}><FileText className="h-4 w-4 text-brand-700" /><span className="min-w-0 flex-1 truncate text-sm">{asset.file.name}（待上传）</span><button aria-label={`移除 ${asset.file.name}`} className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" onClick={() => removePending(asset.key)} type="button"><Trash2 className="h-4 w-4" /></button></div>)}</div> : null}
      </section>
    </div>
    <EditorActions busy={busy} onCancel={onCancel} onPublish={status === 'published' ? undefined : () => void submit(onPublish, true)} onSave={() => void submit(onSave, false)} publishLabel="发布 SOP" saveLabel={status === 'published' ? '保存修改' : '保存草稿'} />
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

function EditorActions({ busy, onCancel, onPublish, onSave, publishLabel = '保存并发布', saveLabel = '保存草稿' }: { busy: boolean; onCancel: () => void; onPublish?: () => void; onSave: () => void; publishLabel?: string; saveLabel?: string }) {
  return <div className="safe-bottom fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 px-3 pt-2.5 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur"><div className={`mx-auto grid max-w-3xl gap-2 ${onPublish ? 'grid-cols-[3rem_1fr_1fr]' : 'grid-cols-[3rem_1fr]'}`}><button aria-label="取消编辑" className="ui-icon-button" onClick={onCancel} type="button"><X className="h-5 w-5" /></button><button className={onPublish ? 'ui-button-secondary px-2' : 'ui-button-primary px-2'} disabled={busy} onClick={onSave} type="button"><Save className="h-4 w-4" />{saveLabel}</button>{onPublish ? <button className="ui-button-primary px-2" disabled={busy} onClick={onPublish} type="button"><Rocket className="h-4 w-4" />{publishLabel}</button> : null}</div></div>;
}
