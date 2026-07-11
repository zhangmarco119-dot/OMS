import { CheckCircle2, History, Home, PackagePlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { supabase } from '../lib/supabase';
import { loadArrivalReport, type ArrivalReportRow } from '../services/arrivals.service';

export function ArrivalSuccessPage() {
  const { reportId } = useParams();
  const [report, setReport] = useState<ArrivalReportRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !reportId) {
      setMessage('缺少到货记录信息。');
      return;
    }
    void loadArrivalReport(supabase, reportId)
      .then((loaded) => {
        if (loaded.status === 'draft') {
          throw new Error('这条到货记录尚未提交。');
        }
        setReport(loaded);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : '加载到货记录失败。'));
  }, [reportId]);

  return (
    <PageShell eyebrow="StoreHub V2" title="提交结果" backTo="/app">
      <section className="rounded-lg bg-white p-6 text-center shadow-sm">
        <CheckCircle2 className="mx-auto h-16 w-16 text-brand-600" aria-hidden="true" />
        <h2 className="mt-4 text-2xl font-bold text-slate-900">到货上报已提交</h2>
        {report ? <><p className="mt-3 text-sm font-semibold text-brand-700">{report.report_no}</p><p className="mt-3 text-sm leading-7 text-slate-600">{report.generated_summary}</p></> : <p className="mt-3 text-sm text-slate-500">{message ?? '正在读取提交结果…'}</p>}
      </section>
      <div className="grid gap-3">
        <Link className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white" to="/app/arrivals/history"><History className="h-5 w-5" aria-hidden="true" />查看记录</Link>
        <Link className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-brand-600 bg-white px-4 font-bold text-brand-700" to="/app/arrivals"><PackagePlus className="h-5 w-5" aria-hidden="true" />继续上报下一批</Link>
        <Link className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-slate-100 px-4 font-bold text-slate-700" to="/app"><Home className="h-5 w-5" aria-hidden="true" />返回工作台</Link>
      </div>
    </PageShell>
  );
}
