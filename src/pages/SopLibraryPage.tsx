import { BookOpenCheck, ChevronRight, ImageIcon, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { IconButton } from '../components/ui/Actions';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { filterSopLibrary } from '../features/content/sopLibrary';
import { useSopCategoryFilter } from '../features/content/useSopCategoryFilter';
import { supabase } from '../lib/supabase';
import { loadSopCategories, loadSopLibraryEntries, type SopLibraryEntry } from '../services/v2-content.service';

export function SopLibraryPage() {
  const navigate = useNavigate();
  const [category, setCategory] = useSopCategoryFilter();
  const [sops, setSops] = useState<SopLibraryEntry[]>([]);
  const [categoryNames, setCategoryNames] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage('缺少 Supabase 配置，暂时无法加载 SOP。'); return; }
    setStatus('loading');
    try {
      const [published, nextCategories] = await Promise.all([loadSopLibraryEntries(supabase), loadSopCategories(supabase)]);
      const used = new Set(published.map((sop) => sop.category));
      setSops(published);
      setCategoryNames(nextCategories.map((entry) => entry.name).filter((name) => used.has(name)));
      setStatus('ready');
      setMessage(null);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '加载 SOP 失败。');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (status === 'ready' && category !== 'all' && !categoryNames.includes(category)) setCategory('all');
  }, [category, categoryNames, setCategory, status]);
  const visible = useMemo(() => filterSopLibrary(sops, { category, query }), [category, query, sops]);

  return <PageShell eyebrow="门店运营系统" title="SOP 手册" backTo="/app" contentGapClassName="gap-3">
    <SectionCard>
      <SectionHeader action={<IconButton aria-label="刷新 SOP" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></IconButton>} description="搜索产品名称，或按制作分类查看。" icon={BookOpenCheck} title="标准作业流程" />
      <label className="relative mt-3 block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><span className="sr-only">搜索 SOP</span><input className="ui-input pl-10" onChange={(event) => setQuery(event.target.value)} placeholder="搜索产品名称" type="search" value={query} /></label>
      {categoryNames.length ? <label className="mt-3 block text-sm font-bold text-slate-700">分类查看<select aria-label="SOP 分类查看" className="ui-input mt-1.5" onChange={(event) => setCategory(event.target.value)} value={category}><option value="all">全部分类</option>{categoryNames.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label> : null}
    </SectionCard>
    {status === 'error' && message ? <ErrorState message={message} onRetry={() => void load()} /> : null}
    {status === 'loading' ? <LoadingState label="正在加载 SOP" /> : null}
    {status === 'ready' && visible.length === 0 ? <EmptyState description={query || category !== 'all' ? '请尝试其他关键词或分类。' : '管理员发布并生效后，会按门店和角色显示在这里。'} icon={BookOpenCheck} title={query || category !== 'all' ? '没有找到 SOP' : '暂无适用 SOP'} /> : null}
    <div className="space-y-2">{visible.map((sop) => <button className="ui-card ui-interactive flex min-h-20 w-full items-center gap-3 p-2.5 text-left" key={sop.id} onClick={() => navigate(`/app/sops/${sop.id}`)} type="button">{sop.previewUrl ? <img alt={`${sop.title} 预览`} className="h-16 w-16 shrink-0 rounded-lg bg-slate-100 object-cover" src={sop.previewUrl} /> : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400"><ImageIcon className="h-6 w-6" /></span>}<span className="min-w-0 flex-1"><span className="block truncate font-bold text-slate-900">{sop.title}</span><span className="mt-1 block truncate text-xs text-slate-500">{sop.category}</span></span><ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" /></button>)}</div>
  </PageShell>;
}
