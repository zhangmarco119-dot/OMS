import type { V2TaskRow } from '../../services/v2-tasks.service';

type TaskStatus = V2TaskRow['status'];

const taskStatusesAwaitingSubmission: TaskStatus[] = ['pending', 'in_progress', 'rejected', 'overdue'];

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

export const isV2TaskOverdue = (
  task: Pick<V2TaskRow, 'due_at' | 'status'>,
  now = Date.now(),
) => taskStatusesAwaitingSubmission.includes(task.status)
  && (task.status === 'overdue' || new Date(task.due_at).getTime() <= now);

export const getV2TaskDisplayStatus = (
  task: Pick<V2TaskRow, 'due_at' | 'status'>,
  now = Date.now(),
): TaskStatus => isV2TaskOverdue(task, now) ? 'overdue' : task.status;

export const formatV2TaskDueAt = (dueAt: string) => new Date(dueAt).toLocaleString('zh-CN', {
  dateStyle: 'medium',
  hour12: false,
  timeStyle: 'short',
});
