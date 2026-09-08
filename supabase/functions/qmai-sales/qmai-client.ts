export interface QmaiSecretConfig {
  credentialId: string;
  grantCode: string;
  openId: string;
  openKey: string;
}

export interface QmaiStore {
  address: string;
  id: string;
  name: string;
  shopCode: string;
}

export interface QmaiDailyRevenue {
  amount: number;
  date: string;
}

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): UnknownRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
const number = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export const parseQmaiSecretConfigs = (encoded: string): QmaiSecretConfig[] => {
  const decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));
  const value = JSON.parse(decoded) as unknown;
  if (!Array.isArray(value)) throw new Error('QMAI_INTEGRATIONS_BASE64 must contain an array');
  const ids = new Set<string>();
  return value.map((entry) => {
    const item = record(entry);
    const config = { credentialId: text(item.credentialId), grantCode: text(item.grantCode), openId: text(item.openId), openKey: text(item.openKey) };
    if (!config.credentialId || !config.grantCode || !config.openId || !config.openKey || ids.has(config.credentialId)) throw new Error('Invalid Qmai integration secret configuration');
    ids.add(config.credentialId);
    return config;
  });
};

const sign = async (config: QmaiSecretConfig, nonce: number, timestamp: number) => {
  const payload = `grantCode=${config.grantCode}&nonce=${nonce}&openId=${config.openId}&timestamp=${timestamp}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.openKey), { hash: 'SHA-1', name: 'HMAC' }, false, ['sign']);
  return encodeURIComponent(base64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))));
};

export class QmaiClient {
  calls = 0;
  constructor(private readonly config: QmaiSecretConfig) {}

  async call(path: string, params: UnknownRecord) {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.getRandomValues(new Uint32Array(1))[0] % 99999 + 1;
    const body = { openId: this.config.openId, grantCode: this.config.grantCode, nonce, timestamp, token: await sign(this.config, nonce, timestamp), params };
    this.calls += 1;
    const response = await fetch(`https://openapi.qmai.cn/${path.replace(/^\/+/, '')}`, { headers: { 'Content-Type': 'application/json', 'X-Client-Name': 'storehub' }, method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const payload = await response.json().catch(() => ({})) as UnknownRecord;
    if (!response.ok || payload.status !== true || number(payload.code) !== 0) throw new Error(text(payload.message) || `企迈接口请求失败（HTTP ${response.status}）`);
    return payload.data;
  }

  async listStores(): Promise<QmaiStore[]> {
    const result = record(await this.call('v3/org/shop/getShopList', { pageNum: 1, pageSize: 200 }));
    return (Array.isArray(result.list) ? result.list : []).flatMap((value) => {
      const shop = record(value); const shopCode = text(shop.code); const name = text(shop.name);
      return shopCode && name ? [{ id: text(shop.id), shopCode, name, address: text(shop.fullAddress || shop.address) }] : [];
    });
  }

  async queryDailyRevenue(shopCode: string, startDate: string, endDate: string): Promise<QmaiDailyRevenue[]> {
    const result = record(await this.call('v3/dataone/finance/summary/businessRecord', { shopCode, start_date: startDate, end_date: endDate, pageNo: 1, pageSize: 100 }));
    const totals = new Map<string, number>();
    for (const value of Array.isArray(result.resultList) ? result.resultList : []) {
      const item = record(value); const date = text(item.recordTime || item.processDate).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) totals.set(date, number(item.businessAmt));
    }
    return [...totals.entries()].map(([date, amount]) => ({ date, amount }));
  }
}
