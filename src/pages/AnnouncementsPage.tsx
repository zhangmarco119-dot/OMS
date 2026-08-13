import { Bell, Pin, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { IconButton } from '../components/ui/Actions';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { supabase } from '../lib/supabase';
import { loadNotices, type NoticeListItem } from '../services/v2-content.service';

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '未发布';

export function AnnouncementsPage() {
  const [notices, setNotices] = useState<NoticeListItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const navigate = useNavigate();
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
        navigate(`/app/notices/${targetId}`, { replace: true });
      }
    }
    catch (error) { setStatus('error'); setMessage(error instanceof Error ? error.message : '加载公告失败。'); }
  }, [navigate, searchParams]);
  useEffect(() => { void load(); }, [load]);

  const openNotice = (notice: NoticeListItem) => navigate(`/app/notices/${notice.id}`);

  return <PageShell eyebrow="门店运营系统" title="门店公告" backTo="/app/workbench" contentGapClassName="gap-3">
    <SectionCard><SectionHeader action={<IconButton aria-label="刷新公告" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></IconButton>} description="展示当前门店可查看的公告，打开后会自动标记已读。" icon={Bell} title="公告中心" /></SectionCard>
    {status === 'error' && message ? <ErrorState message={message} onRetry={() => void load()} /> : null}
    {status === 'loading' ? <LoadingState label="正在加载公告" /> : null}
    {status === 'ready' && notices.length === 0 ? <EmptyState description="管理员发布给当前门店的公告会显示在这里。" icon={Bell} title="暂无门店公告" /> : null}
    <div className="space-y-2.5">{notices.map((notice) => <article className={`ui-card ui-interactive ${notice.isRead ? '' : 'border-brand-200 bg-brand-50/20'}`} key={notice.id}><button className="min-h-24 w-full p-4 text-left" onClick={() => openNotice(notice)} type="button"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-1 text-xs font-bold text-brand-700">{notice.is_pinned ? <><Pin className="h-3.5 w-3.5" />置顶公告</> : '门店公告'}</p><h2 className="mt-1 line-clamp-2 text-base font-bold leading-6 text-slate-900">{notice.title}</h2><p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-500">{notice.body || '暂无摘要。'}</p><p className="mt-2 text-xs text-slate-500">{formatDate(notice.published_at)} · {notice.publisherName}</p></div><StatusBadge tone={notice.isRead ? 'neutral' : 'success'}>{notice.isRead ? '已读' : '未读'}</StatusBadge></div></button></article>)}</div>
  </PageShell>;
}
