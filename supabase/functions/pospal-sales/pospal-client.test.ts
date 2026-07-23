import { describe, expect, it } from 'vitest';

import {
  buildPospalOrderDetailRequest,
  buildPospalTicketRequest,
  chinaDateTimeToIso,
  normalizePospalOrderDetail,
  normalizePospalTickets,
  pospalRevenue,
} from './pospal-client';

describe('Pospal sales normalization', () => {
  it('builds an exact one-day request and preserves the pagination cursor', () => {
    expect(JSON.parse(buildPospalTicketRequest('app', '2026-07-17', { parameterType: 'LAST_RESULT_MAX_ID', parameterValue: '12' }))).toEqual({
      appId: 'app',
      startTime: '2026-07-17 00:00:00',
      endTime: '2026-07-17 23:59:59',
      postBackParameter: { parameterType: 'LAST_RESULT_MAX_ID', parameterValue: '12' },
    });
  });

  it('normalizes China timestamps and subtracts valid returns while ignoring invalid tickets', () => {
    const tickets = normalizePospalTickets([
      { sn: 'sell-1', datetime: '2026-07-17 10:00:00', totalAmount: 80, ticketType: 'SELL', invalid: 0 },
      { sn: 'return-1', datetime: '2026-07-17 11:00:00', totalAmount: 20, ticketType: 'SELL_RETURN', invalid: 0 },
      { sn: 'invalid-1', datetime: '2026-07-17 12:00:00', totalAmount: 100, ticketType: 'SELL', invalid: 1 },
    ]);
    expect(tickets[0].occurredAt).toBe('2026-07-17T10:00:00+08:00');
    expect(pospalRevenue(tickets)).toBe(60);
  });

  it('rejects unusable dates instead of creating misleading records', () => {
    expect(chinaDateTimeToIso('not-a-date')).toBe('');
    expect(normalizePospalTickets([{ sn: 'bad', datetime: 'not-a-date', totalAmount: 10 }])).toEqual([]);
  });

  it('preserves external-order identifiers and refund remarks for operation reports', () => {
    const [ticket] = normalizePospalTickets([{
      datetime: '2026-07-18 18:00:00',
      externalOrderNo: 'EXT-8',
      items: [{ name: '蓝莓酸奶碗', quantity: 1 }],
      orderNo: '8',
      orderSource: '美团外卖',
      remark: '漏送蓝莓',
      sellTicketUid: 'sale-1',
      sn: 'R-1',
      ticketOnTable: { tableCardNo: 'M008' },
      ticketType: 'SELL_RETURN',
      totalAmount: 28,
      webOrderNo: 'MT-8',
    }]);
    expect(ticket).toMatchObject({
      externalOrderNo: 'EXT-8',
      itemSummary: '蓝莓酸奶碗 ×1',
      orderNo: '8',
      orderSource: '美团外卖',
      orderTotalAmount: 28,
      platformSequence: '8',
      remark: '漏送蓝莓',
      sellTicketUid: 'sale-1',
      webOrderNo: 'MT-8',
    });
  });

  it('normalizes online-order details into platform sequence, products and total', () => {
    expect(JSON.parse(buildPospalOrderDetailRequest('app', '26072318154976451634'))).toEqual({
      appId: 'app',
      orderNo: '26072318154976451634',
    });
    expect(normalizePospalOrderDetail({
      daySeq: 'E045',
      items: [
        { productName: '酸奶碗', productQuantity: 1 },
        { productName: '奶酪小方', productQuantity: 2 },
      ],
      orderNo: '26072318585962661951',
      totalAmount: 19.4,
    })).toEqual({
      itemSummary: '酸奶碗 ×1；奶酪小方 ×2',
      orderNo: '26072318585962661951',
      orderTotalAmount: 19.4,
      platformSequence: '45',
    });
  });
});
