import type { V2TaskTimelineEvent } from '../../services/v2-tasks.service';

const eventClass: Record<'submitted' | 'rejected' | 'resubmitted', string> = {
  rejected: 'border-red-200 bg-red-50 text-red-800',
  resubmitted: 'border-violet-200 bg-violet-50 text-violet-800',
  submitted: 'border-blue-200 bg-blue-50 text-blue-800',
};

export function TaskSubmissionTimeline({ events, fallbackSubmittedAt }: { events: V2TaskTimelineEvent[]; fallbackSubmittedAt: string | null }) {
  if (!events.length && !fallbackSubmittedAt) return null;
  let submissionCount = 0;
  let rejectionCount = 0;
  let resubmissionCount = 0;
  const rows = events.length ? events.map((event) => {
    if (event.action === 'submitted') {
      submissionCount += 1;
      return { ...event, label: submissionCount === 1 ? '首次提交' : `第 ${submissionCount} 次提交` };
    }
    if (event.action === 'rejected') {
      rejectionCount += 1;
      return { ...event, label: rejectionCount === 1 ? '驳回' : `第 ${rejectionCount} 次驳回` };
    }
    resubmissionCount += 1;
    return { ...event, label: `第 ${resubmissionCount} 次重新提交` };
  }) : [{ action: 'submitted' as const, created_at: fallbackSubmittedAt!, id: 'fallback-submission', label: '提交', task_id: '' }];
  return <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600"><p className="mb-1 font-bold text-slate-700">提交与整改时间</p><div className="space-y-1.5">{rows.map((event) => <p className="flex items-center justify-between gap-3" key={event.id}><span className={`shrink-0 rounded-full border px-2 py-0.5 font-bold ${eventClass[event.action]}`}>{event.label}</span><time className="shrink-0 tabular-nums" dateTime={event.created_at}>{new Date(event.created_at).toLocaleString('zh-CN')}</time></p>)}</div></div>;
}
