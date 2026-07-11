import * as XLSX from 'xlsx';

import type { Database } from '../../types/database';
import type { TaskType } from '../../types/domain';
import { asProductSnapshot, type TaskItemRow } from '../tasks/taskCalculations';

type TaskRow = Database['public']['Tables']['tasks']['Row'];
type ProductFeedbackRow = Database['public']['Tables']['product_feedback']['Row'];

interface StoreExportInfo {
  name: string;
  shortName?: string;
}

export interface TaskExportInput {
  feedback?: ProductFeedbackRow[];
  items: TaskItemRow[];
  store: StoreExportInfo;
  task: TaskRow;
}

export interface TaskExportFile {
  blob: Blob;
  filename: string;
}

const taskTypeLabel: Record<TaskType, string> = {
  inventory: '盘点单',
  order: '订货单',
};

const statusLabel: Record<TaskItemRow['status'], string> = {
  pending: '未处理',
  completed: '已完成',
  no_order_needed: '无需订货',
};

const safeFilenamePart = (value: string) => value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '').slice(0, 40);

const formatDateTimeForFilename = (value: string | null) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return '未记录时间';
  }
  const pad = (part: number) => String(part).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('');
};

const feedbackSummary = (feedback: ProductFeedbackRow[] | undefined, itemId: string) => {
  const rows = feedback?.filter((row) => row.task_item_id === itemId) ?? [];
  if (rows.length === 0) {
    return '';
  }
  return rows
    .map((row) => {
      const label = row.feedback_type === 'discontinued' ? '不再使用' : row.feedback_type === 'incorrect' ? '信息有误' : '新增商品';
      return row.note ? `${label}: ${row.note}` : label;
    })
    .join('；');
};

export const makeTaskFilename = (task: TaskRow, store: StoreExportInfo) => {
  const storeName = safeFilenamePart(store.shortName || store.name || '门店');
  const typeName = taskTypeLabel[task.task_type];
  const time = formatDateTimeForFilename(task.submitted_at ?? task.updated_at);
  return `${storeName}-${typeName}-${time}.xlsx`;
};

export const buildTaskWorkbook = ({ feedback, items, store, task }: TaskExportInput) => {
  const typeName = taskTypeLabel[task.task_type];
  const submittedAt = task.submitted_at ?? new Date().toISOString();
  const exportAt = new Date().toISOString();

  const summaryRows = [
    ['门店', store.name],
    ['单据类型', typeName],
    ['任务编号', task.id],
    ['任务状态', task.status],
    ['开始时间', task.started_at],
    ['提交时间', submittedAt],
    ['导出时间', exportAt],
    ['商品总数', items.length],
    ['已处理数量', items.filter((item) => item.status !== 'pending' || item.quantity !== null).length],
  ];

  const itemRows = [
    ['序号', '商品名称', '规格', '单位', '商品编码', '数量', '状态', '临时商品', '备注', '维护反馈'],
    ...items.map((item, index) => {
      const snapshot = asProductSnapshot(item.product_snapshot);
      return [
        index + 1,
        snapshot.name,
        snapshot.spec,
        snapshot.count_unit,
        snapshot.product_code ?? '',
        item.status === 'no_order_needed' ? '' : item.quantity ?? '',
        statusLabel[item.status],
        item.is_extra_item ? '是' : '否',
        item.staff_note ?? '',
        feedbackSummary(feedback, item.id),
      ];
    }),
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), '单据信息');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(itemRows), typeName);
  return workbook;
};

export const createTaskExportFile = (input: TaskExportInput): TaskExportFile => {
  const workbook = buildTaskWorkbook(input);
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return {
    blob,
    filename: makeTaskFilename(input.task, input.store),
  };
};

export const downloadTaskExportFile = ({ blob, filename }: TaskExportFile) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const shareOrDownloadTaskExportFile = async (file: TaskExportFile) => {
  const exportFile = new File([file.blob], file.filename, { type: file.blob.type });
  if (navigator.canShare?.({ files: [exportFile] })) {
    await navigator.share({
      files: [exportFile],
      title: file.filename,
    });
    return 'shared' as const;
  }

  downloadTaskExportFile(file);
  return 'downloaded' as const;
};
