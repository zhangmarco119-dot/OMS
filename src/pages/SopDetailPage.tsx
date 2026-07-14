import { BookOpenCheck, ExternalLink, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/Feedback';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadSopDetail, type SopListItem } from '../services/v2-content.service';

export function SopDetailPage() {
  const auth = useAuth();
  const { sopId } = useParams();
  const [sop, setSop] = useState<SopListItem | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState<{ alt: string; url: string } | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !sopId) { setStatus('error'); setMessage('无法识别该 SOP。'); return; }
    setStatus('loading');
    try {
      const loaded = await loadSopDetail(supabase, sopId);
      const found = loaded && (loaded.status === 'published' || auth.profile?.role === 'admin') ? loaded : null;
      setSop(found);
      setStatus('ready');
      setMessage(null);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '加载 SOP 详情失败。');
    }
  }, [auth.profile?.role, sopId]);
  useEffect(() => { void load(); }, [load]);

  const images = sop?.assetUrls.filter((asset) => asset.asset_kind === 'step').sort((left, right) => left.sort_order - right.sort_order) ?? [];
  const documents = sop?.assetUrls.filter((asset) => asset.asset_kind === 'attachment') ?? [];

  return <PageShell eyebrow={sop?.category ?? 'SOP 手册'} title={sop?.title ?? 'SOP 详情'} backTo={auth.profile?.role === 'admin' ? '/app/admin/sops' : '/app/sops'} contentGapClassName="gap-3">
    {status === 'error' && message ? <ErrorState message={message} onRetry={() => void load()} /> : null}
    {status === 'loading' ? <LoadingState label="正在加载完整 SOP" /> : null}
    {status === 'ready' && !sop ? <EmptyState description="该 SOP 可能尚未发布、已归档，或不适用于当前门店。" icon={BookOpenCheck} title="无法查看 SOP" /> : null}
    {sop ? <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {sop.body ? <section className="border-b border-slate-100 p-4"><h2 className="text-sm font-bold text-slate-900">整体说明</h2><p className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-slate-700">{sop.body}</p></section> : null}
      {images.length ? <div className="grid grid-cols-2 gap-px bg-slate-200" data-testid="sop-detail-step-grid">{images.map((asset, index) => <section className="min-w-0 bg-white" key={asset.id}><div className="bg-slate-50 px-2 py-1.5 text-xs font-bold text-brand-700">步骤 {index + 1}</div><button aria-label={`放大查看步骤 ${index + 1} 图片`} className="block w-full bg-white" onClick={() => setActiveImage({ alt: asset.file_name, url: asset.signedUrl })} type="button"><img alt={`${sop.title} 步骤 ${index + 1}`} className="aspect-[4/3] w-full bg-slate-50 object-contain" src={asset.signedUrl} /></button><p className="whitespace-pre-wrap px-2 py-2 text-xs leading-5 text-slate-800 sm:text-sm">{asset.step_text || `请按图示完成第 ${index + 1} 步。`}</p></section>)}</div> : <section className="p-5"><p className="text-sm text-slate-500">该 SOP 暂无分步图片，请按整体说明执行。</p></section>}
      {documents.length ? <section className="border-t border-slate-100 p-4"><h2 className="text-sm font-bold">附件</h2><div className="mt-2 flex flex-wrap gap-2">{documents.map((asset) => <a className="ui-button-secondary" href={asset.signedUrl} key={asset.id} rel="noreferrer" target="_blank"><ExternalLink className="h-4 w-4" />{asset.file_name}</a>)}</div></section> : null}
    </article> : null}
    {activeImage ? <div aria-label="SOP 步骤图片全屏预览" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4" onClick={() => setActiveImage(null)} role="dialog"><button aria-label="关闭图片预览" className="absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white" onClick={() => setActiveImage(null)} type="button"><X className="h-6 w-6" /></button><img alt={activeImage.alt} className="max-h-full max-w-full object-contain" onClick={() => setActiveImage(null)} src={activeImage.url} /></div> : null}
  </PageShell>;
}
