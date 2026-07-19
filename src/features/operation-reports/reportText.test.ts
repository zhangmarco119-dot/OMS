import { describe, expect, it } from 'vitest';
import { buildOperationReportText } from './reportText';

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
      manualValues: { milk_remaining: '1.5' }, refundNote: '极速退款无需填写原因',
      refunds: [{ orderNumber: '8', platform: 'meituan', reason: '未给蓝莓退款' }], title: '每日营运报告',
    });
    expect(result).toContain('日期：7月18日');
    expect(result).toContain('今日销售额：928.05');
    expect(result).toContain('牛奶剩余：1.5箱');
    expect(result).toContain('美团退单总数：1');
    expect(result).toContain('订单号：8 未给蓝莓退款');
    expect(result).toContain('饿了么退单总数：无');
  });
});
