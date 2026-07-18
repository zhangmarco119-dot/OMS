import { ReceiptText } from 'lucide-react';

import { SectionCard } from '../../components/ui/Surface';
import { formatMoney, type PayrollEstimate } from './model';

const monthLabel = (month: string) => {
  const [year, value] = month.slice(0, 7).split('-');
  return `${year}年${Number(value)}月`;
};

export function PayrollStatementView({ adminNote = '', estimate, payrollMonth }: { adminNote?: string; estimate: PayrollEstimate; payrollMonth: string }) {
  const earnings = [
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
  const payable = income - estimate.fineTotal;
  return <SectionCard className="overflow-hidden border-slate-200 p-0">
    <header className="border-b border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center">
      <ReceiptText className="mx-auto h-6 w-6 text-brand-700" />
      <h2 className="mt-1 text-xl font-bold text-slate-900">{monthLabel(payrollMonth)}工资单</h2>
      <p className="mt-1 text-sm text-slate-500">{estimate.displayName}</p>
    </header>
    <div className="px-4 py-2">
      {earnings.filter(([, amount]) => amount !== 0).map(([label, amount]) => <div className="flex items-center justify-between border-b border-slate-100 py-2.5 text-sm" key={label}><span className="text-slate-600">{label}</span><b className="tabular-nums text-slate-900">{formatMoney(amount)}</b></div>)}
      <div className="flex items-center justify-between border-b border-slate-100 py-2.5 text-sm"><span className="text-slate-600">扣款</span><b className="tabular-nums text-rose-700">{estimate.fineTotal ? `-${formatMoney(estimate.fineTotal)}` : formatMoney(0)}</b></div>
      <div className="flex items-end justify-between py-4"><div><p className="text-xs text-slate-500">实发合计</p><p className="mt-0.5 text-xs text-slate-400">收入 {formatMoney(income)} · 扣款 {formatMoney(estimate.fineTotal)}</p></div><strong className="text-2xl tabular-nums text-brand-800">{formatMoney(payable)}</strong></div>
      {adminNote ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"><b>工资单备注：</b>{adminNote}</p> : null}
    </div>
  </SectionCard>;
}
