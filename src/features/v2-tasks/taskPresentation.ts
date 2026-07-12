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
  approved: 'bg-brand-50 text-brand-700',
  cancelled: 'bg-slate-100 text-slate-600',
  in_progress: 'bg-sky-50 text-sky-700',
  overdue: 'bg-red-50 text-red-700',
  pending: 'bg-amber-50 text-amber-800',
  rejected: 'bg-red-50 text-red-700',
  resubmitted: 'bg-violet-50 text-violet-700',
  submitted: 'bg-blue-50 text-blue-700',
};
