import { describe, expect, it } from 'vitest';
import { buildOperationReportText, getMissingOperationReportFields } from './reportText';

describe('buildOperationReportText', () => {
  it('builds the configured report and external refund sections', () => {
    const result = buildOperationReportText({
      computed: { report_date: '2026-07-18', sales_amount: 928.05, transaction_count: 51 },
      date: '2026-07-18',
      fields: [
        { id: 'report_date', kind: 'computed', label: '日期' },
        { id: 'sales_amount', kind: 'computed', label: '今日销售额' },
        { id: 'transaction_count', kind: 'computed', label: '全天交易次数（TC）' },
        { id: 'milk_remaining', kind: 'manual', label: '牛奶剩余', unit: '箱' },
      ],
      manualValues: { milk_remaining: '1.5' }, refundNote: '退款原因由员工选择或填写',
      refunds: [{
        orderTotalAmount: 26,
        platform: 'meituan',
        platformSequence: '21',
        productSummary: '无花果抹茶红豆酸奶碗 ×1',
        reason: '门店漏装、错装',
      }],
      title: '每日营运报告',
    });
    expect(result).toContain('日期：7月18日');
    expect(result).toContain('今日销售额：928.05');
    expect(result).toContain('牛奶剩余：1.5箱');
    expect(result).toContain('美团退单总数：1');
    expect(result).toContain('21号：无花果抹茶红豆酸奶碗 ×1\n订单总金额：26.00元\n退款原因：门店漏装、错装');
    expect(result).not.toContain('银豹网单号');
    expect(result).toContain('饿了么退单总数：无');
  });
});

describe('getMissingOperationReportFields', () => {
  it('uses the same text and photo requirements for copy and submit actions', () => {
    const fields = [
      { id: 'computed', kind: 'computed' as const, label: '销售额' },
      { id: 'milk', kind: 'manual' as const, label: '牛奶剩余', required: true, requiresPhoto: true },
      { id: 'waste', kind: 'manual' as const, label: '报废', required: true, requiresPhoto: true },
    ];
    expect(getMissingOperationReportFields(fields, { milk: '1.5', waste: '' }, ['milk']).map((field) => field.id)).toEqual(['waste']);
    expect(getMissingOperationReportFields(fields, { milk: '1.5', waste: '无' }, ['milk', 'waste'])).toEqual([]);
  });
});
