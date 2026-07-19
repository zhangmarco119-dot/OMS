export interface PospalSecretConfig {
  appId: string;
  appKey: string;
  host: string;
  storeId: string;
}

export interface NormalizedPospalTicket {
  externalOrderNo: string;
  externalKey: string;
  externalSn: string;
  invalid: boolean;
  occurredAt: string;
  orderNo: string;
  orderSource: string;
  remark: string;
  sellTicketUid: string;
  sourceUpdatedAt: string;
  ticketType: 'SELL' | 'SELL_RETURN';
  totalAmount: number;
  webOrderNo: string;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
const number = (value: unknown) => {
  const result = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(result) ? result : 0;
};

export const chinaDateTimeToIso = (value: unknown) => {
  const source = text(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(source)) return `${source.replace(' ', 'T')}+08:00`;
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
};

export const buildPospalTicketRequest = (appId: string, date: string, postBackParameter?: unknown) => JSON.stringify({
  appId,
  startTime: `${date} 00:00:00`,
  endTime: `${date} 23:59:59`,
  ...(postBackParameter ? { postBackParameter } : {}),
});

export const normalizePospalTickets = (values: unknown[]): NormalizedPospalTicket[] => values.flatMap((value, index) => {
  const item = record(value);
  const externalSn = text(item.sn);
  const occurredAt = chinaDateTimeToIso(item.datetime);
  const sourceUpdatedAt = chinaDateTimeToIso(item.sysUpdateTime);
  const rawUid = text(item.uid);
  const externalKey = externalSn || rawUid || `${occurredAt}:${number(item.totalAmount)}:${index}`;
  if (!occurredAt || !externalKey) return [];
  return [{
    externalOrderNo: text(item.externalOrderNo),
    externalKey,
    externalSn,
    invalid: item.invalid === true || number(item.invalid) === 1,
    occurredAt,
    orderNo: text(item.orderNo),
    orderSource: text(item.orderSource),
    remark: text(item.remark),
    sellTicketUid: text(item.sellTicketUid),
    sourceUpdatedAt,
    ticketType: text(item.ticketType).toUpperCase() === 'SELL_RETURN' ? 'SELL_RETURN' : 'SELL',
    totalAmount: number(item.totalAmount),
    webOrderNo: text(item.webOrderNo),
  }];
});

export const parsePospalSecretConfigs = (encoded: string): PospalSecretConfig[] => {
  const decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));
  const value = JSON.parse(decoded) as unknown;
  if (!Array.isArray(value)) throw new Error('POSPAL_INTEGRATIONS_BASE64 must contain an array');
  return value.map((entry) => {
    const item = record(entry);
    const config = {
      appId: text(item.appId),
      appKey: text(item.appKey),
      host: text(item.host).replace(/\/+$/, ''),
      storeId: text(item.storeId),
    };
    const host = new URL(config.host);
    if (!config.appId || !config.appKey || !config.storeId || host.protocol !== 'https:' || !(host.hostname === 'pospal.cn' || host.hostname.endsWith('.pospal.cn'))) {
      throw new Error('Invalid Pospal integration secret configuration');
    }
    return config;
  });
};

export const pospalRevenue = (tickets: NormalizedPospalTicket[]) => tickets.reduce((total, ticket) => {
  if (ticket.invalid) return total;
  return total + (ticket.ticketType === 'SELL_RETURN' ? -Math.abs(ticket.totalAmount) : ticket.totalAmount);
}, 0);
