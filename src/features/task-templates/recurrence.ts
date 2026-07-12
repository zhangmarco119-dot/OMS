import type { TaskTemplateDraft } from './templateForm';

export type TaskRecurrence = TaskTemplateDraft['recurrence'];

export const recurrenceLabel: Record<TaskRecurrence, string> = {
  monthly: '每月',
  none: '不重复',
  weekly: '每周',
};

export const weeklyDeadlineOptions = [
  { label: '周一', value: 1 }, { label: '周二', value: 2 }, { label: '周三', value: 3 },
  { label: '周四', value: 4 }, { label: '周五', value: 5 }, { label: '周六', value: 6 },
  { label: '周日', value: 7 },
];

export const formatRecurringDeadline = (recurrence: TaskRecurrence, recurrenceDay: number | null, dueTime: string | null) => {
  if (recurrence === 'none') return '按需发布，管理员设置本次截止时间';
  const time = dueTime?.slice(0, 5) || '未设置时间';
  if (recurrence === 'weekly') return `每周${weeklyDeadlineOptions.find((entry) => entry.value === recurrenceDay)?.label ?? '未设置'} ${time} 前完成`;
  return `每月${recurrenceDay ?? '未设置'}日 ${time} 前完成`;
};

export const nextRecurringDueAt = (recurrence: TaskRecurrence, recurrenceDay: number | null, dueTime: string | null, now = new Date()) => {
  if (recurrence === 'none' || !recurrenceDay || !dueTime) return null;
  const [hour, minute] = dueTime.slice(0, 5).split(':').map(Number);
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);

  if (recurrence === 'weekly') {
    const currentIsoDay = candidate.getDay() || 7;
    candidate.setDate(candidate.getDate() + ((recurrenceDay - currentIsoDay + 7) % 7));
  } else {
    const lastDay = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
    candidate.setDate(Math.min(recurrenceDay, lastDay));
  }
  candidate.setHours(hour, minute, 0, 0);

  if (candidate <= now) {
    if (recurrence === 'weekly') candidate.setDate(candidate.getDate() + 7);
    else {
      candidate.setMonth(candidate.getMonth() + 1, 1);
      const lastDay = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
      candidate.setDate(Math.min(recurrenceDay, lastDay));
    }
  }
  return candidate.toISOString();
};
