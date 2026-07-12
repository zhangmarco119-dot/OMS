import { Bell, FileText, Pin } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { acknowledgeNotice, loadNotices, markNoticeRead, type NoticeListItem } from '../services/v2-content.service';

export function AnnouncementDetailPage() {
  const auth = useAuth();
  const { noticeId = '' } = useParams();
  const [notice, setNotice] = useState<NoticeListItem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    try { const found = (await loadNotices(supabase)).find((item) => item.id === noticeId && item.status === 'published'); if (!found) throw new Error('公告不存在或当前账号无权查看。'); setNotice(found); if (!found.isRead) await markNoticeRead(supabase, found.id); }
    catch (error) { setMessage(error instanceof Error ? error.message : '加载公告失败。'); }
  }, [noticeId]);
  useEffect(() => { void load(); }, [load]);
  const acknowledge = async () => {
    if (!supabase || !notice) return;
    setAcknowledging(true);
    try { await acknowledgeNotice(supabase, notice.id); setNotice((current) => current ? { ...current, recipients: current.recipients.map((recipient) => recipient.profileId === auth.profile?.id ? { ...recipient, acknowledgedAt: recipient.acknowledgedAt ?? new Date().toISOString() } : recipient) } : current); }
    catch (error) { setMessage(error instanceof Error ? error.message : '确认公告失败。'); }
    finally { setAcknowledging(false); }
  };
  const acknowledged = notice?.recipients.some((recipient) => recipient.profileId === auth.profile?.id && recipient.acknowledgedAt);
  return <PageShell eyebrow="门店运营系统 · 公告" title={notice?.title ?? '公告详情'} backTo="/app/notices">{message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}{notice ? <article className="rounded-lg bg-white p-5 shadow-sm"><p className="flex items-center gap-1 text-xs font-bold text-brand-700">{notice.is_pinned ? <><Pin className="h-3.5 w-3.5" />置顶公告</> : <><Bell className="h-3.5 w-3.5" />门店公告</>}</p><h1 className="mt-2 text-2xl font-bold text-slate-900">{notice.title}</h1><p className="mt-2 text-sm text-slate-500">发布时间：{notice.published_at ? new Date(notice.published_at).toLocaleString('zh-CN') : '未发布'} · 发布人：{notice.publisherName} · {notice.isRead ? '已读' : '未读'}</p><div className="mt-5 whitespace-pre-wrap border-t border-slate-100 pt-5 text-sm leading-8 text-slate-700">{notice.body || '暂无正文内容。'}</div>{notice.assetUrls.length ? <div className="mt-5 grid gap-3">{notice.assetUrls.map((asset) => asset.mime_type.startsWith('image/') ? <a href={asset.signedUrl} key={asset.id} rel="noreferrer" target="_blank"><img alt={asset.file_name} className="max-h-96 w-full rounded-lg border object-contain" src={asset.signedUrl} /></a> : <a className="flex min-h-12 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-brand-700" href={asset.signedUrl} key={asset.id} rel="noreferrer" target="_blank"><FileText className="h-5 w-5" />{asset.file_name}</a>)}</div> : null}{notice.requires_acknowledgment && auth.profile?.role !== 'admin' ? <button className="mt-5 min-h-12 w-full rounded-lg bg-brand-600 font-bold text-white disabled:opacity-60" disabled={acknowledging || acknowledged} onClick={() => void acknowledge()} type="button">{acknowledged ? '已确认阅读' : acknowledging ? '正在确认' : '确认已阅读'}</button> : null}</article> : <p className="rounded-lg bg-white p-5 text-sm text-slate-600 shadow-sm">正在加载公告详情</p>}</PageShell>;
}
