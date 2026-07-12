import * as XLSX from 'xlsx';

import type {
  AdminArrivalDetail,
  AdminArrivalSummary,
} from '../../services/admin-arrivals.service';

export interface ArrivalExportFile {
  blob: Blob;
  filename: string;
}

const statusLabel = {
  draft: '草稿',
  submitted: '待查看',
  viewed: '已查看',
  voided: '已作废',
} as const;

const makeFile = (workbook: XLSX.WorkBook, filename: string): ArrivalExportFile => {
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return {
    blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename,
  };
};

export const buildArrivalReportWorkbook = ({ auditLogs, items, report }: AdminArrivalDetail) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['到货编号', report.report_no],
    ['门店', report.store_name_snapshot],
    ['提交人', report.reporter_name_snapshot],
    ['到货日期', report.arrival_date],
    ['到货时间', report.arrival_time ?? ''],
    ['配送方', report.carrier_name ?? ''],
    ['快递单号', report.tracking_no ?? ''],
    ['自动描述', report.generated_summary],
    ['备注', report.note ?? ''],
    ['状态', statusLabel[report.status]],
    ['创建时间', report.created_at],
    ['提交时间', report.submitted_at ?? ''],
    ['查看时间', report.viewed_at ?? ''],
    ['作废时间', report.voided_at ?? ''],
    ['作废原因', report.void_reason ?? ''],
  ]), '到货信息');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['序号', '产品名称', '数量', '单位', '未匹配商品', '备注'],
    ...items.map((item, index) => [
      index + 1,
      item.product_name_snapshot,
      item.quantity,
      item.unit,
      item.is_unmatched_product ? '是' : '否',
      item.note ?? '',
    ]),
  ]), '产品明细');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['时间', '操作', '操作人 ID', '记录'],
    ...auditLogs.map((log) => [log.created_at, log.action, log.actor_id ?? '', JSON.stringify(log.metadata)]),
  ]), '操作日志');
  return workbook;
};

export const createArrivalReportExport = (detail: AdminArrivalDetail) =>
  makeFile(buildArrivalReportWorkbook(detail), `到货单_${detail.report.report_no}.xlsx`);

export const buildArrivalSummaryWorkbook = ({ details, products }: AdminArrivalSummary) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['到货日期', '到货时间', '门店', '产品名称', '数量', '单位', '提交人', '到货编号'],
    ...details.map((row) => [
      row.arrival_date ?? '', row.arrival_time ?? '', row.store_name_snapshot ?? '',
      row.product_name_snapshot ?? '', row.quantity ?? '', row.unit ?? '',
      row.reporter_name_snapshot ?? '', row.report_no ?? '',
    ]),
  ]), '到货明细');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['到货日期', '门店', '产品名称', '合计数量', '单位', '上报次数'],
    ...products.map((row) => [
      row.arrival_date ?? '', row.store_name_snapshot ?? '', row.product_name_snapshot ?? '',
      row.total_quantity ?? '', row.unit ?? '', row.report_count ?? '',
    ]),
  ]), '产品汇总');
  return workbook;
};

export const createArrivalSummaryExport = (summary: AdminArrivalSummary, date: string) =>
  makeFile(buildArrivalSummaryWorkbook(summary), `到货汇总_${date}.xlsx`);

export const downloadArrivalExport = ({ blob, filename }: ArrivalExportFile) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
