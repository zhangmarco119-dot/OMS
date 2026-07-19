import md5 from 'npm:blueimp-md5@2.19.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.51.0';

import {
  buildPospalTicketRequest,
  normalizePospalTickets,
  parsePospalSecretConfigs,
  type NormalizedPospalTicket,
  type PospalSecretConfig,
} from './pospal-client.ts';

type SalesAction =
  | { action: 'manual-sync'; date?: string; integrationId: string }
  | { action: 'manual-sync-month'; endDate?: string; integrationId: string }
  | { action: 'report-sync'; date: string; storeId: string }
  | { action: 'scheduled-sync' };

type IntegrationRow = {
  configured_by: string;
  enabled: boolean;
  id: string;
  next_sync_at: string | null;
  provider: 'pospal' | 'qmai';
  store_id: string;
  sync_end_hour: number;
  sync_interval_minutes: number;
  sync_start_hour: number;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-storehub-contract, x-storehub-cron-secret, x-storehub-release',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const requiredEnv = (key: string) => {
  const value = Deno.env.get(key)?.trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value;
};

const datePattern = /^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const chinaDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const chinaMinute = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
};

const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|403|signature|credential|app.?id|app.?key|unauthorized/i.test(message)) {
    return '银豹接口认证失败，请检查开放平台凭据和门店授权。';
  }
  if (/timeout|network|fetch|abort|502|503|504/i.test(message)) {
    return '银豹服务暂时无法连接，请稍后重试。';
  }
  if (/limit|frequency|too many|访问量|次数/i.test(message)) {
    return '银豹接口调用次数已受限，请稍后重试或联系银豹提升额度。';
  }
  return message.slice(0, 240) || '银豹营业收入同步失败。';
};

class PospalClient {
  calls = 0;

  constructor(private readonly config: PospalSecretConfig) {}

  async queryDay(date: string) {
    const endpoint =
      `${this.config.host}/pospal-api2/openapi/v1/ticketOpenApi/queryTicketPages`;
    const tickets: NormalizedPospalTicket[] = [];
    let postBackParameter: unknown;
    let previousCursor = '';

    for (let page = 0; page < 10; page += 1) {
      const body = buildPospalTicketRequest(this.config.appId, date, postBackParameter);
      const signature = md5(this.config.appKey + body).toUpperCase();
      this.calls += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);
      let response: Response;

      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'User-Agent': 'openApi',
            'time-stamp': Date.now().toString(),
            'data-signature': signature,
          },
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok || payload.status !== 'success') {
        const messages = Array.isArray(payload.messages) ? payload.messages.join('；') : '';
        throw new Error(messages || `银豹接口返回 HTTP ${response.status}`);
      }

      const data =
        payload.data && typeof payload.data === 'object'
          ? (payload.data as Record<string, unknown>)
          : {};
      const rows = Array.isArray(data.result) ? data.result : [];
      tickets.push(...normalizePospalTickets(rows));
      const pageSize = Number(data.pageSize) || 100;
      postBackParameter = data.postBackParameter;
      const cursor = JSON.stringify(postBackParameter ?? null);

      if (rows.length < pageSize || !postBackParameter || cursor === previousCursor) break;
      previousCursor = cursor;
      if (page === 9) {
        throw new Error('银豹单日单据超过安全分页上限，请联系管理员分段同步。');
      }
    }

    return [...new Map(tickets.map((ticket) => [ticket.externalKey, ticket])).values()];
  }

  async queryDays(dates: string[]) {
    const tickets: NormalizedPospalTicket[] = [];
    for (let offset = 0; offset < dates.length; offset += 3) {
      const batch = await Promise.all(dates.slice(offset, offset + 3).map((date) => this.queryDay(date)));
      tickets.push(...batch.flat());
    }
    return [...new Map(tickets.map((ticket) => [ticket.externalKey, ticket])).values()];
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const anonKey = requiredEnv('SUPABASE_ANON_KEY');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

  let configs: PospalSecretConfig[];
  try {
    configs = parsePospalSecretConfigs(requiredEnv('POSPAL_INTEGRATIONS_BASE64'));
  } catch {
    return json({ error: '银豹服务尚未完成安全配置。' }, 503);
  }

  let payload: SalesAction;
  try {
    payload = (await request.json()) as SalesAction;
  } catch {
    return json({ error: '请求内容格式不正确。' }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const scheduled = payload.action === 'scheduled-sync';
  let actorId: string | null = null;
  let integrationRows: IntegrationRow[] = [];

  if (scheduled) {
    const token = request.headers.get('x-storehub-cron-secret') ?? '';
    const verified = token
      ? await adminClient.rpc('verify_pos_sales_cron_token', { p_token: token })
      : { data: false, error: null };
    if (verified.error || verified.data !== true) {
      return json({ error: 'Scheduled sync authentication failed' }, 401);
    }

    const due = await adminClient
      .from('pos_sales_integrations')
      .select('*')
      .eq('provider', 'pospal')
      .eq('enabled', true)
      .lte('next_sync_at', new Date().toISOString());
    if (due.error) return json({ error: '无法读取银豹同步配置。' }, 500);

    const minute = chinaMinute();
    integrationRows = (due.data ?? []).filter(
      (item) =>
        minute >= item.sync_start_hour * 60 && minute <= item.sync_end_hour * 60,
    ) as IntegrationRow[];
  } else if (payload.action === 'manual-sync' || payload.action === 'manual-sync-month' || payload.action === 'report-sync') {
    const requestedIntegrationId = payload.action === 'report-sync' ? null : payload.integrationId;
    if ((requestedIntegrationId && !uuidPattern.test(requestedIntegrationId)) || (payload.action === 'report-sync' && !uuidPattern.test(payload.storeId))) {
      return json({ error: '收银系统连接编号无效。' }, 400);
    }

    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: '请先登录。' }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const user = await userClient.auth.getUser();
    if (user.error || !user.data.user) {
      return json({ error: '登录状态已失效，请重新登录。' }, 401);
    }

    const profile = await adminClient
      .from('profiles')
      .select('id,role,store_id,is_active,deleted_at')
      .eq('id', user.data.user.id)
      .single();
    if (
      profile.error ||
      (payload.action !== 'report-sync' && profile.data?.role !== 'admin') ||
      !profile.data.is_active ||
      profile.data.deleted_at
    ) {
      return json({ error: '当前账号没有营业收入管理权限。' }, 403);
    }

    actorId = profile.data.id;
    const access = await adminClient
      .from('profile_store_access')
      .select('store_id')
      .eq('profile_id', actorId);
    const allowed = new Set([
      profile.data.store_id,
      ...(access.data ?? []).map((item) => item.store_id),
    ]);
    const integration = await adminClient
      .from('pos_sales_integrations')
      .select('*')
      .eq(payload.action === 'report-sync' ? 'store_id' : 'id', payload.action === 'report-sync' ? payload.storeId : payload.integrationId)
      .eq('provider', 'pospal')
      .single();
    if (integration.error || !integration.data || !allowed.has(integration.data.store_id)) {
      return json({ error: '当前管理员无权同步该门店。' }, 403);
    }
    integrationRows = [integration.data as IntegrationRow];
  } else {
    return json({ error: '未知的营业收入同步操作。' }, 400);
  }

  if (!integrationRows.length) {
    return json({ status: 'skipped', message: '当前没有到达同步时间的银豹门店。', results: [] });
  }

  const requestedEndDate = payload.action === 'manual-sync'
    ? payload.date ?? chinaDate()
    : payload.action === 'report-sync'
      ? payload.date
    : payload.action === 'manual-sync-month'
      ? payload.endDate ?? chinaDate()
      : chinaDate();
  if (!datePattern.test(requestedEndDate) || requestedEndDate > chinaDate()) {
    return json({ error: '同步日期格式不正确或晚于今天。' }, 400);
  }
  const requestedStartDate = payload.action === 'manual-sync-month'
    ? `${requestedEndDate.slice(0, 7)}-01`
    : requestedEndDate;

  const results: Record<string, unknown>[] = [];
  for (const integration of integrationRows) {
    const config = configs.find((item) => item.storeId === integration.store_id);
    const job = await adminClient
      .from('pos_sales_sync_jobs')
      .insert({
        integration_id: integration.id,
        store_id: integration.store_id,
        provider: 'pospal',
        trigger_type: scheduled ? 'scheduled' : 'manual',
        sync_date: requestedStartDate,
        sync_end_date: requestedEndDate,
        initiated_by: actorId,
        status: 'running',
      })
      .select('id')
      .single();

    if (job.error || !job.data) {
      results.push({
        integrationId: integration.id,
        status: 'failed',
        error: '无法创建营业收入同步任务。',
      });
      continue;
    }

    let calls = 0;
    let client: PospalClient | null = null;
    try {
      if (!config) throw new Error('当前门店尚未配置银豹安全凭据。');
      client = new PospalClient(config);
      const dates: string[] = [];
      for (let cursor = new Date(`${requestedStartDate}T00:00:00Z`); cursor <= new Date(`${requestedEndDate}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        dates.push(cursor.toISOString().slice(0, 10));
      }
      const tickets = dates.length === 1 ? await client.queryDay(dates[0]) : await client.queryDays(dates);
      calls = client.calls;
      const replaced = requestedStartDate === requestedEndDate
        ? await adminClient.rpc('replace_pos_sales_day', {
            p_integration_id: integration.id,
            p_sync_job_id: job.data.id,
            p_sync_date: requestedEndDate,
            p_tickets: tickets,
            p_api_call_count: calls,
          })
        : await adminClient.rpc('replace_pos_sales_range', {
            p_integration_id: integration.id,
            p_sync_job_id: job.data.id,
            p_start_date: requestedStartDate,
            p_end_date: requestedEndDate,
            p_tickets: tickets,
            p_api_call_count: calls,
          });
      if (replaced.error) throw new Error(replaced.error.message);
      const result =
        replaced.data && typeof replaced.data === 'object'
          ? (replaced.data as Record<string, unknown>)
          : {};
      const enriched = tickets.map((ticket) => ({
        integration_id: integration.id, store_id: integration.store_id, sync_job_id: job.data.id,
        revenue_date: ticket.occurredAt.slice(0, 10), external_key: ticket.externalKey,
        external_sn: ticket.externalSn || null, occurred_at: ticket.occurredAt,
        source_updated_at: ticket.sourceUpdatedAt || null, ticket_type: ticket.ticketType,
        invalid: ticket.invalid, total_amount: ticket.totalAmount, order_source: ticket.orderSource || null,
        web_order_no: ticket.webOrderNo || null, external_order_no: ticket.externalOrderNo || null,
        order_no: ticket.orderNo || null, remark: ticket.remark || null,
        sell_ticket_uid: ticket.sellTicketUid || null,
      }));
      if (enriched.length) {
        const enrichment = await adminClient.from('pos_sales_tickets').upsert(enriched, { onConflict: 'integration_id,external_key' });
        if (enrichment.error) throw new Error(enrichment.error.message);
      }
      results.push({ integrationId: integration.id, jobId: job.data.id, status: 'succeeded', ...result });
    } catch (error) {
      calls = client?.calls ?? calls;
      const message = safeError(error);
      await adminClient
        .from('pos_sales_sync_jobs')
        .update({
          status: 'failed',
          api_call_count: calls,
          error_message: message,
          finished_at: new Date().toISOString(),
        })
        .eq('id', job.data.id);
      await adminClient
        .from('pos_sales_integrations')
        .update({
          last_sync_at: new Date().toISOString(),
          last_error: message,
          next_sync_at: scheduled
            ? new Date(
                Date.now() + integration.sync_interval_minutes * 60_000,
              ).toISOString()
            : integration.next_sync_at,
        })
        .eq('id', integration.id);
      results.push({ integrationId: integration.id, jobId: job.data.id, status: 'failed', error: message });
    }
  }

  const failed = results.filter((result) => result.status === 'failed');
  if (!scheduled && failed.length) {
    return json({ status: 'failed', error: failed[0].error, results });
  }
  return json({ status: failed.length ? 'partial' : 'succeeded', results });
});
