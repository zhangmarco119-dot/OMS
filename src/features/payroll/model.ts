export interface PayrollDeductionItem {
  id: string;
  date: string;
  createdAt: string | null;
  type: 'late' | 'penalty' | 'tax';
  title: string;
  reason: string;
  amount: number;
  performanceDeduction: number;
}

export interface PayrollEstimate {
  employmentType: 'full_time' | 'part_time';
  profileId: string;
  displayName: string;
  username: string;
  primaryStoreId: string;
  asOf: string;
  monthStart: string;
  monthEnd: string;
  partTimeHours: number;
  partTimeHourlyRate: number | null;
  accruedPartTimeWage: number;
  fullAttendanceDays: number;
  attendanceDays: number;
  ruleId: string | null;
  ruleConfirmed: boolean;
  monthlyBaseSalary: number | null;
  monthlyHousingAllowance: number | null;
  fullPerformanceAmount: number | null;
  commissionRate: number | null;
  housingEnabled: boolean;
  performanceEnabled: boolean;
  performanceOverrideEnabled: boolean;
  performanceOverrideAmount: number;
  performanceOverrideScore: number | null;
  performanceCalculationMode: 'automatic' | 'override';
  commissionEnabled: boolean;
  fullAttendanceBonusEnabled: boolean;
  fullAttendanceBonusAmount: number;
  fullAttendanceBonusAwarded: boolean;
  accruedFullAttendanceBonus: number;
  extraAttendanceDays: number;
  extraAttendanceBonusRate: number;
  accruedExtraAttendanceBonus: number;
  serviceAwardEnabled: boolean;
  serviceAwardAmount: number;
  accruedServiceAward: number;
  extraRewardAmount: number;
  accruedExtraReward: number;
  regularizationDate: string | null;
  eligibleAttendanceDays: number;
  regularizationFactor: number;
  isProbation: boolean;
  accruedBaseSalary: number;
  accruedHousingAllowance: number;
  accruedPerformance: number | null;
  accruedCommission: number | null;
  overtimeHours: number;
  overtimeHourlyRate: number | null;
  accruedOvertime: number;
  lateCount: number;
  lateMinutes: number;
  lateFine: number;
  otherFine: number;
  fineTotal: number;
  individualIncomeTax: number;
  estimatedIndividualIncomeTax?: number;
  individualIncomeTaxEstimateMode?: 'automatic' | 'override';
  individualIncomeTaxEstimateBasis?: 'current_month' | 'year_to_date';
  deductionTotal: number;
  deductionItems: PayrollDeductionItem[];
  taskDueCount: number;
  taskCompletedCount: number;
  taskScore: number | null;
  attendanceScore: number;
  disciplineScore: number;
  performanceScore: number | null;
  performanceGrade: string | null;
  revenueTotal: number;
  revenueEffectiveDate: string | null;
  revenueCarriedForward: boolean;
  performanceReady: boolean;
  commissionReady: boolean;
  dataComplete: boolean;
  incomeSubtotalKnown: number;
  knownEstimatedPayable: number;
  knownEstimatedNetPayable?: number;
  estimatedPayable: number | null;
  estimatedNetPayable?: number | null;
  attendanceUpdatedAt: string | null;
  tasksUpdatedAt: string | null;
  revenueUpdatedAt: string | null;
  penaltiesUpdatedAt: string | null;
  overtimeUpdatedAt: string | null;
  dataIssues: string[];
}

export interface AdminPayrollSummary {
  items: PayrollEstimate[];
  employeeCount: number;
  completeCount: number;
  incompleteCount: number;
  knownEstimatedTotal: number;
  completeEstimatedTotal: number;
}

export const formatMoney = (value: number | null | undefined) => value == null
  ? '待更新'
  : `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const todayInChina = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
