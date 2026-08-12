import { Bell, FileText, Pin } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { SuccessToast } from '../components/feedback/SuccessToast';
import { FeedbackBanner, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { ProgressiveImage } from '../components/ui/ProgressiveImage';
import { ImageViewer } from '../components/ui/ImageViewer';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { acknowledgeNotice, loadNoticeAssetUrls, loadNotices, markNoticeRead, type NoticeListItem } from '../services/v2-content.service';

export function AnnouncementDetailPage() {
  const auth = useAuth();
  const location = useLocation();
  const { noticeId = '' } = useParams();
  const [notice, setNotice] = useState<NoticeListItem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const found = (await loadNotices(supabase)).find((item) => item.id === noticeId && item.status === 'published');
      if (!found) throw new Error('公告不存在或当前账号无权查看。');
      setNotice(found);
      setMessage(null);
      if (!found.isRead) void markNoticeRead(supabase, found.id).catch(() => undefined);
      setAssetsLoading(found.assetUrls.length > 0);
      if (found.assetUrls.length > 0) {
        void loadNoticeAssetUrls(supabase, found.assetUrls).then((urls) => {
          setNotice((current) => current ? { ...current, assetUrls: current.assetUrls.map((asset) => ({ ...asset, signedUrl: urls[asset.id] ?? '' })) } : current);
        }).catch(() => undefined).finally(() => setAssetsLoading(false));
      }
    }
    catch (error) { setMessage(error instanceof Error ? error.message : '加载公告失败。'); }
  }, [noticeId]);
  useEffect(() => { void load(); }, [load]);
  const acknowledge = async () => {
    if (!supabase || !notice) return;
    setAcknowledging(true);
    try { await acknowledgeNotice(supabase, notice.id); setNotice((current) => current ? { ...current, recipients: current.recipients.map((recipient) => recipient.profileId === auth.profile?.id ? { ...recipient, acknowledgedAt: recipient.acknowledgedAt ?? new Date().toISOString() } : recipient) } : current); setSuccess('公告已确认阅读。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '确认公告失败。'); }
    finally { setAcknowledging(false); }
  };
  const acknowledged = notice?.recipients.some((recipient) => recipient.profileId === auth.profile?.id && recipient.acknowledgedAt);
  const taskBackTo = (location.state as { taskBackTo?: unknown } | null)?.taskBackTo;
  const imageAssets = notice?.assetUrls.filter((asset) => asset.mime_type.startsWith('image/') && asset.signedUrl).map((asset) => ({ alt: asset.file_name, id: asset.id, url: asset.signedUrl! })) ?? [];
  return <PageShell eyebrow="门店运营系统 · 公告" title={notice?.title ?? '公告详情'} backTo={typeof taskBackTo === 'string' ? taskBackTo : '/app/notices'} contentGapClassName="gap-3">{message ? <FeedbackBanner tone="danger">{message}</FeedbackBanner> : null}{notice ? <article className="ui-card p-5"><div className="flex flex-wrap items-center gap-2"><p className="flex items-center gap-1 text-xs font-bold text-brand-700">{notice.is_pinned ? <><Pin className="h-3.5 w-3.5" />置顶公告</> : <><Bell className="h-3.5 w-3.5" />门店公告</>}</p><StatusBadge tone={notice.isRead ? 'neutral' : 'success'}>{notice.isRead ? '已读' : '未读'}</StatusBadge></div><h1 className="mt-2 text-xl font-bold leading-8 tracking-tight text-slate-900 sm:text-2xl">{notice.title}</h1><p className="mt-2 text-xs leading-5 text-slate-500">{notice.published_at ? new Date(notice.published_at).toLocaleString('zh-CN') : '未发布'} · 发布人：{notice.publisherName}</p><div className="mt-5 whitespace-pre-wrap border-t border-slate-100 pt-5 text-[15px] leading-8 text-slate-700">{notice.body || '暂无正文内容。'}</div>{notice.assetUrls.length ? <div className="mt-5 grid gap-3">{notice.assetUrls.map((asset) => asset.mime_type.startsWith('image/') ? <button aria-label={`放大查看 ${asset.file_name}`} disabled={!asset.signedUrl} key={asset.id} onClick={() => { const index = imageAssets.findIndex((image) => image.id === asset.id); if (index >= 0) setActiveImageIndex(index); }} type="button"><ProgressiveImage alt={asset.file_name} className="max-h-96 w-full object-contain" containerClassName="min-h-40 w-full rounded-xl border border-slate-200" resourceLoading={assetsLoading && !asset.signedUrl} src={asset.signedUrl} /></button> : asset.signedUrl ? <a className="ui-button-secondary justify-start" href={asset.signedUrl} key={asset.id} rel="noreferrer" target="_blank"><FileText className="h-5 w-5" />{asset.file_name}</a> : <div className="ui-button-secondary justify-start text-slate-500" key={asset.id}><FileText className="h-5 w-5" />{assetsLoading ? '正在加载附件' : '附件加载失败'}：{asset.file_name}</div>)}</div> : null}{notice.requires_acknowledgment && auth.profile?.role !== 'admin' ? <button className="ui-button-primary mt-5 w-full" disabled={acknowledging || acknowledged} onClick={() => void acknowledge()} type="button">{acknowledged ? '已确认阅读' : acknowledging ? '正在确认' : '确认已阅读'}</button> : null}</article> : <LoadingState label="正在加载公告详情" />}{activeImageIndex !== null ? <ImageViewer activeIndex={activeImageIndex} images={imageAssets} label="公告图片预览" onClose={() => setActiveImageIndex(null)} onIndexChange={setActiveImageIndex} /> : null}<SuccessToast message={success} onClose={() => setSuccess(null)} /></PageShell>;
}
