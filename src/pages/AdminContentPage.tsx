import { Archive, Eye, FileText, FileUp, ImagePlus, Pin, Plus, RefreshCw, Rocket, Save, Trash2, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { SuccessToast } from '../components/feedback/SuccessToast';
import { FeedbackBanner } from '../components/ui/Feedback';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadTaskTemplates, type TaskTemplateListItem } from '../services/task-templates.service';
import {
  archiveSop,
  createEmptyNoticeDraft,
  createEmptySopDraft,
  deleteSopAsset,
  deleteNotice,
  loadNotices,
  loadSops,
  publishNotice,
  publishSop,
  retractNotice,
  saveNotice,
  saveSop,
  uploadSopAsset,
  uploadNoticeAsset,
  type NoticeDraft,
  type NoticeListItem,
  type SopDraft,
  type SopListItem,
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
  const [templates, setTemplates] = useState<TaskTemplateListItem[]>([]);
  const [recipientProfiles, setRecipientProfiles] = useState<ContentRecipient[]>([]);
  const [noticeDraft, setNoticeDraft] = useState<NoticeDraft | null>(null);
  const [sopDraft, setSopDraft] = useState<SopDraft | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage('缺少 Supabase 配置，暂时无法管理公告和 SOP。'); return; }
    setStatus('loading');
    try { const [nextNotices, nextSops, nextTemplates, profiles] = await Promise.all([loadNotices(supabase), loadSops(supabase), loadTaskTemplates(supabase), supabase.from('profiles').select('id,display_name,role,store_id').in('role', ['staff', 'manager']).eq('is_active', true).is('deleted_at', null)]); if (profiles.error) throw new Error(profiles.error.message); setNotices(nextNotices); setSops(nextSops); setTemplates(nextTemplates); setRecipientProfiles((profiles.data ?? []) as ContentRecipient[]); setStatus('ready'); setMessage(null); }
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
  const saveSopDraft = async (publishAfterSave = false, pendingFiles: File[] = []) => {
    if (!supabase || !sopDraft || !auth.profile) return false;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveSop(supabase, sopDraft);
      setSopDraft({ ...sopDraft, id: saved.id });
      for (const file of pendingFiles) await uploadSopAsset(supabase, { file, profileId: auth.profile.id, sopId: saved.id });
      if (publishAfterSave) await publishSop(supabase, saved.id);
      await refresh();
      setSuccess(publishAfterSave ? `SOP 已发布，${pendingFiles.length ? `并上传 ${pendingFiles.length} 张制作图片。` : '员工端将按生效时间展示。'}` : `SOP 草稿已保存${pendingFiles.length ? `，已上传 ${pendingFiles.length} 张制作图片。` : '。'}`);
      return true;
    }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存 SOP 失败。'); return false; }
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
    await run(() => deleteSopAsset(client, asset), 'SOP 图片已删除。');
  };
  const uploadNotice = async (file: File | undefined) => {
    const client = supabase; const profile = auth.profile; const noticeId = noticeDraft?.id;
    if (!file || !client || !profile || !noticeId) return;
    await run(() => uploadNoticeAsset(client, { file, noticeId, profileId: profile.id }), '公告附件已上传。');
  };

  return <PageShell eyebrow="门店运营系统 · 管理员" title="公告与 SOP 管理" backTo="/app">
    <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-brand-700">门店内容管理</p><p className="mt-1 text-sm text-slate-500">公告按门店发布；SOP 同时按门店、角色和生效时间控制可见范围。</p></div><button aria-label="刷新内容" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200" onClick={() => void refresh()} type="button"><RefreshCw className="h-4 w-4" /></button></div><div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"><button className={`min-h-10 rounded-md text-sm font-bold ${tab === 'notices' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setTab('notices')} type="button">公告</button><button className={`min-h-10 rounded-md text-sm font-bold ${tab === 'sops' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setTab('sops')} type="button">SOP</button></div></section>
    {message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}
    {status === 'loading' ? <p className="rounded-lg bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">正在加载内容</p> : null}
    {tab === 'notices' ? <section className="space-y-3"><button className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white" onClick={() => { setSopDraft(null); setNoticeDraft(createEmptyNoticeDraft(defaultStores)); }} type="button"><Plus className="h-4 w-4" />新建公告</button>{notices.map((notice) => <article className="rounded-lg bg-white p-4 shadow-sm" key={notice.id}><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1 text-xs font-bold text-brand-700">{notice.is_pinned ? <><Pin className="h-3.5 w-3.5" />置顶</> : '公告'} · {noticeStatus[notice.status]}</p><h2 className="mt-1 text-lg font-bold text-slate-900">{notice.title}</h2><p className="mt-2 text-xs text-slate-500">门店：{notice.storeIds.map(storeName).join('、')} · {notice.readCount}/{notice.recipientCount} 已读{notice.expires_at ? ` · ${new Date(notice.expires_at).toLocaleDateString('zh-CN')} 到期` : ''}</p></div></div><p className="mt-3 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{notice.body || '暂无正文内容。'}</p><details className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><summary className="cursor-pointer font-bold text-slate-700">查看已读/未读人员</summary><div className="mt-2 grid gap-1">{notice.recipients.map((recipient) => { const profile = recipientProfiles.find((item) => item.id === recipient.profileId); return <p key={recipient.profileId} className="text-slate-600">{recipient.firstReadAt ? '已读' : '未读'} · {profile?.display_name ?? '已离职/未知账号'} · {recipient.firstReadAt ? new Date(recipient.firstReadAt).toLocaleString('zh-CN') : '尚未打开'}</p>; })}</div></details><div className="mt-4 grid grid-cols-3 gap-2"><button className="min-h-10 rounded-lg border border-slate-200 text-sm font-bold" disabled={busy} onClick={() => setNoticeDraft({ body: notice.body, expiresAt: notice.expires_at?.slice(0, 16) ?? '', id: notice.id, isPinned: notice.is_pinned, recipientIds: notice.recipientIds, requiresAcknowledgment: notice.requires_acknowledgment, storeIds: notice.storeIds, title: notice.title })} type="button">编辑</button>{notice.status !== 'published' ? <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-brand-600 text-sm font-bold text-white" disabled={busy} onClick={() => void run(() => publishNotice(supabase!, notice.id), '公告已发布。')} type="button"><Rocket className="h-4 w-4" />发布</button> : <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-amber-200 text-sm font-bold text-amber-800" disabled={busy} onClick={() => void run(() => retractNotice(supabase!, notice.id), '公告已撤回。')} type="button"><Undo2 className="h-4 w-4" />撤回</button>}<button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-red-200 text-sm font-bold text-red-700" disabled={busy} onClick={() => { if (window.confirm(`确定删除公告“${notice.title}”吗？删除后不可恢复。`)) void run(() => deleteNotice(supabase!, notice), '公告已删除。'); }} type="button"><Trash2 className="h-4 w-4" />删除</button></div></article>)}</section> : null}
    {tab === 'sops' ? <section className="space-y-3"><button className="ui-button-primary" onClick={() => { setMessage(null); setNoticeDraft(null); setSopDraft(createEmptySopDraft(defaultStores)); }} type="button"><Plus className="h-4 w-4" />新建食品制作 SOP</button>{sops.map((sop) => <article className="ui-card overflow-hidden" key={sop.id}>{sop.assetUrls.find((asset) => asset.mime_type.startsWith('image/')) ? <img alt={`${sop.title} 制作预览`} className="aspect-[16/7] w-full object-cover" src={sop.assetUrls.find((asset) => asset.mime_type.startsWith('image/'))?.signedUrl} /> : null}<div className="p-4"><p className="text-xs font-bold text-brand-700">{sop.category} · v{sop.version} · {sopStatus[sop.status]}</p><h2 className="mt-1 text-lg font-bold text-slate-900">{sop.title}</h2><p className="mt-2 text-xs text-slate-500">门店：{sop.storeIds.map(storeName).join('、')} · 角色：{sop.roles.map((role) => role === 'staff' ? '员工' : '店长').join('、')}</p>{sop.taskTemplateId ? <p className="mt-1 text-xs text-slate-500">关联任务模板：{templates.find((template) => template.id === sop.taskTemplateId)?.name ?? '已关联模板'}</p> : null}<p className="mt-3 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{sop.body || '暂无制作步骤说明。'}</p><p className="mt-2 text-xs text-slate-500">制作图片/附件 {sop.assetUrls.length} 个</p><div className="mt-4 grid grid-cols-3 gap-2"><button className="ui-button-secondary px-2" disabled={busy} onClick={() => { setMessage(null); setSopDraft({ body: sop.body, category: sop.category, effectiveAt: sop.effective_at?.slice(0, 16) ?? '', id: sop.id, roles: sop.roles, storeIds: sop.storeIds, taskTemplateId: sop.taskTemplateId, title: sop.title }); }} type="button">编辑</button>{sop.status !== 'published' ? <button className="ui-button-primary px-2" disabled={busy} onClick={() => void run(() => publishSop(supabase!, sop.id), 'SOP 已发布。')} type="button"><Rocket className="h-4 w-4" />发布</button> : <button className="ui-button-secondary px-2" disabled={busy} onClick={() => void run(() => archiveSop(supabase!, sop.id), 'SOP 已归档。')} type="button"><Archive className="h-4 w-4" />归档</button>}<span className="flex min-h-11 items-center justify-center rounded-lg bg-slate-50 px-1 text-center text-xs text-slate-500">{sop.effective_at ? `生效 ${new Date(sop.effective_at).toLocaleDateString('zh-CN')}` : '立即生效'}</span></div></div></article>)}</section> : null}
    {noticeDraft ? <NoticeEditor busy={busy} draft={noticeDraft} onCancel={() => setNoticeDraft(null)} onChange={setNoticeDraft} onPublish={() => void saveNoticeDraft(true)} onSave={() => void saveNoticeDraft()} onUpload={uploadNotice} recipients={recipientProfiles} stores={auth.availableStores} /> : null}
    {sopDraft ? <SopEditor busy={busy} draft={sopDraft} errorMessage={message} existingAssets={sops.find((sop) => sop.id === sopDraft.id)?.assetUrls ?? []} onCancel={() => setSopDraft(null)} onChange={setSopDraft} onDeleteAsset={removeSopAsset} onPublish={(files) => saveSopDraft(true, files)} onSave={(files) => saveSopDraft(false, files)} stores={auth.availableStores} templates={templates} /> : null}
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

type PendingSopAsset = { file: File; key: string; previewUrl: string | null };

export function SopEditor({ busy, draft, errorMessage, existingAssets, onCancel, onChange, onDeleteAsset, onPublish, onSave, stores, templates }: {
  busy: boolean;
  draft: SopDraft;
  errorMessage: string | null;
  existingAssets: SopListItem['assetUrls'];
  onCancel: () => void;
  onChange: (value: SopDraft) => void;
  onDeleteAsset: (asset: SopListItem['assetUrls'][number]) => Promise<void>;
  onPublish: (files: File[]) => Promise<boolean>;
  onSave: (files: File[]) => Promise<boolean>;
  stores: Array<{ id: string; name: string }>;
  templates: TaskTemplateListItem[];
}) {
  const [pendingAssets, setPendingAssets] = useState<PendingSopAsset[]>([]);
  const [activeImage, setActiveImage] = useState<{ alt: string; url: string } | null>(null);
  const previewUrls = useRef<string[]>([]);

  useEffect(() => () => previewUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const additions = Array.from(files).map((file, index) => {
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      if (previewUrl) previewUrls.current.push(previewUrl);
      return { file, key: `${file.name}-${file.size}-${file.lastModified}-${index}`, previewUrl };
    });
    setPendingAssets((current) => [...current, ...additions]);
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

  const submit = async (action: (files: File[]) => Promise<boolean>) => {
    const succeeded = await action(pendingAssets.map((asset) => asset.file));
    if (!succeeded) return;
    pendingAssets.forEach((asset) => { if (asset.previewUrl) URL.revokeObjectURL(asset.previewUrl); });
    previewUrls.current = [];
    setPendingAssets([]);
  };

  const existingImages = existingAssets.filter((asset) => asset.mime_type.startsWith('image/'));
  const existingDocuments = existingAssets.filter((asset) => !asset.mime_type.startsWith('image/'));

  return <div className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog" aria-modal="true" aria-labelledby="sop-editor-title">
    <div className="mx-auto max-w-3xl space-y-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
      <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5">
        <div className="min-w-0"><p className="text-xs font-bold text-brand-700">食品制作 SOP</p><h2 className="truncate text-xl font-bold" id="sop-editor-title">{draft.id ? '编辑制作流程' : '新建制作流程'}</h2></div>
        <button aria-label="关闭 SOP 编辑" className="ui-icon-button" onClick={onCancel} type="button"><X className="h-5 w-5" /></button>
      </header>

      {errorMessage ? <FeedbackBanner title="暂时无法保存" tone="danger">{errorMessage}</FeedbackBanner> : null}

      <section className="ui-card grid gap-3 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><p className="text-xs font-bold text-brand-700">01 · 基本信息</p><h3 className="mt-1 font-bold text-slate-900">这份 SOP 制作什么？</h3></div>
        <label className="text-sm font-semibold text-slate-700">产品或流程名称<input className="ui-input mt-1.5" onChange={(event) => onChange({ ...draft, title: event.target.value })} placeholder="例如：芒果酸奶碗（标准版）" value={draft.title} /></label>
        <label className="text-sm font-semibold text-slate-700">制作分类<input className="ui-input mt-1.5" list="sop-category-options" onChange={(event) => onChange({ ...draft, category: event.target.value })} placeholder="例如：酸奶碗制作" value={draft.category} /><datalist id="sop-category-options"><option value="奶茶制作" /><option value="酸奶碗制作" /><option value="原料准备" /><option value="设备操作" /><option value="清洁消毒" /></datalist></label>
      </section>

      <section className="ui-card p-4">
        <div><p className="text-xs font-bold text-brand-700">02 · 制作图片</p><h3 className="mt-1 font-bold text-slate-900">用图片展示成品与关键步骤</h3><p className="mt-1 text-sm leading-6 text-slate-500">建议按“成品图 → 原料用量 → 制作步骤 → 合格标准”的顺序选择，多张图片会按选择顺序显示。</p></div>
        <label className="mt-3 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand-200 bg-brand-50/40 px-4 text-center text-brand-700 transition hover:bg-brand-50">
          <ImagePlus className="h-7 w-7" aria-hidden="true" /><span className="mt-2 font-bold">选择制作图片</span><span className="mt-1 text-xs text-slate-500">支持 JPG、PNG、WEBP，可一次选择多张，每张不超过 10 MB</span>
          <input accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy} multiple onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ''; }} type="file" />
        </label>
        {existingImages.length || pendingAssets.length ? <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {existingImages.map((asset, index) => <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" key={asset.id}><button aria-label={`放大查看制作图片 ${index + 1}`} className="block w-full" onClick={() => setActiveImage({ alt: asset.file_name, url: asset.signedUrl })} type="button"><img alt={asset.file_name} className="aspect-square w-full object-cover" src={asset.signedUrl} /></button><div className="flex items-center gap-1 px-2 py-1.5"><span className="min-w-0 flex-1 truncate text-xs text-slate-500"><Eye className="mr-1 inline h-3.5 w-3.5" />已上传</span><button aria-label={`删除 ${asset.file_name}`} className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" disabled={busy} onClick={() => { if (window.confirm(`确定删除制作图片“${asset.file_name}”吗？`)) void onDeleteAsset(asset); }} type="button"><Trash2 className="h-4 w-4" /></button></div></div>)}
          {pendingAssets.map((asset, index) => <div className="overflow-hidden rounded-xl border border-brand-200 bg-brand-50/30" key={asset.key}>{asset.previewUrl ? <button aria-label={`放大查看待上传图片 ${index + 1}`} className="block w-full" onClick={() => setActiveImage({ alt: asset.file.name, url: asset.previewUrl! })} type="button"><img alt={asset.file.name} className="aspect-square w-full object-cover" src={asset.previewUrl} /></button> : <div className="flex aspect-square items-center justify-center"><FileText className="h-8 w-8 text-slate-400" /></div>}<div className="flex items-center gap-1 px-2 py-1.5"><span className="min-w-0 flex-1 truncate text-xs font-semibold text-brand-700">待保存上传</span><button aria-label={`移除 ${asset.file.name}`} className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" disabled={busy} onClick={() => removePending(asset.key)} type="button"><Trash2 className="h-4 w-4" /></button></div></div>)}
        </div> : <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">尚未选择图片。图片会在选择后立即预览，无需先保存草稿。</p>}
      </section>

      <section className="ui-card p-4">
        <p className="text-xs font-bold text-brand-700">03 · 制作步骤</p><label className="mt-1 block text-sm font-semibold text-slate-700">步骤、用量与合格标准<textarea className="ui-input mt-1.5 min-h-52 py-3 leading-7" onChange={(event) => onChange({ ...draft, body: event.target.value })} placeholder={'示例：\n1. 杯中加入酸奶 180g。\n2. 依次摆放芒果 60g、燕麦 15g。\n3. 成品总重应为 255g ± 5g。\n\n关键标准：水果切块大小、摆盘顺序、成品照片标准。'} value={draft.body} /></label>
      </section>

      <section className="ui-card space-y-4 p-4">
        <div><p className="text-xs font-bold text-brand-700">04 · 发布范围</p><h3 className="mt-1 font-bold text-slate-900">谁可以看到这份 SOP？</h3></div>
        <label className="block text-sm font-semibold text-slate-700">生效时间（不填则发布后立即生效）<input className="ui-input mt-1.5" onChange={(event) => onChange({ ...draft, effectiveAt: event.target.value })} type="datetime-local" value={draft.effectiveAt} /></label>
        <fieldset><legend className="text-sm font-semibold text-slate-700">适用角色</legend><div className="mt-2 grid grid-cols-2 gap-2"><label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm"><input checked={draft.roles.includes('staff')} onChange={() => onChange({ ...draft, roles: draft.roles.includes('staff') ? draft.roles.filter((role) => role !== 'staff') : [...draft.roles, 'staff'] })} type="checkbox" />员工</label><label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm"><input checked={draft.roles.includes('manager')} onChange={() => onChange({ ...draft, roles: draft.roles.includes('manager') ? draft.roles.filter((role) => role !== 'manager') : [...draft.roles, 'manager'] })} type="checkbox" />店长</label></div></fieldset>
        <StorePicker onChange={(storeIds) => onChange({ ...draft, storeIds })} selected={draft.storeIds} stores={stores} />
        <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-700">高级设置：关联任务模板</summary><label className="mt-3 block text-sm font-semibold text-slate-700">关联任务模板<select className="ui-input mt-1.5" onChange={(event) => onChange({ ...draft, taskTemplateId: event.target.value || null })} value={draft.taskTemplateId ?? ''}><option value="">不关联</option>{templates.filter((template) => template.status === 'published').map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label></details>
        {draft.id ? <label className="ui-button-secondary w-fit cursor-pointer"><FileUp className="h-4 w-4" />补充 PDF 文件<input accept="application/pdf" className="hidden" disabled={busy} multiple onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ''; }} type="file" /></label> : null}
        {existingDocuments.length ? <div className="space-y-2">{existingDocuments.map((asset) => <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-2" key={asset.id}><FileText className="h-4 w-4 text-slate-500" /><span className="min-w-0 flex-1 truncate text-sm">{asset.file_name}</span><button aria-label={`删除 ${asset.file_name}`} className="ui-icon-button h-10 w-10 border-transparent bg-red-50 text-red-700" onClick={() => { if (window.confirm(`确定删除附件“${asset.file_name}”吗？`)) void onDeleteAsset(asset); }} type="button"><Trash2 className="h-4 w-4" /></button></div>)}</div> : null}
      </section>
    </div>
    <EditorActions busy={busy} onCancel={onCancel} onPublish={() => void submit(onPublish)} onSave={() => void submit(onSave)} publishLabel="发布 SOP" />
    {activeImage ? <div aria-label="SOP 图片全屏预览" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4" onClick={() => setActiveImage(null)} role="dialog"><button aria-label="关闭图片预览" className="absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white" onClick={() => setActiveImage(null)} type="button"><X className="h-6 w-6" /></button><img alt={activeImage.alt} className="max-h-full max-w-full object-contain" onClick={() => setActiveImage(null)} src={activeImage.url} /></div> : null}
  </div>;
}

function EditorActions({ busy, onCancel, onPublish, onSave, publishLabel = '保存并发布' }: { busy: boolean; onCancel: () => void; onPublish: () => void; onSave: () => void; publishLabel?: string }) {
  return <div className="safe-bottom fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 px-3 pt-2.5 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur"><div className="mx-auto grid max-w-3xl grid-cols-[3rem_1fr_1fr] gap-2"><button aria-label="取消编辑" className="ui-icon-button" onClick={onCancel} type="button"><X className="h-5 w-5" /></button><button className="ui-button-secondary px-2" disabled={busy} onClick={onSave} type="button">保存草稿</button><button className="ui-button-primary px-2" disabled={busy} onClick={onPublish} type="button"><Save className="h-4 w-4" />{publishLabel}</button></div></div>;
}
