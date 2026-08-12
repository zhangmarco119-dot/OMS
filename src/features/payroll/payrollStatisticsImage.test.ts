import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PayrollStatistics } from '../../services/payroll-statistics.service';
import { downloadPayrollStatisticsImage, payrollStatisticsImageFileName } from './payrollStatisticsImage';

const statistics: PayrollStatistics = {
  averageHourlyCost: 33.26,
  employees: [{
    averageHourlyCost: 43.21,
    breakdown: {
      baseSalary: 8000, commission: 600, extraAttendanceBonus: 100, extraReward: 50, fines: 20,
      fullAttendanceBonus: 100, grossIncome: 9000, housingAllowance: 100, individualIncomeTax: 80,
      netPayable: 8900, overtime: 50, partTimeWage: 0, performance: 0, serviceAward: 0,
    },
    displayName: '员工甲', employmentType: 'full_time', hours: 208.28, periods: [], profileId: 'profile-1', salaryCost: 8920,
  }],
  from: '2026-07-01',
  overallPayrollRatio: 0.1843,
  stores: [{
    averageHourlyCost: 31.38,
    hours: 504,
    name: '宝珠奶酪（五道口店）',
    payrollShare: 0.5155,
    payrollToRevenueRatio: 0.1222,
    revenue: 129413,
    salaryCost: 15814.4,
    storeId: 'store-wudaokou',
  }],
  to: '2026-07-31',
  totalHours: 922.5,
  totalRevenue: 166437.93,
  totalSalaryCost: 30680.1,
};

describe('payroll statistics image', () => {
  const fillText = vi.fn();
  const createObjectURL = vi.fn(() => 'blob:payroll-statistics-current');
  const revokeObjectURL = vi.fn();
  let downloadedFileName = '';

  beforeEach(() => {
    vi.useFakeTimers();
    fillText.mockClear();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    downloadedFileName = '';
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      beginPath: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fill: vi.fn(),
      fillRect: vi.fn(),
      fillText,
      roundRect: vi.fn(),
      set fillStyle(_value: string) {},
      set font(_value: string) {},
      set textAlign(_value: CanvasTextAlign) {},
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['current-image'], { type: 'image/png' })));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      downloadedFileName = this.download;
    });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('draws the exact revenue values supplied by the current page statistics', async () => {
    await downloadPayrollStatisticsImage(statistics, new Date('2026-08-10T06:20:30Z'));

    const drawnValues = fillText.mock.calls.map(([value]) => value);
    expect(drawnValues).toContain('¥ 166,437.93');
    expect(drawnValues).toContain('¥ 129,413.00');
    expect(drawnValues).toContain('12.22%');
    expect(drawnValues).toContain('实发 ¥ 8,900.00');
    expect(drawnValues).toContain('基本 ¥ 8,000.00 · 房补 ¥ 100.00 · 绩效 ¥ 0.00 · 全勤 ¥ 100.00 · 超勤 ¥ 100.00 · 工龄 ¥ 0.00');
  });

  it('uses a unique timestamped file name and keeps the Blob URL alive for mobile downloads', async () => {
    const generatedAt = new Date('2026-08-10T06:20:30Z');
    await downloadPayrollStatisticsImage(statistics, generatedAt);

    expect(downloadedFileName).toBe('StoreHub_薪资综合统计_2026-07-01_2026-07-31_20260810_142030000.png');
    expect(document.querySelector(`a[download="${downloadedFileName}"]`)).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:payroll-statistics-current');
  });

  it('creates different names for repeated downloads of the same range', () => {
    expect(payrollStatisticsImageFileName(statistics, new Date('2026-08-10T06:20:30.001Z')))
      .not.toBe(payrollStatisticsImageFileName(statistics, new Date('2026-08-10T06:20:30.002Z')));
  });
});
