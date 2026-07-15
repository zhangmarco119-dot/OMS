export interface DingTalkCredentials {
  appKey: string;
  appSecret: string;
  corpId: string;
}

export interface DingTalkEmployee {
  departmentIds: string[];
  displayName: string;
  dingtalkUserId: string;
  isActive: boolean;
  jobNumber: string | null;
  mobileMasked: string | null;
  unionId: string | null;
}

export interface DingTalkAttendanceBundle {
  punches: Record<string, unknown>[];
  results: Record<string, unknown>[];
  schedules: Record<string, unknown>[];
}

interface DingTalkClientOptions {
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  now?: () => number;
  oapiBaseUrl?: string;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  tokenUrl?: string;
}

interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();
const tokenErrorCodes = new Set(['40014', '42001', '88', 'InvalidAuthentication']);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const first = <T>(record: Record<string, unknown>, keys: string[], fallback: T): T => {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key] as T;
  return fallback;
};

const text = (value: unknown) => typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value);
const array = (value: unknown) => Array.isArray(value) ? value : [];

const maskMobile = (value: unknown) => {
  const mobile = text(value).replace(/\s/g, '');
  if (!mobile) return null;
  if (mobile.length < 7) return `${mobile.slice(0, 2)}***`;
  return `${mobile.slice(0, 3)}****${mobile.slice(-4)}`;
};

const formatDateTime = (date: string, end = false) => `${date} ${end ? '23:59:59' : '00:00:00'}`;

export const splitDateRange = (startDate: string, endDate: string, maxDays = 7) => {
  const result: Array<{ startDate: string; endDate: string }> = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const final = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(final.getTime()) || cursor > final) throw new Error('无效的考勤日期范围。');
  while (cursor <= final) {
    const rangeEnd = new Date(Math.min(final.getTime(), cursor.getTime() + (maxDays - 1) * 86_400_000));
    result.push({ startDate: cursor.toISOString().slice(0, 10), endDate: rangeEnd.toISOString().slice(0, 10) });
    cursor = new Date(rangeEnd.getTime() + 86_400_000);
  }
  return result;
};

export const chunk = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
};

export class DingTalkApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly retryable: boolean, public readonly status?: number) {
    super(message);
    this.name = 'DingTalkApiError';
  }
}

export class DingTalkClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly now: () => number;
  private readonly oapiBaseUrl: string;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly tokenUrl: string;

  constructor(private readonly credentials: DingTalkCredentials, options: DingTalkClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 3;
    this.now = options.now ?? Date.now;
    this.oapiBaseUrl = options.oapiBaseUrl ?? 'https://oapi.dingtalk.com';
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.tokenUrl = options.tokenUrl ?? 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
  }

  private tokenCacheKey() { return `${this.credentials.corpId}:${this.credentials.appKey}`; }

  async getAccessToken(forceRefresh = false) {
    const cacheKey = this.tokenCacheKey();
    const cached = tokenCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt - 120_000 > this.now()) return cached.accessToken;

    const response = await this.fetchWithRetry(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey: this.credentials.appKey, appSecret: this.credentials.appSecret }),
    }, false);
    const body = asRecord(await response.json());
    const accessToken = text(first(body, ['accessToken', 'access_token'], ''));
    if (!accessToken) throw new DingTalkApiError('钉钉访问凭证响应无效。', text(first(body, ['code', 'errcode'], 'TOKEN_RESPONSE_INVALID')), false, response.status);
    const expiresIn = Number(first(body, ['expireIn', 'expires_in'], 7200));
    tokenCache.set(cacheKey, { accessToken, expiresAt: this.now() + Math.max(300, expiresIn) * 1000 });
    return accessToken;
  }

  private async fetchWithRetry(url: string, init: RequestInit, parseDingTalkError = true): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
        if (response.status === 429 || response.status >= 500) {
          if (attempt < this.maxRetries) { await this.sleep(Math.min(4000, 250 * 2 ** attempt)); continue; }
          throw new DingTalkApiError('钉钉服务繁忙，请稍后重试。', `HTTP_${response.status}`, true, response.status);
        }
        if (!response.ok) throw new DingTalkApiError('钉钉接口请求失败。', `HTTP_${response.status}`, false, response.status);
        if (!parseDingTalkError) return response;
        const clone = response.clone();
        const body = asRecord(await clone.json());
        const errorCode = text(first(body, ['errcode', 'code'], '0'));
        const success = first(body, ['success'], true);
        if ((errorCode && errorCode !== '0' && errorCode !== 'OK') || success === false) {
          const retryable = tokenErrorCodes.has(errorCode) || ['429', '500', '503'].includes(errorCode);
          throw new DingTalkApiError(text(first(body, ['errmsg', 'message'], '钉钉接口返回错误。')), errorCode, retryable, response.status);
        }
        return response;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof DingTalkApiError ? error.retryable : error instanceof DOMException && error.name === 'AbortError';
        if (!retryable || attempt >= this.maxRetries) break;
        await this.sleep(Math.min(4000, 250 * 2 ** attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    if (lastError instanceof DingTalkApiError) throw lastError;
    if (lastError instanceof DOMException && lastError.name === 'AbortError') throw new DingTalkApiError('钉钉接口请求超时。', 'TIMEOUT', true);
    throw new DingTalkApiError('无法连接钉钉服务。', 'NETWORK_ERROR', true);
  }

  private async post(path: string, payload: Record<string, unknown>, retryToken = true): Promise<Record<string, unknown>> {
    const accessToken = await this.getAccessToken();
    try {
      const response = await this.fetchWithRetry(`${this.oapiBaseUrl}${path}?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      return asRecord(await response.json());
    } catch (error) {
      if (retryToken && error instanceof DingTalkApiError && tokenErrorCodes.has(error.code)) {
        await this.getAccessToken(true);
        return this.post(path, payload, false);
      }
      throw error;
    }
  }

  async listDepartmentIds(rootDepartmentIds = ['1']) {
    const visited = new Set<string>();
    const queue = [...rootDepartmentIds];
    while (queue.length) {
      const departmentId = queue.shift();
      if (!departmentId || visited.has(departmentId)) continue;
      visited.add(departmentId);
      const body = await this.post('/topapi/v2/department/listsubid', { dept_id: Number(departmentId) || departmentId });
      const result = asRecord(first(body, ['result'], {}));
      array(first(result, ['dept_id_list', 'deptIdList'], [])).forEach((id) => {
        const child = text(id);
        if (child && !visited.has(child)) queue.push(child);
      });
    }
    return [...visited];
  }

  async listEmployees(rootDepartmentIds = ['1']) {
    const employees = new Map<string, DingTalkEmployee>();
    for (const departmentId of await this.listDepartmentIds(rootDepartmentIds)) {
      let cursor = 0;
      let hasMore = true;
      while (hasMore) {
        const body = await this.post('/topapi/v2/user/list', { dept_id: Number(departmentId) || departmentId, cursor, size: 100 });
        const result = asRecord(first(body, ['result'], {}));
        for (const item of array(first(result, ['list'], []))) {
          const employee = asRecord(item);
          const userId = text(first(employee, ['userid', 'userId'], ''));
          if (!userId) continue;
          const existing = employees.get(userId);
          const departmentIds = array(first(employee, ['dept_id_list', 'deptIdList'], [departmentId])).map(text).filter(Boolean);
          employees.set(userId, {
            departmentIds: [...new Set([...(existing?.departmentIds ?? []), ...departmentIds])],
            displayName: text(first(employee, ['name'], '未命名员工')),
            dingtalkUserId: userId,
            isActive: first(employee, ['active'], true) !== false,
            jobNumber: text(first(employee, ['job_number', 'jobNumber'], '')) || null,
            mobileMasked: maskMobile(first(employee, ['mobile'], '')),
            unionId: text(first(employee, ['unionid', 'unionId'], '')) || null,
          });
        }
        hasMore = Boolean(first(result, ['has_more', 'hasMore'], false));
        cursor = Number(first(result, ['next_cursor', 'nextCursor'], cursor + 100));
      }
    }
    return [...employees.values()].sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'));
  }

  private async pagedAttendance(path: string, payload: Record<string, unknown>) {
    const records: Record<string, unknown>[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const body = await this.post(path, { ...payload, offset, limit: 50 });
      const result = first(body, ['recordresult', 'result'], body);
      const resultRecord = asRecord(result);
      const page = array(first(resultRecord, ['record', 'list', 'records'], first(body, ['recordresult'], []))).map(asRecord);
      records.push(...page);
      hasMore = Boolean(first(resultRecord, ['hasMore', 'has_more'], page.length === 50));
      offset += page.length;
      if (page.length === 0) hasMore = false;
    }
    return records;
  }

  async getAttendanceBundle(userIds: string[], startDate: string, endDate: string): Promise<DingTalkAttendanceBundle> {
    const bundle: DingTalkAttendanceBundle = { punches: [], results: [], schedules: [] };
    for (const dateRange of splitDateRange(startDate, endDate, 7)) {
      for (const users of chunk([...new Set(userIds)], 50)) {
        if (!users.length) continue;
        const common = { userIdList: users, workDateFrom: formatDateTime(dateRange.startDate), workDateTo: formatDateTime(dateRange.endDate, true), isI18n: false };
        bundle.results.push(...await this.pagedAttendance('/topapi/attendance/list', common));
        const punchBody = await this.post('/attendance/listRecord', { userIds: users, checkDateFrom: common.workDateFrom, checkDateTo: common.workDateTo, isI18n: false });
        bundle.punches.push(...array(first(punchBody, ['recordresult', 'result'], [])).map(asRecord));
        const scheduleBody = await this.post('/topapi/attendance/listschedule', { workDateFrom: common.workDateFrom, workDateTo: common.workDateTo, userIdList: users, offset: 0, size: 200 });
        const scheduleResult = asRecord(first(scheduleBody, ['result'], {}));
        bundle.schedules.push(...array(first(scheduleResult, ['schedules', 'list'], [])).map(asRecord));
      }
    }
    return bundle;
  }
}

export const resetDingTalkTokenCacheForTests = () => tokenCache.clear();
