import type { V2TaskRow } from '../../services/v2-tasks.service';

type TaskStatus = V2TaskRow['status'];

export const v2TaskStatusLabel: Record<TaskStatus, string> = {
  approved: '已通过',
  cancelled: '已取消',
  in_progress: '进行中',
  overdue: '已逾期',
  pending: '待完成',
  rejected: '退回整改',
  resubmitted: '已重新提交',
  submitted: '待审核',
};

export const v2TaskStatusClass: Record<TaskStatus, string> = {
  approved: 'border border-emerald-200 bg-emerald-50 text-emerald-800',
  cancelled: 'border border-slate-200 bg-slate-100 text-slate-600',
  in_progress: 'border border-sky-200 bg-sky-50 text-sky-800',
  overdue: 'border border-red-200 bg-red-50 text-red-800',
  pending: 'border border-amber-200 bg-amber-50 text-amber-900',
  rejected: 'border border-red-200 bg-red-50 text-red-800',
  resubmitted: 'border border-violet-200 bg-violet-50 text-violet-800',
  submitted: 'border border-blue-200 bg-blue-50 text-blue-800',
};
