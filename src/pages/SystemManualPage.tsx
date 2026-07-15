import { BookOpenText, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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

  return (
    <PageShell eyebrow="关于系统 · 在线说明" title={title} backTo="/app/account/about" contentGapClassName="gap-3">
      {loading ? <LoadingState label="正在从系统中加载最新说明" /> : null}
      {!loading && message ? <ErrorState message={message} onRetry={() => void load()} title="说明文档加载失败" /> : null}
      {!loading && document ? (
        <>
          <section className="ui-card flex items-center gap-3 p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><BookOpenText className="h-5 w-5" aria-hidden="true" /></div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-ink">{document.title}</p><p className="mt-0.5 text-xs text-slate-500">文档版本 {document.document_version} · 更新于 {new Date(document.updated_at).toLocaleString('zh-CN')}</p></div>
            <button aria-label="刷新说明文档" className="ui-icon-button shrink-0" onClick={() => void load()} type="button"><RefreshCw className="h-4 w-4" aria-hidden="true" /></button>
          </section>
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <iframe
              className="h-[calc(100dvh-13rem)] min-h-[520px] w-full bg-white"
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
