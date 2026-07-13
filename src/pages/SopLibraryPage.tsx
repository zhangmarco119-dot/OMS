import { BookOpenCheck, ExternalLink, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { IconButton } from '../components/ui/Actions';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { supabase } from '../lib/supabase';
import { loadSops, type SopListItem } from '../services/v2-content.service';

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value)) : '立即生效';

export function SopLibraryPage() {
  const [sops, setSops] = useState<SopListItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState<{ alt: string; url: string } | null>(null);
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

  return <PageShell eyebrow="门店运营系统" title="SOP 手册" backTo="/app" contentGapClassName="gap-3">
    <SectionCard><SectionHeader action={<IconButton aria-label="刷新 SOP" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></IconButton>} description="只显示已生效且适用于当前门店和角色的标准作业流程。" icon={BookOpenCheck} title="标准作业流程" />{categories.length ? <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist"><button aria-selected={category === 'all'} className={`min-h-10 shrink-0 rounded-full px-3 text-sm font-bold ${category === 'all' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setCategory('all')} role="tab" type="button">全部</button>{categories.map((entry) => <button aria-selected={category === entry} className={`min-h-10 shrink-0 rounded-full px-3 text-sm font-bold ${category === entry ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`} key={entry} onClick={() => setCategory(entry)} role="tab" type="button">{entry}</button>)}</div> : null}</SectionCard>
    {status === 'error' && message ? <ErrorState message={message} onRetry={() => void load()} /> : null}
    {status === 'loading' ? <LoadingState label="正在加载 SOP" /> : null}
    {status === 'ready' && visible.length === 0 ? <EmptyState description="管理员发布并生效后，会按门店和角色显示在这里。" icon={BookOpenCheck} title="暂无适用 SOP" /> : null}
    <div className="space-y-2.5">{visible.map((sop) => { const images = sop.assetUrls.filter((asset) => asset.mime_type.startsWith('image/')); const documents = sop.assetUrls.filter((asset) => !asset.mime_type.startsWith('image/')); return <article className="ui-card overflow-hidden" key={sop.id}>{images[0] ? <button aria-label={`查看 ${sop.title} 制作图片`} className="block w-full" onClick={() => setActiveImage({ alt: images[0].file_name, url: images[0].signedUrl })} type="button"><img alt={`${sop.title} 成品或步骤预览`} className="aspect-[16/8] w-full object-cover" src={images[0].signedUrl} /></button> : null}<button aria-expanded={expandedId === sop.id} className="ui-interactive min-h-24 w-full p-4 text-left" onClick={() => setExpandedId((current) => current === sop.id ? null : sop.id)} type="button"><p className="text-xs font-bold text-brand-700">{sop.category} · 版本 v{sop.version}</p><h2 className="mt-1 line-clamp-2 text-base font-bold leading-6 text-slate-900">{sop.title}</h2><p className="mt-2 text-xs text-slate-500">{images.length ? `${images.length} 张制作图片 · ` : ''}生效日期：{formatDate(sop.effective_at)}</p></button>{expandedId === sop.id ? <div className="border-t border-slate-100 px-4 pb-4 pt-3">{images.length ? <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{images.map((asset, index) => <button aria-label={`放大查看制作图片 ${index + 1}`} className="overflow-hidden rounded-lg border border-slate-200" key={asset.id} onClick={() => setActiveImage({ alt: asset.file_name, url: asset.signedUrl })} type="button"><img alt={asset.file_name} className="aspect-square w-full object-cover" src={asset.signedUrl} /></button>)}</div> : null}<h3 className="text-sm font-bold text-slate-900">制作步骤与关键标准</h3><p className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-slate-700">{sop.body || '暂无制作步骤说明。'}</p>{documents.length ? <div className="mt-4 flex flex-wrap gap-2">{documents.map((asset) => <a className="ui-button-secondary" href={asset.signedUrl} key={asset.id} rel="noreferrer" target="_blank"><ExternalLink className="h-4 w-4" />{asset.file_name}</a>)}</div> : null}</div> : null}</article>; })}</div>
    {activeImage ? <div aria-label="SOP 图片全屏预览" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4" onClick={() => setActiveImage(null)} role="dialog"><button aria-label="关闭图片预览" className="absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white" onClick={() => setActiveImage(null)} type="button"><X className="h-6 w-6" /></button><img alt={activeImage.alt} className="max-h-full max-w-full object-contain" onClick={() => setActiveImage(null)} src={activeImage.url} /></div> : null}
  </PageShell>;
}
