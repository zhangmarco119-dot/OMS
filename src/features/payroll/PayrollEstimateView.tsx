import { AlertTriangle, CalendarDays, CircleDollarSign, ClipboardCheck, Clock3, Database } from 'lucide-react';

import { SectionCard, SectionHeader } from '../../components/ui/Surface';
import { StatusBadge } from '../../components/ui/Feedback';
import { formatMoney, type PayrollEstimate } from './model';

const updated = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '尚无数据';

function AmountRow({ label, note, value }: { label: string; note: string; value: number | null }) {
  return <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0"><div><b className="text-sm text-slate-800">{label}</b><p className="mt-0.5 text-xs leading-4 text-slate-500">{note}</p></div><span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{formatMoney(value)}</span></div>;
}

export function PayrollEstimateView({ estimate, mode = 'estimate', onResolveIssue }: { estimate: PayrollEstimate; mode?: 'estimate' | 'payslip'; onResolveIssue?: (issue: string) => void }) {
  const payable = estimate.dataComplete ? estimate.estimatedPayable : estimate.knownEstimatedPayable;
  const performanceNote = estimate.performanceReady
    ? `当前 ${estimate.performanceGrade ?? '-'} 级，${estimate.performanceScore ?? '-'} 分`
    : '任务数据或满绩效金额待完善';
  const regularizationNote = estimate.regularizationDate?.slice(0, 7) === estimate.monthStart.slice(0, 7)
    ? estimate.regularizationFactor < 1
      ? ` · 转正日 ${estimate.regularizationDate}，仅按转正后 ${estimate.eligibleAttendanceDays} 个出勤日折算`
      : ` · 本月 ${estimate.regularizationDate} 转正`
    : '';
  return <>
    <SectionCard className="border-brand-100 bg-gradient-to-br from-brand-700 to-emerald-800 text-white">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-emerald-100">{mode === 'payslip' ? `截至 ${estimate.asOf} 的工资单金额` : `截至 ${estimate.asOf} 的预估工资`}</p><p className="mt-2 text-3xl font-bold tabular-nums">{formatMoney(payable)}</p></div><StatusBadge tone={estimate.dataComplete ? 'success' : 'warning'}>{estimate.dataComplete ? '数据完整' : '部分待更新'}</StatusBadge></div>
      <p className="mt-3 text-xs leading-5 text-emerald-100">{mode === 'payslip' ? '以下内容为管理员发放时保存的工资快照，后续实时数据变化不会修改本工资单。' : '仅累计本月 1 日至所选日期的已产生金额，不预测月末工资；最终工资以管理员月末确认为准。'}</p>
    </SectionCard>

    {estimate.dataIssues.length ? <SectionCard className="border-amber-200 bg-amber-50 p-3.5"><div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" /><div className="min-w-0 flex-1"><b className="text-sm text-amber-900">仍有数据待完善</b><div className="mt-2 space-y-1.5">{estimate.dataIssues.map((issue) => onResolveIssue ? <button className="flex min-h-10 w-full items-center justify-between rounded-lg border border-amber-200 bg-white px-3 text-left text-xs font-semibold text-amber-900" key={issue} onClick={() => onResolveIssue(issue)} type="button"><span>{issue}</span><span className="ml-2 shrink-0 text-brand-700">去更新</span></button> : <p className="text-xs leading-5 text-amber-800" key={issue}>• {issue}</p>)}</div></div></div></SectionCard> : null}

    <SectionCard><SectionHeader icon={CalendarDays} title="出勤与计薪口径" /><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="累计出勤" value={`${estimate.attendanceDays} 天`} /><Metric label="全勤标准" value={`${estimate.fullAttendanceDays} 天`} /><Metric label="迟到" value={`${estimate.lateCount} 次`} /></div></SectionCard>

    <SectionCard><SectionHeader icon={CircleDollarSign} title="工资明细" description="每项金额均按截至当前日期的实际数据计算。" /><div className="mt-2">
      <AmountRow label="累计基本工资" note={`${formatMoney(estimate.monthlyBaseSalary)}（含社保补贴） ÷ ${estimate.fullAttendanceDays} × ${Math.min(estimate.attendanceDays, estimate.fullAttendanceDays)} 天`} value={estimate.accruedBaseSalary} />
      <AmountRow label="累计房补" note={estimate.housingEnabled ? `按 ${estimate.attendanceDays} 个出勤日折算` : '该员工未启用房补'} value={estimate.accruedHousingAllowance} />
      <AmountRow label="累计绩效" note={`${performanceNote}${regularizationNote}`} value={estimate.accruedPerformance} />
      {estimate.fullAttendanceBonusEnabled ? <AmountRow label="全勤奖" note={estimate.fullAttendanceBonusAwarded ? `本月累计出勤已达到 ${estimate.fullAttendanceDays} 天` : `累计出勤达到 ${estimate.fullAttendanceDays} 天后产生 ${formatMoney(estimate.fullAttendanceBonusAmount)}`} value={estimate.accruedFullAttendanceBonus} /> : null}
      <AmountRow label="超勤奖" note={`超过全勤标准 ${estimate.extraAttendanceDays} 天 · 每超 1 天 ${formatMoney(estimate.extraAttendanceBonusRate)}`} value={estimate.accruedExtraAttendanceBonus} />
      {estimate.serviceAwardEnabled ? <AmountRow label="工龄奖" note={`${formatMoney(estimate.serviceAwardAmount)} ÷ ${estimate.fullAttendanceDays} × ${Math.min(estimate.attendanceDays, estimate.fullAttendanceDays)} 天`} value={estimate.accruedServiceAward} /> : null}
      {estimate.accruedExtraReward > 0 ? <AmountRow label="额外奖励" note="管理员在员工工资参数中设置的本月额外奖励" value={estimate.accruedExtraReward} /> : null}
      <AmountRow label="累计提成" note={estimate.commissionEnabled ? `本月累计提成基数 ${formatMoney(estimate.revenueTotal)} × ${((estimate.commissionRate ?? 0) * 100).toFixed(2)}%${regularizationNote}` : '该员工未启用营业收入提成'} value={estimate.accruedCommission} />
      <AmountRow label="已审批加班" note={`${estimate.overtimeHours} 小时 · 当前参考时薪 ${formatMoney(estimate.overtimeHourlyRate)}/小时`} value={estimate.accruedOvertime} />
      <AmountRow label="罚款合计" note={`迟到 ${formatMoney(estimate.lateFine)} + 其他 ${formatMoney(estimate.otherFine)}`} value={-estimate.fineTotal} />
    </div></SectionCard>

    <SectionCard><SectionHeader icon={ClipboardCheck} title="绩效评分" description={estimate.performanceReady ? `${estimate.performanceScore} 分 · ${estimate.performanceGrade} 级` : '当前待评分'} /><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="任务完成" value={`${estimate.taskCompletedCount}/${estimate.taskDueCount}`} /><Metric label="考勤得分" value={`${estimate.attendanceScore}`} /><Metric label="纪律得分" value={`${estimate.disciplineScore}`} /></div><p className="mt-3 text-xs text-slate-500">迟到共 {estimate.lateMinutes} 分钟，迟到罚款 {formatMoney(estimate.lateFine)}；其他罚款 {formatMoney(estimate.otherFine)}。</p></SectionCard>

    <SectionCard><SectionHeader icon={Database} title="数据更新时间" description="用于判断预估结果是否已包含最新业务数据。" /><div className="mt-3 space-y-1.5 text-xs text-slate-600"><p><Clock3 className="mr-1 inline h-3.5 w-3.5" />考勤：{updated(estimate.attendanceUpdatedAt)}</p><p>任务：{updated(estimate.tasksUpdatedAt)}</p><p>营业收入：{updated(estimate.revenueUpdatedAt)}</p><p>处罚：{updated(estimate.penaltiesUpdatedAt)}</p><p>加班：{updated(estimate.overtimeUpdatedAt)}</p></div></SectionCard>
  </>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 px-2 py-2.5"><b className="block text-sm tabular-nums text-slate-900">{value}</b><span className="mt-0.5 block text-[11px] text-slate-500">{label}</span></div>;
}
