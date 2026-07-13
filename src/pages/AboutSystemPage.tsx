import { CalendarDays, CheckCircle2, Info, Store } from 'lucide-react';

import { PageShell } from '../components/layout/PageShell';
import { systemReleaseHistory, systemVersion } from '../config/version';

export function AboutSystemPage() {
  return (
    <PageShell eyebrow="门店运营系统" title="关于系统" backTo="/app/account" contentGapClassName="gap-3">
      <section className="ui-card p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Store className="h-7 w-7" aria-hidden="true" /></div>
          <div><h2 className="text-lg font-bold text-ink">门店运营系统</h2><p className="mt-1 text-sm font-semibold text-brand-700">当前版本：{systemVersion}</p></div>
        </div>
        <p className="mt-4 text-sm leading-7 text-slate-600">用于门店点货、订货、到货、任务、公告、SOP、商品和账号协同管理。系统会持续保留每个版本的主要更新说明。</p>
      </section>

      <section aria-labelledby="release-history-title" className="space-y-3">
        <div className="flex items-center gap-2 px-1"><Info className="h-5 w-5 text-brand-700" aria-hidden="true" /><h2 className="font-bold text-ink" id="release-history-title">版本更新记录</h2></div>
        {systemReleaseHistory.map((release, index) => (
          <article className="ui-card p-4" key={release.version}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-ink">{release.title}</h3>{index === 0 ? <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">当前版本</span> : null}</div><p className="mt-1 text-sm font-semibold text-brand-700">{release.version}</p></div>
              <p className="flex shrink-0 items-center gap-1 text-xs text-slate-500"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{release.date}</p>
            </div>
            <ul className="mt-3 space-y-2 border-t border-line pt-3">
              {release.highlights.map((highlight) => <li className="flex items-start gap-2 text-sm leading-6 text-slate-600" key={highlight}><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" /><span>{highlight}</span></li>)}
            </ul>
          </article>
        ))}
      </section>
    </PageShell>
  );
}
