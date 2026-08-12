import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PayrollEstimate } from './model';
import { PayrollStatementView } from './PayrollStatementView';

const estimate = { profileId:'p1',displayName:'员工甲',asOf:'2026-07-31',monthStart:'2026-07-01',monthEnd:'2026-07-31',accruedBaseSalary:3000,accruedHousingAllowance:500,accruedPerformance:300,accruedFullAttendanceBonus:0,accruedExtraAttendanceBonus:300,accruedServiceAward:50,accruedExtraReward:80,accruedCommission:100,accruedOvertime:75,fineTotal:20,individualIncomeTax:50,deductionTotal:70,deductionItems:[{id:'fine-1',date:'2026-07-12',createdAt:null,type:'penalty',title:'其他罚款',reason:'盘点差异处罚',amount:20,performanceDeduction:0}]} as PayrollEstimate;

describe('PayrollStatementView', () => {
  it('renders a compact statement with a recomputed payable total', () => {
    render(<PayrollStatementView adminNote="本月核对完成" estimate={estimate} payrollMonth="2026-07-01" />);
    expect(screen.getByText('2026年7月工资单')).toBeInTheDocument();
    expect(screen.getByText('¥4,335.00')).toBeInTheDocument();
    expect(screen.getByText('超勤奖')).toBeInTheDocument();
    expect(screen.getByText('额外奖励')).toBeInTheDocument();
    expect(screen.getByText('个税扣除')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /其他扣款.*点击查看扣款时间和原因.*-¥20\.00/ })).toBeInTheDocument();
    expect(screen.queryByText('扣款合计')).not.toBeInTheDocument();
    expect(screen.getByText('收入总计')).toBeInTheDocument();
    expect(screen.getByText('个税', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('其他扣款', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('¥4,335.00')).toHaveClass('whitespace-nowrap');
    expect(screen.getByText(/本月核对完成/)).toBeInTheDocument();
    expect(screen.queryByText('数据更新时间')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /其他扣款.*点击查看扣款时间和原因/ }));
    expect(screen.getByText('盘点差异处罚')).toBeInTheDocument();
    expect(screen.getByText('其他扣款明细')).toBeInTheDocument();
    expect(screen.queryByText('本月工资单个人所得税扣除')).not.toBeInTheDocument();
  });

  it('shows store grades without scores on multi-store payslips', () => {
    render(<PayrollStatementView estimate={{ ...estimate, hasMultiplePerformanceStores: true, performanceStores: [
      { allocationRatio: .5, amount: 150, calculationMode: 'grade', coefficient: 1, grade: 'A', score: null, storeId: 's1', storeName: '西直门店' },
      { allocationRatio: .5, amount: 150, calculationMode: 'score', coefficient: .8, grade: 'B', score: 82, storeId: 's2', storeName: '五道口店' },
    ] } as PayrollEstimate} payrollMonth="2026-07-01" />);
    expect(screen.getByText('西直门店 · A 级')).toBeInTheDocument();
    expect(screen.getByText('五道口店 · B 级')).toBeInTheDocument();
    expect(screen.queryByText(/82 分/)).not.toBeInTheDocument();
  });
});
