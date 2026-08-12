import { ReceiptText } from 'lucide-react';

import { SectionCard } from '../../components/ui/Surface';
import { formatMoney, type PayrollEstimate } from './model';
import { PayrollDeductionRow } from './PayrollDeductionDetails';

const monthLabel = (month: string) => {
  const [year, value] = month.slice(0, 7).split('-');
  return `${year}年${Number(value)}月`;
};

export function PayrollStatementView({ adminNote = '', estimate, payrollMonth }: { adminNote?: string; estimate: PayrollEstimate; payrollMonth: string }) {
  const earnings = estimate.employmentType === 'part_time' ? [
    ['兼职薪资', estimate.accruedPartTimeWage],
  ] as const : [
    ['基本工资', estimate.accruedBaseSalary],
    ['房补', estimate.accruedHousingAllowance],
    ['绩效', estimate.accruedPerformance ?? 0],
    ['全勤奖', estimate.accruedFullAttendanceBonus],
    ['超勤奖', estimate.accruedExtraAttendanceBonus],
    ['工龄奖', estimate.accruedServiceAward],
    ['额外奖励', estimate.accruedExtraReward],
    ['提成', estimate.accruedCommission ?? 0],
    ['加班', estimate.accruedOvertime],
  ] as const;
  const income = earnings.reduce((sum, [, amount]) => sum + amount, 0);
  const otherDeductions = estimate.fineTotal;
  const totalDeductions = otherDeductions + estimate.individualIncomeTax;
  const payable = income - totalDeductions;
  return <SectionCard className="overflow-hidden border-slate-200 p-0">
    <header className="border-b border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center">
      <ReceiptText className="mx-auto h-6 w-6 text-brand-700" />
      <h2 className="mt-1 text-xl font-bold text-slate-900">{monthLabel(payrollMonth)}工资单</h2>
      <p className="mt-1 text-sm text-slate-500">{estimate.displayName}</p>
    </header>
    <div className="px-4 py-2">
      {earnings.filter(([, amount]) => amount !== 0).map(([label, amount]) => <div className="flex items-center justify-between border-b border-slate-100 py-2.5 text-sm" key={label}><span className="text-slate-600">{label}</span><b className="tabular-nums text-slate-900">{formatMoney(amount)}</b></div>)}
      {estimate.hasMultiplePerformanceStores ? <div className="border-b border-slate-100 py-2.5"><p className="text-xs text-slate-500">门店绩效等级</p><div className="mt-1.5 flex flex-wrap gap-1.5">{(estimate.performanceStores ?? []).map((item) => <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900" key={item.storeId}>{item.storeName} · {item.grade} 级</span>)}</div></div> : null}
      <div className="flex items-center justify-between border-b border-slate-100 py-2.5 text-sm"><span className="text-slate-600">个税扣除</span><b className="tabular-nums text-rose-700">{estimate.individualIncomeTax ? `-${formatMoney(estimate.individualIncomeTax)}` : formatMoney(0)}</b></div>
      <PayrollDeductionRow detailsTitle="其他扣款明细" emptyMessage="本期没有其他扣款记录。" estimate={estimate} label="其他扣款" total={otherDeductions} />
      <div className="py-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <p className="shrink-0 text-sm font-semibold text-slate-600">实发合计</p>
          <strong className="shrink-0 whitespace-nowrap text-[clamp(1.75rem,8vw,2.5rem)] font-bold leading-none tabular-nums tracking-tight text-brand-800">{formatMoney(payable)}</strong>
        </div>
        <dl className="mt-3 space-y-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">收入总计</dt><dd className="whitespace-nowrap font-semibold tabular-nums text-slate-700">{formatMoney(income)}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">个税</dt><dd className="whitespace-nowrap font-semibold tabular-nums text-rose-700">-{formatMoney(estimate.individualIncomeTax)}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">其他扣款</dt><dd className="whitespace-nowrap font-semibold tabular-nums text-rose-700">-{formatMoney(otherDeductions)}</dd></div>
        </dl>
      </div>
      {adminNote ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"><b>工资单备注：</b>{adminNote}</p> : null}
    </div>
  </SectionCard>;
}
