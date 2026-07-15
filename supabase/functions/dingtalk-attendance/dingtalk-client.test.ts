import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chunk, DingTalkClient, resetDingTalkTokenCacheForTests, splitDateRange } from './dingtalk-client';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const credentials = { appKey: 'test-key', appSecret: 'test-secret', corpId: 'ding-test' };

describe('DingTalkClient', () => {
  beforeEach(() => resetDingTalkTokenCacheForTests());

  it('caches the access token without exposing credentials to callers', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ accessToken: 'token-1', expireIn: 7200 }));
    const client = new DingTalkClient(credentials, { fetchImpl, now: () => 1_000_000 });
    await expect(client.getAccessToken()).resolves.toBe('token-1');
    await expect(client.getAccessToken()).resolves.toBe('token-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries rate limits and paginates directory users', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ accessToken: 'token-1', expireIn: 7200 }))
      .mockResolvedValueOnce(response({ message: 'busy' }, 429))
      .mockResolvedValueOnce(response({ errcode: 0, result: { dept_id_list: [] } }))
      .mockResolvedValueOnce(response({ errcode: 0, result: { list: [{ userid: 'u1', name: '员工甲', dept_id_list: [1] }], has_more: true, next_cursor: 1 } }))
      .mockResolvedValueOnce(response({ errcode: 0, result: { list: [{ userid: 'u2', name: '员工乙', dept_id_list: [1] }], has_more: false, next_cursor: 2 } }));
    const client = new DingTalkClient(credentials, { fetchImpl, maxRetries: 1, sleep: async () => undefined });
    await expect(client.listEmployees()).resolves.toMatchObject([
      { dingtalkUserId: 'u1', displayName: '员工甲' },
      { dingtalkUserId: 'u2', displayName: '员工乙' },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('refreshes an invalid token once and continues the request', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ accessToken: 'expired-token', expireIn: 7200 }))
      .mockResolvedValueOnce(response({ errcode: 40014, errmsg: 'invalid token' }))
      .mockResolvedValueOnce(response({ accessToken: 'new-token', expireIn: 7200 }))
      .mockResolvedValueOnce(response({ errcode: 0, result: { dept_id_list: [] } }));
    const client = new DingTalkClient(credentials, { fetchImpl, maxRetries: 0 });
    await expect(client.listDepartmentIds()).resolves.toEqual(['1']);
    expect(fetchImpl.mock.calls[3]?.[0]).toContain('new-token');
  });

  it('returns an empty directory safely and reports request timeouts', async () => {
    const emptyFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ accessToken: 'token-empty', expireIn: 7200 }))
      .mockResolvedValueOnce(response({ errcode: 0, result: { dept_id_list: [] } }))
      .mockResolvedValueOnce(response({ errcode: 0, result: { list: [], has_more: false } }));
    await expect(new DingTalkClient({ ...credentials, corpId: 'empty' }, { fetchImpl: emptyFetch }).listEmployees()).resolves.toEqual([]);

    const timeoutFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ accessToken: 'token-timeout', expireIn: 7200 }))
      .mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const client = new DingTalkClient({ ...credentials, corpId: 'timeout' }, { fetchImpl: timeoutFetch, maxRetries: 0, timeoutMs: 1 });
    await expect(client.listDepartmentIds()).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
  });

  it('uses the current attendance endpoints and official request fields', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ accessToken: 'token-attendance', expireIn: 7200 }))
      .mockResolvedValueOnce(response({ errcode: 0, recordresult: [{ id: 'result-1', userid: 'u1' }], hasMore: false }))
      .mockResolvedValueOnce(response({ errcode: 0, recordresult: [{ id: 'punch-1', userid: 'u1' }] }));
    const client = new DingTalkClient({ ...credentials, corpId: 'attendance' }, { fetchImpl });

    await expect(client.getAttendanceBundle(['u1'], '2026-07-01', '2026-07-01')).resolves.toMatchObject({
      results: [{ id: 'result-1' }],
      punches: [{ id: 'punch-1' }],
      schedules: [],
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('/attendance/list?access_token=');
    expect(fetchImpl.mock.calls[1]?.[0]).not.toContain('/topapi/attendance/list');
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toMatchObject({
      userIdList: ['u1'],
      workDateFrom: '2026-07-01 00:00:00',
      workDateTo: '2026-07-01 23:59:59',
      offset: 0,
      limit: 50,
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body))).toMatchObject({
      userIds: ['u1'],
      checkDateFrom: '2026-07-01 00:00:00',
      checkDateTo: '2026-07-01 23:59:59',
    });
  });

  it('loads and annotates each day of organization schedules', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ accessToken: 'token-schedule', expireIn: 7200 }))
      .mockResolvedValueOnce(response({ errcode: 0, result: { schedules: [{ userid: 'u1', check_type: 'OnDuty', plan_check_time: '2026-07-01 09:00:00' }], has_more: false } }))
      .mockResolvedValueOnce(response({ errcode: 0, result: { schedules: [], has_more: false } }));
    const client = new DingTalkClient({ ...credentials, corpId: 'schedule' }, { fetchImpl });

    await expect(client.listSchedules('2026-07-01', '2026-07-02')).resolves.toEqual([
      expect.objectContaining({ userid: 'u1', workDate: '2026-07-01' }),
    ]);
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('/topapi/attendance/listschedule?access_token=');
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      workDate: '2026-07-01 00:00:00',
      offset: 0,
      size: 200,
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body))).toMatchObject({ workDate: '2026-07-02 00:00:00' });
  });
});

describe('DingTalk batching helpers', () => {
  it('splits long ranges into inclusive seven-day windows', () => {
    expect(splitDateRange('2026-07-01', '2026-07-16')).toEqual([
      { startDate: '2026-07-01', endDate: '2026-07-07' },
      { startDate: '2026-07-08', endDate: '2026-07-14' },
      { startDate: '2026-07-15', endDate: '2026-07-16' },
    ]);
    expect(chunk(Array.from({ length: 101 }, (_, index) => index), 50).map((part) => part.length)).toEqual([50, 50, 1]);
  });
});
