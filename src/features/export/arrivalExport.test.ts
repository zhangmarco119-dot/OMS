import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import type { AdminArrivalDetail, AdminArrivalSummary } from '../../services/admin-arrivals.service';
import {
  buildArrivalReportWorkbook,
  buildArrivalSummaryWorkbook,
  createArrivalReportExport,
  createArrivalSummaryExport,
} from './arrivalExport';

const reportDetail = {
  auditLogs: [{ action: 'arrival_report_submitted', actor_id: 'user-1', created_at: '2026-07-12T02:00:00Z', entity_id: 'report-1', entity_table: 'arrival_reports', id: 'audit-1', metadata: {}, store_id: 'store-1' }],
  images: [],
  items: [{ created_at: '2026-07-12T01:00:00Z', id: 'item-1', is_unmatched_product: false, note: null, product_id: 'product-1', product_name_snapshot: '原味酸奶', quantity: 12, report_id: 'report-1', sort_order: 0, unit: '箱', updated_at: '2026-07-12T01:00:00Z' }],
  report: {
    arrival_date: '2026-07-12', arrival_time: '10:00:00', carrier_name: '顺丰', created_at: '2026-07-12T01:00:00Z', generated_summary: '原味酸奶到货 12 箱。', id: 'report-1', note: null, report_no: 'ARR-20260712-00000001', reported_by: 'user-1', reporter_name_snapshot: '测试员工', status: 'viewed', store_id: 'store-1', store_name_snapshot: '测试门店', submission_key: 'submission-key', submitted_at: '2026-07-12T02:00:00Z', tracking_no: 'SF001', updated_at: '2026-07-12T02:01:00Z', version: 3, viewed_at: '2026-07-12T02:01:00Z', viewed_by: 'admin-1', void_reason: null, voided_at: null, voided_by: null,
  },
} as AdminArrivalDetail;

const summary: AdminArrivalSummary = {
  details: [{ arrival_date: '2026-07-12', arrival_time: '10:00:00', is_unmatched_product: false, item_id: 'item-1', product_id: 'product-1', product_name_snapshot: '原味酸奶', quantity: 12, report_id: 'report-1', report_no: 'ARR-1', reported_by: 'user-1', reporter_name_snapshot: '测试员工', sort_order: 0, status: 'viewed', store_id: 'store-1', store_name_snapshot: '测试门店', submitted_at: '2026-07-12T02:00:00Z', unit: '箱' }],
  products: [{ arrival_date: '2026-07-12', product_name_snapshot: '原味酸奶', report_count: 1, store_id: 'store-1', store_name_snapshot: '测试门店', total_quantity: 12, unit: '箱' }],
};

describe('arrival export', () => {
  it('builds a single report workbook and filename', () => {
    const workbook = buildArrivalReportWorkbook(reportDetail);
    expect(workbook.SheetNames).toEqual(['到货信息', '产品明细', '操作日志']);
    const rows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets['产品明细'], { header: 1 });
    expect(rows[1]).toContain('原味酸奶');
    expect(rows[1]).toContain(12);
    expect(createArrivalReportExport(reportDetail).filename).toBe('到货单_ARR-20260712-00000001.xlsx');
  });

  it('builds detail and product summary sheets', () => {
    const workbook = buildArrivalSummaryWorkbook(summary);
    expect(workbook.SheetNames).toEqual(['到货明细', '产品汇总']);
    expect(XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets['产品汇总'], { header: 1 })[1]).toContain(12);
    expect(createArrivalSummaryExport(summary, '2026-07-12').filename).toBe('到货汇总_2026-07-12.xlsx');
  });
});
