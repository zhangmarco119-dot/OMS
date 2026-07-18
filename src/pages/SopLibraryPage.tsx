import { BookOpenCheck, ChevronRight, ImageIcon, Search, Star } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/Feedback';
import { SectionCard } from '../components/ui/Surface';
import { scheduleSopBackgroundLoad } from '../features/content/sopBackgroundLoad';
import { SopProgressiveImage } from '../features/content/SopProgressiveImage';
import { useSopCategoryFilter } from '../features/content/useSopCategoryFilter';
import { supabase } from '../lib/supabase';
import { useRememberedPageState } from '../lib/useRememberedPageState';
import { loadSopCategories, loadSopLibraryPage, prefetchSopDetail, setSopFavorite, type SopLibraryEntry } from '../services/v2-content.service';

const PAGE_SIZE = 5;

export function SopLibraryPage() {
  const navigate = useNavigate();
  const [category, setCategory] = useSopCategoryFilter();
  const [sops, setSops] = useState<SopLibraryEntry[]>([]);
  const [categoryNames, setCategoryNames] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useRememberedPageState('search', '');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useRememberedPageState('favorites-only', false);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [autoLoadPaused, setAutoLoadPaused] = useState(false);
  const requestGenerationRef = useRef(0);
  const backgroundLoadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQuery(query), 250); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => () => backgroundLoadAbortRef.current?.abort(), []);
  useEffect(() => {
    if (!supabase) return;
    void loadSopCategories(supabase).then((rows) => setCategoryNames(rows.map((entry) => entry.name))).catch(() => undefined);
  }, []);

  const loadFirstPage = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage('缺少 Supabase 配置，暂时无法加载 SOP。'); return; }
    backgroundLoadAbortRef.current?.abort();
    const generation = ++requestGenerationRef.current;
    setStatus('loading');
    try {
      const page = await loadSopLibraryPage(supabase, { category, favoritesOnly, limit: PAGE_SIZE, search: debouncedQuery });
      if (generation !== requestGenerationRef.current) return;
      setSops(page.items); setTotal(page.total); setAutoLoadPaused(false); setStatus('ready'); setMessage(null);
    } catch (error) { setStatus('error'); setMessage(error instanceof Error ? error.message : '加载 SOP 失败。'); }
  }, [category, debouncedQuery, favoritesOnly]);
  useEffect(() => { void loadFirstPage(); }, [loadFirstPage]);
  useEffect(() => {
    if (status === 'ready' && category !== 'all' && !categoryNames.includes(category)) setCategory('all');
  }, [category, categoryNames, setCategory, status]);

  const loadMore = useCallback(async () => {
    if (!supabase || loadingMore || sops.length >= total) return;
    const generation = requestGenerationRef.current;
    const controller = new AbortController();
    backgroundLoadAbortRef.current?.abort();
    backgroundLoadAbortRef.current = controller;
    setLoadingMore(true);
    try {
      const page = await loadSopLibraryPage(supabase, { category, favoritesOnly, limit: PAGE_SIZE, offset: sops.length, search: debouncedQuery, signal: controller.signal });
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      setSops((current) => [...current, ...page.items.filter((entry) => !current.some((item) => item.id === entry.id))]);
      setTotal(page.total);
    } catch { if (!controller.signal.aborted) { setAutoLoadPaused(true); setMessage('加载更多 SOP 失败，请稍后重试。'); } }
    finally { if (backgroundLoadAbortRef.current === controller) backgroundLoadAbortRef.current = null; setLoadingMore(false); }
  }, [category, debouncedQuery, favoritesOnly, loadingMore, sops.length, total]);

  useEffect(() => {
    if (status !== 'ready' || loadingMore || autoLoadPaused || sops.length >= total) return;
    return scheduleSopBackgroundLoad(() => void loadMore());
  }, [autoLoadPaused, loadMore, loadingMore, sops.length, status, total]);

  const toggleFavorite = async (sop: SopLibraryEntry) => {
    if (!supabase) return;
    const next = !sop.isFavorite;
    setSops((current) => current.map((entry) => entry.id === sop.id ? { ...entry, isFavorite: next } : entry));
    try {
      await setSopFavorite(supabase, sop.id, next);
      if (favoritesOnly && !next) { setSops((current) => current.filter((entry) => entry.id !== sop.id)); setTotal((value) => Math.max(0, value - 1)); }
    } catch {
      setSops((current) => current.map((entry) => entry.id === sop.id ? { ...entry, isFavorite: sop.isFavorite } : entry));
      setMessage('收藏状态未能保存，请稍后重试。');
    }
  };

  const filtered = Boolean(debouncedQuery || category !== 'all' || favoritesOnly);
  return <PageShell eyebrow="门店运营系统" title="SOP 手册" backTo="/app" contentGapClassName="gap-3">
    <SectionCard className="p-3">
      <div className="grid grid-cols-2 gap-2"><button className={`min-h-10 rounded-lg text-sm font-bold ${!favoritesOnly ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setFavoritesOnly(false)} type="button">全部 SOP</button><button className={`min-h-10 rounded-lg text-sm font-bold ${favoritesOnly ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setFavoritesOnly(true)} type="button"><Star className="mr-1 inline h-4 w-4" />我的收藏</button></div>
      <label className="relative mt-2 block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><span className="sr-only">搜索 SOP</span><input className="ui-input pl-10" onChange={(event) => setQuery(event.target.value)} placeholder="搜索产品名称" type="search" value={query} /></label>
      {categoryNames.length ? <label className="mt-2 block text-sm font-bold text-slate-700">分类查看<select aria-label="SOP 分类查看" className="ui-input mt-1.5" onChange={(event) => setCategory(event.target.value)} value={category}><option value="all">全部分类</option>{categoryNames.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label> : null}
    </SectionCard>
    {status === 'error' && message ? <ErrorState message={message} onRetry={() => void loadFirstPage()} /> : null}
    {status === 'loading' ? <LoadingState label="正在加载 SOP" /> : null}
    {status === 'ready' && sops.length === 0 ? <EmptyState description={filtered ? '请尝试其他关键词、分类或收藏条件。' : '管理员发布并生效后，会按门店和角色显示在这里。'} icon={BookOpenCheck} title={favoritesOnly ? '还没有收藏 SOP' : filtered ? '没有找到 SOP' : '暂无适用 SOP'} /> : null}
    <div className="space-y-2">{sops.map((sop, index) => <article className="ui-card ui-interactive flex min-h-20 w-full items-center gap-3 p-2.5" key={sop.id} onClick={() => { backgroundLoadAbortRef.current?.abort(); if (supabase) void prefetchSopDetail(supabase, sop.id); navigate(`/app/sops/${sop.id}`); }} role="link" tabIndex={0}>{sop.previewPath && supabase ? <SopProgressiveImage alt={`${sop.title} 预览`} client={supabase} containerClassName="aspect-square h-16 w-16 shrink-0 rounded-lg" eager={index < 2} imageClassName="h-full w-full object-cover object-center" initialUrl={sop.previewUrl} objectPath={sop.previewPath} variant="thumbnail" /> : sop.previewUrl ? <img alt={`${sop.title} 预览`} className="aspect-square h-16 w-16 shrink-0 rounded-lg bg-slate-100 object-cover object-center" decoding="async" loading={index < 2 ? 'eager' : 'lazy'} src={sop.previewUrl} style={{ aspectRatio: '1 / 1', objectFit: 'cover', objectPosition: '50% 50%' }} /> : <span className="flex aspect-square h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400"><ImageIcon className="h-6 w-6" /></span>}<span className="min-w-0 flex-1"><span className="block truncate font-bold text-slate-900">{sop.title}</span><span className="mt-1 block truncate text-xs text-slate-500">{sop.category}</span></span><button aria-label={`${sop.isFavorite ? '取消收藏' : '收藏'} ${sop.title}`} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${sop.isFavorite ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-400'}`} onClick={(event) => { event.stopPropagation(); void toggleFavorite(sop); }} type="button"><Star className={`h-5 w-5 ${sop.isFavorite ? 'fill-current' : ''}`} /></button><ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" /></article>)}</div>
    {status === 'ready' && sops.length < total ? <button className="ui-button-secondary w-full" disabled={loadingMore} onClick={() => { setAutoLoadPaused(false); void loadMore(); }} type="button">{loadingMore ? '正在加载更多 SOP' : `继续加载（已显示 ${sops.length}/${total}）`}</button> : null}
    {status === 'ready' && sops.length > 0 ? <p className="px-1 text-center text-xs text-slate-400">已显示 {sops.length}/{total} 个 SOP</p> : null}
  </PageShell>;
}
