import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.51.0';
import { parseQmaiSecretConfigs, QmaiClient, type QmaiSecretConfig } from './qmai-client.ts';

type SalesAction =
  | { action: 'list-stores' }
  | { action: 'manual-sync'; date?: string; integrationId: string }
  | { action: 'manual-sync-month'; endDate?: string; integrationId: string }
  | { action: 'scheduled-sync' };
type IntegrationRow = { enabled: boolean; external_account: string; external_credential_id: string | null; id: string; store_id: string; sync_end_hour: number; sync_interval_minutes: number; sync_start_hour: number };
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-storehub-contract, x-storehub-cron-secret, x-storehub-release',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
const requiredEnv = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Missing ${name}`); return value; };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const chinaDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const chinaMinute = () => { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()); return Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value ?? 0); };
const datesInRange = (start: string, end: string) => { const dates: string[] = []; for (let cursor = new Date(`${start}T00:00:00Z`); cursor <= new Date(`${end}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(cursor.toISOString().slice(0, 10)); return dates; };
const safeError = (error: unknown) => error instanceof Error ? error.message.slice(0, 500) : '企迈营业额同步失败。';

async function authenticatedAdmin(request: Request, adminClient: ReturnType<typeof createClient>, supabaseUrl: string, anonKey: string) {
  const authorization = request.headers.get('Authorization'); if (!authorization) throw new Error('请先登录。');
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const user = await userClient.auth.getUser(); if (user.error || !user.data.user) throw new Error('登录状态已失效，请重新登录。');
  const profile = await adminClient.from('profiles').select('id,role,store_id,is_active,deleted_at').eq('id', user.data.user.id).single();
  if (profile.error || profile.data?.role !== 'admin' || !profile.data.is_active || profile.data.deleted_at) throw new Error('当前账号没有营业收入管理权限。');
  const access = await adminClient.from('profile_store_access').select('store_id').eq('profile_id', profile.data.id);
  return { id: profile.data.id, stores: new Set([profile.data.store_id, ...(access.data ?? []).map((item) => item.store_id)]) };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let payload: SalesAction; try { payload = await request.json() as SalesAction; } catch { return json({ error: '请求内容格式不正确。' }, 400); }
  const supabaseUrl = requiredEnv('SUPABASE_URL'); const anonKey = requiredEnv('SUPABASE_ANON_KEY'); const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  let configs: QmaiSecretConfig[]; try { configs = parseQmaiSecretConfigs(requiredEnv('QMAI_INTEGRATIONS_BASE64')); } catch { return json({ error: '企迈服务尚未完成安全配置。' }, 503); }
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  if (payload.action === 'list-stores') {
    try {
      await authenticatedAdmin(request, adminClient, supabaseUrl, anonKey);
      const stores = (await Promise.all(configs.map(async (config) => (await new QmaiClient(config).listStores()).map((store) => ({ ...store, credentialId: config.credentialId }))))).flat();
      return json({ stores });
    } catch (error) { return json({ error: safeError(error) }, 403); }
  }
  const scheduled = payload.action === 'scheduled-sync'; let actorId: string | null = null; let integrations: IntegrationRow[] = [];
  if (scheduled) {
    const token = request.headers.get('x-storehub-cron-secret') ?? ''; const verified = token ? await adminClient.rpc('verify_qmai_sales_cron_token', { p_token: token }) : { data: false };
    if (verified.data !== true) return json({ error: 'Scheduled sync authentication failed' }, 401);
    const due = await adminClient.from('pos_sales_integrations').select('*').eq('provider', 'qmai').eq('enabled', true).lte('next_sync_at', new Date().toISOString());
    if (due.error) return json({ error: '无法读取企迈同步配置。' }, 500);
    const minute = chinaMinute(); integrations = (due.data ?? []).filter((item) => minute >= item.sync_start_hour * 60 && minute <= item.sync_end_hour * 60) as IntegrationRow[];
  } else if (payload.action === 'manual-sync' || payload.action === 'manual-sync-month') {
    if (!uuidPattern.test(payload.integrationId)) return json({ error: '企迈连接编号无效。' }, 400);
    try {
      const admin = await authenticatedAdmin(request, adminClient, supabaseUrl, anonKey); actorId = admin.id;
      const integration = await adminClient.from('pos_sales_integrations').select('*').eq('id', payload.integrationId).eq('provider', 'qmai').single();
      if (integration.error || !integration.data || !admin.stores.has(integration.data.store_id)) return json({ error: '当前管理员无权同步该门店。' }, 403);
      integrations = [integration.data as IntegrationRow];
    } catch (error) { return json({ error: safeError(error) }, 403); }
  } else return json({ error: '未知的企迈营业收入操作。' }, 400);
  if (!integrations.length) return json({ status: 'skipped', message: '当前没有到达同步时间的企迈门店。', results: [] });
  const endDate = payload.action === 'manual-sync' ? payload.date ?? chinaDate() : payload.action === 'manual-sync-month' ? payload.endDate ?? chinaDate() : chinaDate();
  if (!datePattern.test(endDate) || endDate > chinaDate()) return json({ error: '同步日期格式不正确或晚于今天。' }, 400);
  const startDate = payload.action === 'manual-sync-month' ? `${endDate.slice(0, 7)}-01` : endDate;
  const results: Record<string, unknown>[] = [];
  for (const integration of integrations) {
    const job = await adminClient.from('pos_sales_sync_jobs').insert({ integration_id: integration.id, store_id: integration.store_id, provider: 'qmai', trigger_type: scheduled ? 'scheduled' : 'manual', sync_date: startDate, sync_end_date: endDate, initiated_by: actorId, status: 'running' }).select('id').single();
    if (job.error || !job.data) { results.push({ integrationId: integration.id, status: 'failed', error: '无法创建营业收入同步任务。' }); continue; }
    let calls = 0;
    try {
      const config = configs.find((item) => item.credentialId === integration.external_credential_id); if (!config) throw new Error('当前门店尚未配置企迈安全凭据。');
      const client = new QmaiClient(config); const revenue = await client.queryDailyRevenue(integration.external_account, startDate, endDate); calls = client.calls;
      const byDate = new Map(revenue.map((item) => [item.date, item.amount]));
      const tickets = datesInRange(startDate, endDate).map((date) => ({ externalKey: `qmai:${integration.external_account}:${date}`, occurredAt: `${date}T23:59:59+08:00`, ticketType: 'SELL', invalid: false, totalAmount: byDate.get(date) ?? 0, orderSource: 'qmai_business_summary' }));
      const replaced = await adminClient.rpc('replace_qmai_sales_range', { p_integration_id: integration.id, p_sync_job_id: job.data.id, p_start_date: startDate, p_end_date: endDate, p_tickets: tickets, p_api_call_count: calls });
      if (replaced.error) throw new Error(replaced.error.message);
      if (scheduled) await adminClient.from('pos_sales_integrations').update({ next_sync_at: new Date(Date.now() + integration.sync_interval_minutes * 60_000).toISOString() }).eq('id', integration.id);
      results.push({ integrationId: integration.id, jobId: job.data.id, status: 'succeeded', ...(replaced.data && typeof replaced.data === 'object' ? replaced.data as Record<string, unknown> : {}) });
    } catch (error) {
      const message = safeError(error);
      await adminClient.from('pos_sales_sync_jobs').update({ status: 'failed', api_call_count: calls, error_message: message, finished_at: new Date().toISOString() }).eq('id', job.data.id);
      await adminClient.from('pos_sales_integrations').update({ last_sync_at: new Date().toISOString(), last_error: message, next_sync_at: scheduled ? new Date(Date.now() + integration.sync_interval_minutes * 60_000).toISOString() : undefined }).eq('id', integration.id);
      results.push({ integrationId: integration.id, jobId: job.data.id, status: 'failed', error: message });
    }
  }
  const failed = results.filter((result) => result.status === 'failed');
  return !scheduled && failed.length ? json({ status: 'failed', error: failed[0].error, results }) : json({ status: failed.length ? 'partial' : 'succeeded', results });
});
