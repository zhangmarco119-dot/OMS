import { BookOpenText, Download, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ErrorState, LoadingState } from '../components/ui/Feedback';
import { supabase } from '../lib/supabase';
import { isSystemDocumentSlug, loadSystemDocument, type SystemDocumentRow } from '../services/system-documents.service';

const manualNames = {
  'admin-guide': '管理员使用说明',
  'staff-manager-guide': '员工与店长使用说明',
} as const;

export function SystemManualPage() {
  const { manualSlug = '' } = useParams();
  const [document, setDocument] = useState<SystemDocumentRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const readerRef = useRef<HTMLElement>(null);
  const title = isSystemDocumentSlug(manualSlug) ? manualNames[manualSlug] : '使用说明';

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setDocument(null);
    try {
      if (!isSystemDocumentSlug(manualSlug)) throw new Error('没有找到这份说明文档。');
      if (!supabase) throw new Error('说明文档服务暂不可用，请稍后重试。');
      setDocument(await loadSystemDocument(supabase, manualSlug));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '说明文档加载失败。');
    } finally {
      setLoading(false);
    }
  }, [manualSlug]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const updateFullscreenState = () => setIsFullscreen(window.document.fullscreenElement === readerRef.current);
    window.document.addEventListener('fullscreenchange', updateFullscreenState);
    return () => window.document.removeEventListener('fullscreenchange', updateFullscreenState);
  }, []);

  const createDocumentUrl = () => document
    ? URL.createObjectURL(new Blob([document.content_html], { type: 'text/html;charset=utf-8' }))
    : null;

  const downloadDocument = () => {
    const url = createDocumentUrl();
    if (!url || !document) return;
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `门店运营系统_${document.title}_v${document.document_version}.html`;
    window.document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const openStandaloneDocument = () => {
    const url = createDocumentUrl();
    if (!url) return;
    const opened = window.open(url, '_blank');
    if (!opened) setMessage('浏览器阻止了全屏窗口，请允许打开新窗口后重试。');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const toggleFullscreen = async () => {
    const reader = readerRef.current;
    if (!reader) return;
    if (window.document.fullscreenElement) {
      await window.document.exitFullscreen();
      return;
    }
    if (!reader.requestFullscreen) {
      openStandaloneDocument();
      return;
    }
    try {
      await reader.requestFullscreen();
    } catch {
      openStandaloneDocument();
    }
  };

  return (
    <PageShell eyebrow="关于系统 · 在线说明" title={title} backTo="/app/account/about" contentGapClassName="gap-3">
      {loading ? <LoadingState label="正在从系统中加载最新说明" /> : null}
      {!loading && message ? <ErrorState message={message} onRetry={() => void load()} title="说明文档加载失败" /> : null}
      {!loading && document ? (
        <>
          <section className="ui-card p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><BookOpenText className="h-5 w-5" aria-hidden="true" /></div>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-ink">{document.title}</p><p className="mt-0.5 text-xs text-slate-500">文档版本 {document.document_version} · 更新于 {new Date(document.updated_at).toLocaleString('zh-CN')}</p></div>
              <button aria-label="刷新说明文档" className="ui-icon-button shrink-0" onClick={() => void load()} type="button"><RefreshCw className="h-4 w-4" aria-hidden="true" /></button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button className="ui-button-secondary min-h-10" onClick={downloadDocument} type="button"><Download className="h-4 w-4" aria-hidden="true" />下载说明</button>
              <button className="ui-button-primary min-h-10" onClick={() => void toggleFullscreen()} type="button"><Maximize2 className="h-4 w-4" aria-hidden="true" />全屏查看</button>
            </div>
          </section>
          <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-testid="manual-reader" ref={readerRef}>
            {isFullscreen ? <button aria-label="退出全屏" className="ui-icon-button absolute right-3 top-3 z-20 border-white/80 bg-white/95 shadow-lg" onClick={() => void toggleFullscreen()} type="button"><Minimize2 className="h-5 w-5" aria-hidden="true" /></button> : null}
            <iframe
              allowFullScreen
              className={isFullscreen ? 'h-screen w-full bg-white' : 'h-[calc(100dvh-16rem)] min-h-[500px] w-full bg-white'}
              sandbox="allow-modals allow-scripts"
              srcDoc={document.content_html}
              title={`${document.title}正文`}
            />
          </section>
        </>
      ) : null}
    </PageShell>
  );
}
