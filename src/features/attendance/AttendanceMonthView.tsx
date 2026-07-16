import { AlertTriangle, CalendarDays, Clock3 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { EmptyState, StatusBadge } from '../../components/ui/Feedback';
import { SectionCard } from '../../components/ui/Surface';
import { filterAttendanceDays, formatAttendanceHours, formatAttendanceTime, statusMeta, type AttendanceMonthDetail } from './model';

export function AttendanceMonthView({ detail }: { detail: AttendanceMonthDetail }) {
  const [filter, setFilter] = useState<'all' | 'exceptions'>('all');
  const days = useMemo(() => filterAttendanceDays(detail.days, filter), [detail.days, filter]);
  const summary = detail.summary;
  return <>
    <section className="grid grid-cols-3 gap-2">
      <Metric label="出勤天数" value={summary.attendanceDays} />
      <Metric label="出勤工时" value={`${formatAttendanceHours(summary.workedMinutes)} 小时`} />
      <Metric label="迟到次数" value={summary.lateCount} />
      <Metric label="迟到分钟" value={summary.lateMinutes} />
      <Metric label="缺卡次数" value={summary.missingCount} />
      <Metric label="异常次数" value={summary.abnormalCount} />
    </section>
    <SectionCard className="p-3">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
        <button className={`min-h-10 rounded-md text-sm font-bold ${filter === 'all' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setFilter('all')} type="button">全部每日记录</button>
        <button className={`min-h-10 rounded-md text-sm font-bold ${filter === 'exceptions' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`} onClick={() => setFilter('exceptions')} type="button">迟到与异常</button>
      </div>
    </SectionCard>
    {days.length ? <section className="space-y-2">{days.map((day) => {
      const meta = statusMeta[day.status] ?? statusMeta.abnormal;
      const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(`${day.date}T12:00:00+08:00`));
      return <SectionCard className="p-3.5" key={day.id}>
        <div className="flex items-start justify-between gap-3"><div><b className="text-slate-900">{day.date.slice(5).replace('-', '月')}日 · {weekday}</b><p className="mt-0.5 text-xs text-slate-500">{day.shiftName || '未提供班次名称'}</p></div><div className="flex flex-wrap justify-end gap-1">{day.hasFieldwork ? <StatusBadge tone="info">外勤打卡</StatusBadge> : null}<StatusBadge tone={meta.tone}>{meta.label}</StatusBadge></div></div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <TimeBlock label="上班" planned={day.plannedOnAt} actual={day.actualOnAt} />
          <TimeBlock label="下班" planned={day.plannedOffAt} actual={day.actualOffAt} />
        </div>
        <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800">当日合计工时：{formatAttendanceHours(day.workedMinutes ?? 0)} 小时</p>
        {day.hasScheduleConflict ? <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-900"><AlertTriangle className="mr-1 inline h-4 w-4" />异常：同一天在两个门店都有有效排班，请管理员核对。</div> : null}
        {day.sources && day.sources.length > 1 ? <details className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><summary className="cursor-pointer font-semibold text-brand-700">查看 {day.sources.length} 个企业的考勤来源</summary><div className="mt-2 space-y-1.5">{day.sources.map((source) => <div className="rounded-md bg-white p-2" key={`${source.corpId}-${source.storeId}`}><b>{source.enterpriseName}</b><span className="text-slate-400"> · {source.storeName}</span><p className="mt-1">{source.plannedOnAt || source.plannedOffAt ? <>应打卡 {formatAttendanceTime(source.plannedOnAt)}–{formatAttendanceTime(source.plannedOffAt)}{source.shiftName ? ` · ${source.shiftName}` : ''}</> : '当天无排班'}</p></div>)}</div></details> : null}
        {day.lateMinutes || day.earlyMinutes ? <p className="mt-2 text-sm font-semibold text-amber-800">{day.lateMinutes ? `迟到 ${day.lateMinutes} 分钟` : ''}{day.lateMinutes && day.earlyMinutes ? '；' : ''}{day.earlyMinutes ? `早退 ${day.earlyMinutes} 分钟` : ''}</p> : null}
        {day.missingPunch !== 'none' ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{day.missingPunch === 'on' ? '缺上班卡' : day.missingPunch === 'off' ? '缺下班卡' : '上班卡和下班卡均缺失'}</p> : null}
        {day.exceptionNote ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm leading-5 text-red-800">{day.exceptionNote}</p> : null}
        <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer font-semibold text-brand-700">查看打卡（{day.punches.length} 次）</summary>{day.punches.length ? <div className="mt-2 flex flex-wrap gap-1.5">{day.punches.map((punch) => <span className="rounded bg-slate-100 px-2 py-1" key={punch.id}>{formatAttendanceTime(punch.time)}{punch.enterpriseName ? ` · ${punch.enterpriseName}` : ''}{punch.locationName ? ` · ${punch.locationName}` : ''}</span>)}</div> : <p className="mt-2 rounded bg-slate-50 p-2 text-slate-500">当天暂无打卡记录。</p>}</details>
      </SectionCard>;
    })}</section> : <EmptyState icon={CalendarDays} title={filter === 'all' ? '本月暂无考勤记录' : '本月暂无迟到或异常'} description={filter === 'all' ? '管理员完成钉钉员工绑定并同步后，记录会显示在这里。' : '当前筛选下没有需要关注的记录。'} />}
    <p className="px-1 text-xs leading-5 text-slate-500">数据以钉钉考勤和排班结果为准。最近同步：{summary.lastSyncedAt ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(summary.lastSyncedAt)) : '尚未同步'}</p>
  </>;
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div className="ui-card min-w-0 p-3 text-center"><p className="text-xl font-bold tabular-nums text-slate-900">{value}</p><p className="mt-0.5 truncate text-[11px] text-slate-500">{label}</p></div>;
}

function TimeBlock({ actual, label, planned }: { actual: string | null; label: string; planned: string | null }) {
  return <div className="rounded-lg bg-slate-50 p-2.5"><p className="flex items-center gap-1 text-xs font-semibold text-slate-500"><Clock3 className="h-3.5 w-3.5" />{label}</p><p className="mt-1 font-bold tabular-nums text-slate-900">实际 {formatAttendanceTime(actual)}</p><p className="mt-0.5 text-xs tabular-nums text-slate-500">应打卡 {formatAttendanceTime(planned)}</p></div>;
}
