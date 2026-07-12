import { Archive, FileUp, Pin, Plus, RefreshCw, Rocket, Save, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { SuccessToast } from '../components/feedback/SuccessToast';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadTaskTemplates, type TaskTemplateListItem } from '../services/task-templates.service';
import {
  archiveSop,
  createEmptyNoticeDraft,
  createEmptySopDraft,
  loadNotices,
  loadSops,
  publishNotice,
  publishSop,
  retractNotice,
  saveNotice,
  saveSop,
  uploadSopAsset,
  type NoticeDraft,
  type NoticeListItem,
  type SopDraft,
  type SopListItem,
} from '../services/v2-content.service';

type ContentTab = 'notices' | 'sops';

const noticeStatus: Record<NoticeListItem['status'], string> = { draft: '草稿', published: '已发布', retracted: '已撤回' };
const sopStatus: Record<SopListItem['status'], string> = { archived: '已归档', draft: '草稿', published: '已发布' };

export function AdminContentPage() {
  const auth = useAuth();
  const [tab, setTab] = useState<ContentTab>('notices');
  const [notices, setNotices] = useState<NoticeListItem[]>([]);
  const [sops, setSops] = useState<SopListItem[]>([]);
  const [templates, setTemplates] = useState<TaskTemplateListItem[]>([]);
  const [noticeDraft, setNoticeDraft] = useState<NoticeDraft | null>(null);
  const [sopDraft, setSopDraft] = useState<SopDraft | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage('缺少 Supabase 配置，暂时无法管理公告和 SOP。'); return; }
    setStatus('loading');
    try { const [nextNotices, nextSops, nextTemplates] = await Promise.all([loadNotices(supabase), loadSops(supabase), loadTaskTemplates(supabase)]); setNotices(nextNotices); setSops(nextSops); setTemplates(nextTemplates); setStatus('ready'); setMessage(null); }
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
  const saveSopDraft = async (publishAfterSave = false) => {
    if (!supabase || !sopDraft) return;
    setBusy(true);
    try { const saved = await saveSop(supabase, sopDraft); if (publishAfterSave) await publishSop(supabase, saved.id); setSopDraft({ ...sopDraft, id: saved.id }); await refresh(); setSuccess(publishAfterSave ? 'SOP 已发布并按生效时间展示。' : 'SOP 草稿已保存，可以继续上传附件。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存 SOP 失败。'); }
    finally { setBusy(false); }
  };
  const run = async (action: () => Promise<unknown>, successText: string) => {
    setBusy(true); setMessage(null);
    try { await action(); await refresh(); setSuccess(successText); }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失败。'); }
    finally { setBusy(false); }
  };
  const upload = async (file: File | undefined) => {
    const client = supabase;
    const profile = auth.profile;
    const sopId = sopDraft?.id;
    if (!file || !client || !sopId || !profile) return;
    await run(() => uploadSopAsset(client, { file, profileId: profile.id, sopId }), '附件已上传。');
  };

  return <PageShell eyebrow="门店运营系统 · 管理员" title="公告与 SOP 管理" backTo="/app">
    <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-brand-700">门店内容管理</p><p className="mt-1 text-sm text-slate-500">公告按门店发布；SOP 同时按门店、角色和生效时间控制可见范围。</p></div><button aria-label="刷新内容" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200" onClick={() => void refresh()} type="button"><RefreshCw className="h-4 w-4" /></button></div><div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"><button className={`min-h-10 rounded-md text-sm font-bold ${tab === 'notices' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setTab('notices')} type="button">公告</button><button className={`min-h-10 rounded-md text-sm font-bold ${tab === 'sops' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setTab('sops')} type="button">SOP</button></div></section>
    {message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}
    {status === 'loading' ? <p className="rounded-lg bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">正在加载内容</p> : null}
    {tab === 'notices' ? <section className="space-y-3"><button className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white" onClick={() => { setSopDraft(null); setNoticeDraft(createEmptyNoticeDraft(defaultStores)); }} type="button"><Plus className="h-4 w-4" />新建公告</button>{notices.map((notice) => <article className="rounded-lg bg-white p-4 shadow-sm" key={notice.id}><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1 text-xs font-bold text-brand-700">{notice.is_pinned ? <><Pin className="h-3.5 w-3.5" />置顶</> : '公告'} · {noticeStatus[notice.status]}</p><h2 className="mt-1 text-lg font-bold text-slate-900">{notice.title}</h2><p className="mt-2 text-xs text-slate-500">门店：{notice.storeIds.map(storeName).join('、')}</p></div></div><p className="mt-3 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{notice.body || '暂无正文内容。'}</p><div className="mt-4 grid grid-cols-3 gap-2"><button className="min-h-10 rounded-lg border border-slate-200 text-sm font-bold" disabled={busy} onClick={() => setNoticeDraft({ body: notice.body, id: notice.id, isPinned: notice.is_pinned, storeIds: notice.storeIds, title: notice.title })} type="button">编辑</button>{notice.status !== 'published' ? <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-brand-600 text-sm font-bold text-white" disabled={busy} onClick={() => void run(() => publishNotice(supabase!, notice.id), '公告已发布。')} type="button"><Rocket className="h-4 w-4" />发布</button> : <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-amber-200 text-sm font-bold text-amber-800" disabled={busy} onClick={() => void run(() => retractNotice(supabase!, notice.id), '公告已撤回。')} type="button"><Undo2 className="h-4 w-4" />撤回</button>}<span className="flex min-h-10 items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-500">{notice.isRead ? '已有阅读' : '暂无已读'}</span></div></article>)}</section> : null}
    {tab === 'sops' ? <section className="space-y-3"><button className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white" onClick={() => { setNoticeDraft(null); setSopDraft(createEmptySopDraft(defaultStores)); }} type="button"><Plus className="h-4 w-4" />新建 SOP</button>{sops.map((sop) => <article className="rounded-lg bg-white p-4 shadow-sm" key={sop.id}><p className="text-xs font-bold text-brand-700">{sop.category} · v{sop.version} · {sopStatus[sop.status]}</p><h2 className="mt-1 text-lg font-bold text-slate-900">{sop.title}</h2><p className="mt-2 text-xs text-slate-500">门店：{sop.storeIds.map(storeName).join('、')} · 角色：{sop.roles.map((role) => role === 'staff' ? '员工' : '店长').join('、')}</p>{sop.taskTemplateId ? <p className="mt-1 text-xs text-slate-500">关联任务模板：{templates.find((template) => template.id === sop.taskTemplateId)?.name ?? '已关联模板'}</p> : null}<p className="mt-3 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{sop.body || '暂无正文内容。'}</p><p className="mt-2 text-xs text-slate-500">附件 {sop.assetUrls.length} 个</p><div className="mt-4 grid grid-cols-3 gap-2"><button className="min-h-10 rounded-lg border border-slate-200 text-sm font-bold" disabled={busy} onClick={() => setSopDraft({ body: sop.body, category: sop.category, effectiveAt: sop.effective_at?.slice(0, 16) ?? '', id: sop.id, roles: sop.roles, storeIds: sop.storeIds, taskTemplateId: sop.taskTemplateId, title: sop.title })} type="button">编辑</button>{sop.status !== 'published' ? <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-brand-600 text-sm font-bold text-white" disabled={busy} onClick={() => void run(() => publishSop(supabase!, sop.id), 'SOP 已发布。')} type="button"><Rocket className="h-4 w-4" />发布</button> : <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-slate-200 text-sm font-bold text-slate-700" disabled={busy} onClick={() => void run(() => archiveSop(supabase!, sop.id), 'SOP 已归档。')} type="button"><Archive className="h-4 w-4" />归档</button>}<span className="flex min-h-10 items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-500">{sop.effective_at ? `生效 ${new Date(sop.effective_at).toLocaleDateString('zh-CN')}` : '未设生效日'}</span></div></article>)}</section> : null}
    {noticeDraft ? <NoticeEditor busy={busy} draft={noticeDraft} onCancel={() => setNoticeDraft(null)} onChange={setNoticeDraft} onPublish={() => void saveNoticeDraft(true)} onSave={() => void saveNoticeDraft()} stores={auth.availableStores} /> : null}
    {sopDraft ? <SopEditor busy={busy} draft={sopDraft} onCancel={() => setSopDraft(null)} onChange={setSopDraft} onPublish={() => void saveSopDraft(true)} onSave={() => void saveSopDraft()} onUpload={upload} stores={auth.availableStores} templates={templates} /> : null}
    <SuccessToast message={success} onClose={() => setSuccess(null)} />
  </PageShell>;
}

function StorePicker({ selected, stores, onChange }: { selected: string[]; stores: Array<{ id: string; name: string }>; onChange: (ids: string[]) => void }) {
  return <fieldset><legend className="text-sm font-semibold">适用门店</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{stores.map((store) => <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm" key={store.id}><input checked={selected.includes(store.id)} onChange={() => onChange(selected.includes(store.id) ? selected.filter((id) => id !== store.id) : [...selected, store.id])} type="checkbox" />{store.name}</label>)}</div></fieldset>;
}

function NoticeEditor({ busy, draft, onCancel, onChange, onPublish, onSave, stores }: { busy: boolean; draft: NoticeDraft; onCancel: () => void; onChange: (value: NoticeDraft) => void; onPublish: () => void; onSave: () => void; stores: Array<{ id: string; name: string }> }) {
  return <div className="fixed inset-0 z-40 overflow-y-auto bg-[#f4f7f3] p-4" role="dialog" aria-modal="true"><div className="mx-auto max-w-3xl space-y-4 pb-24"><header className="sticky top-0 z-10 flex items-center justify-between rounded-lg bg-white p-4 shadow-sm"><div><p className="text-xs font-bold text-brand-700">公告编辑</p><h2 className="text-xl font-bold">{draft.id ? '编辑公告' : '新建公告'}</h2></div><button aria-label="关闭公告编辑" className="h-11 w-11 rounded-lg bg-slate-100" onClick={onCancel} type="button"><X className="mx-auto h-5 w-5" /></button></header><section className="space-y-3 rounded-lg bg-white p-4 shadow-sm"><label className="block text-sm font-semibold">公告标题<input className="mt-1 min-h-11 w-full rounded-lg border p-3" onChange={(event) => onChange({ ...draft, title: event.target.value })} value={draft.title} /></label><label className="block text-sm font-semibold">公告正文<textarea className="mt-1 min-h-40 w-full rounded-lg border p-3" onChange={(event) => onChange({ ...draft, body: event.target.value })} value={draft.body} /></label><label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input checked={draft.isPinned} onChange={(event) => onChange({ ...draft, isPinned: event.target.checked })} type="checkbox" />置顶显示</label><StorePicker onChange={(storeIds) => onChange({ ...draft, storeIds })} selected={draft.storeIds} stores={stores} /></section><EditorActions busy={busy} onCancel={onCancel} onPublish={onPublish} onSave={onSave} /></div></div>;
}

function SopEditor({ busy, draft, onCancel, onChange, onPublish, onSave, onUpload, stores, templates }: { busy: boolean; draft: SopDraft; onCancel: () => void; onChange: (value: SopDraft) => void; onPublish: () => void; onSave: () => void; onUpload: (file: File | undefined) => Promise<void>; stores: Array<{ id: string; name: string }>; templates: TaskTemplateListItem[] }) {
  return <div className="fixed inset-0 z-40 overflow-y-auto bg-[#f4f7f3] p-4" role="dialog" aria-modal="true"><div className="mx-auto max-w-3xl space-y-4 pb-24"><header className="sticky top-0 z-10 flex items-center justify-between rounded-lg bg-white p-4 shadow-sm"><div><p className="text-xs font-bold text-brand-700">SOP 编辑</p><h2 className="text-xl font-bold">{draft.id ? '编辑 SOP' : '新建 SOP'}</h2></div><button aria-label="关闭 SOP 编辑" className="h-11 w-11 rounded-lg bg-slate-100" onClick={onCancel} type="button"><X className="mx-auto h-5 w-5" /></button></header><section className="grid gap-3 rounded-lg bg-white p-4 shadow-sm sm:grid-cols-2"><label className="text-sm font-semibold">标题<input className="mt-1 min-h-11 w-full rounded-lg border p-3" onChange={(event) => onChange({ ...draft, title: event.target.value })} value={draft.title} /></label><label className="text-sm font-semibold">分类<input className="mt-1 min-h-11 w-full rounded-lg border p-3" onChange={(event) => onChange({ ...draft, category: event.target.value })} value={draft.category} /></label><label className="text-sm font-semibold">生效时间<input className="mt-1 min-h-11 w-full rounded-lg border px-3" onChange={(event) => onChange({ ...draft, effectiveAt: event.target.value })} type="datetime-local" value={draft.effectiveAt} /></label><label className="text-sm font-semibold">关联任务模板<select className="mt-1 min-h-11 w-full rounded-lg border px-3" onChange={(event) => onChange({ ...draft, taskTemplateId: event.target.value || null })} value={draft.taskTemplateId ?? ''}><option value="">不关联</option>{templates.filter((template) => template.status === 'published').map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><fieldset><legend className="text-sm font-semibold">适用角色</legend><div className="mt-2 flex gap-3"><label className="flex min-h-11 items-center gap-2 text-sm"><input checked={draft.roles.includes('staff')} onChange={() => onChange({ ...draft, roles: draft.roles.includes('staff') ? draft.roles.filter((role) => role !== 'staff') : [...draft.roles, 'staff'] })} type="checkbox" />员工</label><label className="flex min-h-11 items-center gap-2 text-sm"><input checked={draft.roles.includes('manager')} onChange={() => onChange({ ...draft, roles: draft.roles.includes('manager') ? draft.roles.filter((role) => role !== 'manager') : [...draft.roles, 'manager'] })} type="checkbox" />店长</label></div></fieldset><label className="block text-sm font-semibold sm:col-span-2">正文<textarea className="mt-1 min-h-40 w-full rounded-lg border p-3" onChange={(event) => onChange({ ...draft, body: event.target.value })} value={draft.body} /></label><div className="sm:col-span-2"><StorePicker onChange={(storeIds) => onChange({ ...draft, storeIds })} selected={draft.storeIds} stores={stores} /></div>{draft.id ? <label className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-bold text-brand-700"><FileUp className="h-4 w-4" />上传图片或 PDF<input accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={busy} onChange={(event) => { void onUpload(event.target.files?.[0]); event.currentTarget.value = ''; }} type="file" /></label> : <p className="text-sm text-slate-500 sm:col-span-2">保存草稿后即可上传图片或 PDF 附件。</p>}</section><EditorActions busy={busy} onCancel={onCancel} onPublish={onPublish} onSave={onSave} /></div></div>;
}

function EditorActions({ busy, onCancel, onPublish, onSave }: { busy: boolean; onCancel: () => void; onPublish: () => void; onSave: () => void }) {
  return <div className="fixed inset-x-0 bottom-0 border-t bg-white p-3"><div className="mx-auto grid max-w-3xl grid-cols-3 gap-2"><button className="min-h-12 rounded-lg border font-bold" onClick={onCancel} type="button">取消</button><button className="min-h-12 rounded-lg border border-brand-200 font-bold text-brand-700 disabled:opacity-50" disabled={busy} onClick={onSave} type="button">保存草稿</button><button className="inline-flex min-h-12 items-center justify-center gap-1 rounded-lg bg-brand-600 font-bold text-white disabled:opacity-50" disabled={busy} onClick={onPublish} type="button"><Save className="h-4 w-4" />保存并发布</button></div></div>;
}
