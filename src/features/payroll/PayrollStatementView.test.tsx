import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PayrollEstimate } from './model';
import { PayrollStatementView } from './PayrollStatementView';

const estimate = { displayName:'员工甲',accruedBaseSalary:3000,accruedHousingAllowance:500,accruedPerformance:300,accruedFullAttendanceBonus:0,accruedExtraAttendanceBonus:300,accruedServiceAward:50,accruedExtraReward:80,accruedCommission:100,accruedOvertime:75,fineTotal:20 } as PayrollEstimate;

describe('PayrollStatementView', () => {
  it('renders a compact statement with a recomputed payable total', () => {
    render(<PayrollStatementView adminNote="本月核对完成" estimate={estimate} payrollMonth="2026-07-01" />);
    expect(screen.getByText('2026年7月工资单')).toBeInTheDocument();
    expect(screen.getByText('¥4,385.00')).toBeInTheDocument();
    expect(screen.getByText('超勤奖')).toBeInTheDocument();
    expect(screen.getByText('额外奖励')).toBeInTheDocument();
    expect(screen.getByText(/本月核对完成/)).toBeInTheDocument();
    expect(screen.queryByText('数据更新时间')).not.toBeInTheDocument();
  });
});
