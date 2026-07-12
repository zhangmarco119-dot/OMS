import { Bell, Pin, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { supabase } from '../lib/supabase';
import { loadNotices, markNoticeRead, type NoticeListItem } from '../services/v2-content.service';

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '未发布';

export function AnnouncementsPage() {
  const [notices, setNotices] = useState<NoticeListItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  const load = useCallback(async () => {
    if (!supabase) { setStatus('error'); setMessage('缺少 Supabase 配置，暂时无法加载公告。'); return; }
    setStatus('loading');
    try {
      const loaded = (await loadNotices(supabase)).filter((notice) => notice.status === 'published');
      const targetId = searchParams.get('notice');
      setNotices(loaded);
      setStatus('ready');
      setMessage(null);
      if (targetId && loaded.some((notice) => notice.id === targetId)) {
        setExpandedId(targetId);
        const target = loaded.find((notice) => notice.id === targetId);
        if (target && !target.isRead) {
          await markNoticeRead(supabase, target.id);
          setNotices((current) => current.map((notice) => notice.id === target.id ? { ...notice, isRead: true } : notice));
        }
      }
    }
    catch (error) { setStatus('error'); setMessage(error instanceof Error ? error.message : '加载公告失败。'); }
  }, [searchParams]);
  useEffect(() => { void load(); }, [load]);

  const openNotice = async (notice: NoticeListItem) => {
    setExpandedId((current) => current === notice.id ? null : notice.id);
    if (!notice.isRead && supabase) {
      try {
        await markNoticeRead(supabase, notice.id);
        setNotices((current) => current.map((item) => item.id === notice.id ? { ...item, isRead: true } : item));
      } catch (error) { setMessage(error instanceof Error ? error.message : '公告已打开，但未能记录已读。'); }
    }
  };

  return <PageShell eyebrow="门店运营系统" title="门店公告" backTo="/app">
    <section className="rounded-lg bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-brand-700">公告中心</p><p className="mt-1 text-sm text-slate-500">展示当前门店可查看的公告，打开后会自动标记已读。</p></div><button aria-label="刷新公告" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200" onClick={() => void load()} type="button"><RefreshCw className="h-4 w-4" /></button></div></section>
    {message ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message}</p> : null}
    {status === 'loading' ? <p className="rounded-lg bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">正在加载公告</p> : null}
    {status === 'ready' && notices.length === 0 ? <div className="rounded-lg bg-white p-8 text-center shadow-sm"><Bell className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 font-bold text-slate-800">暂无门店公告</p><p className="mt-1 text-sm text-slate-500">管理员发布给当前门店的公告会显示在这里。</p></div> : null}
    <div className="space-y-3">{notices.map((notice) => <article className={`rounded-lg bg-white p-4 shadow-sm ${notice.isRead ? '' : 'ring-1 ring-brand-200'}`} key={notice.id}><button aria-expanded={expandedId === notice.id} className="w-full text-left" onClick={() => void openNotice(notice)} type="button"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-1 text-xs font-bold text-brand-700">{notice.is_pinned ? <><Pin className="h-3.5 w-3.5" />置顶公告</> : '门店公告'}</p><h2 className="mt-1 text-lg font-bold text-slate-900">{notice.title}</h2><p className="mt-2 text-xs text-slate-500">{formatDate(notice.published_at)}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${notice.isRead ? 'bg-slate-100 text-slate-500' : 'bg-brand-50 text-brand-700'}`}>{notice.isRead ? '已读' : '未读'}</span></div></button>{expandedId === notice.id ? <p className="mt-4 whitespace-pre-wrap border-t border-slate-100 pt-4 text-sm leading-7 text-slate-700">{notice.body || '暂无正文内容。'}</p> : null}</article>)}</div>
  </PageShell>;
}
