import { CheckCircle2, TriangleAlert, X } from 'lucide-react';

export interface BatchImportFailure {
  item: string;
  reason: string;
}

export function BatchImportReportDialog({
  failureCount,
  failures,
  onClose,
  open,
  successCount,
  successDescription,
  title,
}: {
  failureCount: number;
  failures: BatchImportFailure[];
  onClose: () => void;
  open: boolean;
  successCount: number;
  successDescription: string;
  title: string;
}) {
  if (!open) return null;

  return <div className="ui-dialog-overlay z-[100]" role="dialog" aria-modal="true" aria-labelledby="batch-import-report-title">
    <section className="ui-dialog-panel flex max-h-[min(82dvh,44rem)] max-w-lg flex-col overflow-hidden border border-slate-200 p-0">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
        <div>
          <p className="text-xs font-bold text-brand-700">批量操作报告</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900" id="batch-import-report-title">{title}</h2>
        </div>
        <button aria-label="关闭批量导入报告" className="ui-icon-button shrink-0" onClick={onClose} type="button"><X className="h-5 w-5" /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
            <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-5 w-5" /><span className="text-sm font-bold">上传成功</span></div>
            <p className="mt-2 text-3xl font-bold text-emerald-800">{successCount}</p>
          </div>
          <div className={`rounded-xl border p-4 ${failureCount ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
            <div className={`flex items-center gap-2 ${failureCount ? 'text-amber-700' : 'text-slate-500'}`}><TriangleAlert className="h-5 w-5" /><span className="text-sm font-bold">上传失败</span></div>
            <p className={`mt-2 text-3xl font-bold ${failureCount ? 'text-amber-800' : 'text-slate-600'}`}>{failureCount}</p>
          </div>
        </div>

        <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">{successDescription}</p>

        {failures.length ? <section className="mt-4" aria-label="失败原因明细">
          <h3 className="text-sm font-bold text-slate-900">失败原因明细</h3>
          <ol className="mt-2 space-y-2">
            {failures.map((failure, index) => <li className="rounded-xl border border-amber-100 bg-amber-50/70 p-3" key={`${failure.item}-${index}`}>
              <p className="text-sm font-bold text-slate-900">{index + 1}. {failure.item}</p>
              <p className="mt-1 break-words text-sm leading-6 text-amber-900">{failure.reason}</p>
            </li>)}
          </ol>
        </section> : <p className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">本批次全部上传成功，没有失败项目。</p>}
      </div>

      <footer className="safe-bottom border-t border-slate-100 bg-white px-5 pt-3">
        <button className="ui-button-primary w-full" onClick={onClose} type="button">完成</button>
      </footer>
    </section>
  </div>;
}
