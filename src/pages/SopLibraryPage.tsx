import { BookOpenCheck, ExternalLink, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { supabase } from '../lib/supabase';
import { loadSops, type SopListItem } from '../services/v2-content.service';

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value)) : '立即生效';

export function SopLibraryPage() {
  const [sops, setSops] = useState<SopListItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [category, setCategory] = useState('all');

  const load = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage('缺少 Supabase 配置，暂时无法加载 SOP。'); return; }
    setStatus('loading');
    try { setSops((await loadSops(supabase)).filter((sop) => sop.status === 'published')); setStatus('ready'); setMessage(null); }
    catch (error) { setStatus('error'); setMessage(error instanceof Error ? error.message : '加载 SOP 失败。'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const categories = Array.from(new Set(sops.map((sop) => sop.category)));
  const visible = category === 'all' ? sops : sops.filter((sop) => sop.category === category);

  return <PageShell eyebrow="StoreHub V2" title="SOP 手册" backTo="/app">
    <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-brand-700">标准作业流程</p><p className="mt-1 text-sm text-slate-500">只显示已生效且适用于当前门店和角色的 SOP。</p></div><button aria-label="刷新 SOP" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200" onClick={() => void load()} type="button"><RefreshCw className="h-4 w-4" /></button></div>{categories.length ? <div className="mt-4 flex gap-2 overflow-x-auto pb-1"><button className={`shrink-0 rounded-full px-3 py-2 text-sm font-bold ${category === 'all' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setCategory('all')} type="button">全部</button>{categories.map((entry) => <button className={`shrink-0 rounded-full px-3 py-2 text-sm font-bold ${category === entry ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`} key={entry} onClick={() => setCategory(entry)} type="button">{entry}</button>)}</div> : null}</section>
    {message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}
    {status === 'loading' ? <p className="rounded-lg bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">正在加载 SOP</p> : null}
    {status === 'ready' && visible.length === 0 ? <div className="rounded-lg bg-white p-8 text-center shadow-sm"><BookOpenCheck className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 font-bold text-slate-800">暂无适用 SOP</p><p className="mt-1 text-sm text-slate-500">管理员发布并生效后，会按门店和角色显示在这里。</p></div> : null}
    <div className="space-y-3">{visible.map((sop) => <article className="rounded-lg bg-white p-4 shadow-sm" key={sop.id}><button aria-expanded={expandedId === sop.id} className="w-full text-left" onClick={() => setExpandedId((current) => current === sop.id ? null : sop.id)} type="button"><p className="text-xs font-bold text-brand-700">{sop.category} · 版本 v{sop.version}</p><h2 className="mt-1 text-lg font-bold text-slate-900">{sop.title}</h2><p className="mt-2 text-xs text-slate-500">生效日期：{formatDate(sop.effective_at)}</p></button>{expandedId === sop.id ? <div className="mt-4 border-t border-slate-100 pt-4"><p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{sop.body || '暂无正文内容。'}</p>{sop.assetUrls.length ? <div className="mt-4 flex flex-wrap gap-2">{sop.assetUrls.map((asset) => <a className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-bold text-brand-700" href={asset.signedUrl} key={asset.id} rel="noreferrer" target="_blank"><ExternalLink className="h-4 w-4" />{asset.file_name}</a>)}</div> : null}</div> : null}</article>)}</div>
  </PageShell>;
}
