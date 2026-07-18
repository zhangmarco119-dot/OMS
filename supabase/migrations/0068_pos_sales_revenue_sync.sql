-- POS sales integration foundation. Credentials remain in Edge Function
-- secrets; the database stores only store mappings, schedules and normalized
-- financial records.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.pos_sales_integrations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores(id) on delete cascade,
  provider text not null check (provider in ('pospal', 'qmai')),
  display_name text not null,
  external_account text not null default '',
  enabled boolean not null default false,
  sync_start_hour smallint not null default 10 check (sync_start_hour between 0 and 23),
  sync_end_hour smallint not null default 22 check (sync_end_hour between 0 and 23),
  sync_interval_minutes integer not null default 30 check (sync_interval_minutes in (15, 30, 60, 120)),
  next_sync_at timestamptz,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  configured_by uuid not null references public.profiles(id),
  configured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sync_end_hour >= sync_start_hour)
);

create trigger pos_sales_integrations_touch_updated_at
before update on public.pos_sales_integrations
for each row execute function public.touch_updated_at();

create table public.pos_sales_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.pos_sales_integrations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null check (provider in ('pospal', 'qmai')),
  trigger_type text not null check (trigger_type in ('manual', 'scheduled')),
  sync_date date not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  api_call_count integer not null default 0 check (api_call_count >= 0),
  page_count integer not null default 0 check (page_count >= 0),
  fetched_count integer not null default 0 check (fetched_count >= 0),
  valid_count integer not null default 0 check (valid_count >= 0),
  revenue_amount numeric(14,2),
  error_message text,
  initiated_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index pos_sales_sync_jobs_store_created_idx
on public.pos_sales_sync_jobs(store_id, created_at desc);

create table public.pos_sales_tickets (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.pos_sales_integrations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  sync_job_id uuid references public.pos_sales_sync_jobs(id) on delete set null,
  revenue_date date not null,
  external_key text not null,
  external_sn text,
  occurred_at timestamptz not null,
  source_updated_at timestamptz,
  ticket_type text not null check (ticket_type in ('SELL', 'SELL_RETURN')),
  invalid boolean not null default false,
  total_amount numeric(14,2) not null,
  order_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, external_key)
);

create index pos_sales_tickets_day_idx
on public.pos_sales_tickets(integration_id, revenue_date);

alter table public.payroll_store_revenues
  drop constraint if exists payroll_store_revenues_confirmed_amount_check;

alter table public.payroll_store_revenues
  add column source text not null default 'manual' check (source in ('manual', 'pospal', 'qmai')),
  add column source_reference_id uuid references public.pos_sales_sync_jobs(id) on delete set null,
  add column source_updated_at timestamptz;

alter table public.pos_sales_integrations enable row level security;
alter table public.pos_sales_sync_jobs enable row level security;
alter table public.pos_sales_tickets enable row level security;

create policy pos_sales_integrations_admin_all
on public.pos_sales_integrations for all to authenticated
using (public.current_user_role() = 'admin' and public.has_store_access(store_id))
with check (public.current_user_role() = 'admin' and public.has_store_access(store_id));

create policy pos_sales_sync_jobs_admin_read
on public.pos_sales_sync_jobs for select to authenticated
using (public.current_user_role() = 'admin' and public.has_store_access(store_id));

grant select, insert, update, delete on public.pos_sales_integrations to authenticated;
grant select on public.pos_sales_sync_jobs to authenticated;

create table private.pos_sales_automation_config (
  singleton boolean primary key default true check (singleton),
  function_url text not null,
  cron_token text not null,
  enabled boolean not null default true,
  configured_by uuid references public.profiles(id) on delete set null,
  configured_at timestamptz not null default now()
);
revoke all on private.pos_sales_automation_config from public, anon, authenticated;

create or replace function public.verify_pos_sales_cron_token(p_token text)
returns boolean
language sql
security definer
set search_path = public, private
stable
as $$
  select exists(
    select 1
    from private.pos_sales_automation_config
    where singleton
      and enabled
      and cron_token = coalesce(p_token, '')
  );
$$;
revoke all on function public.verify_pos_sales_cron_token(text) from public, anon, authenticated;
grant execute on function public.verify_pos_sales_cron_token(text) to service_role;

create or replace function private.dispatch_pos_sales_automation()
returns bigint
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_config private.pos_sales_automation_config%rowtype;
  v_request_id bigint;
  v_china_now timestamp := clock_timestamp() at time zone 'Asia/Shanghai';
  v_china_minute integer;
begin
  select * into v_config
  from private.pos_sales_automation_config
  where singleton and enabled;
  if not found then return null; end if;

  v_china_minute := extract(hour from v_china_now)::integer * 60
    + extract(minute from v_china_now)::integer;
  if not exists (
    select 1
    from public.pos_sales_integrations integration
    where integration.enabled
      and integration.provider = 'pospal'
      and integration.next_sync_at <= now()
      and v_china_minute between integration.sync_start_hour * 60 and integration.sync_end_hour * 60
  ) then
    return null;
  end if;

  select net.http_post(
    url := v_config.function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-storehub-cron-secret', v_config.cron_token
    ),
    body := jsonb_build_object('action', 'scheduled-sync'),
    timeout_milliseconds := 25000
  ) into v_request_id;
  return v_request_id;
end;
$$;
revoke all on function private.dispatch_pos_sales_automation() from public, anon, authenticated;

create or replace function public.configure_pos_sales_integration(
  p_integration_id uuid,
  p_enabled boolean,
  p_start_hour integer,
  p_end_hour integer,
  p_interval_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, cron
as $$
declare
  v_integration public.pos_sales_integrations%rowtype;
  v_issuer text;
  v_url text;
  v_token text;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_start_hour < 0 or p_start_hour > 23
    or p_end_hour < p_start_hour or p_end_hour > 23 then
    raise exception 'invalid POS sync time window';
  end if;
  if p_interval_minutes not in (15, 30, 60, 120) then
    raise exception 'invalid POS sync interval';
  end if;

  select * into v_integration
  from public.pos_sales_integrations
  where id = p_integration_id;
  if v_integration.id is null or not public.has_store_access(v_integration.store_id) then
    raise exception 'POS integration access denied' using errcode = '42501';
  end if;

  update public.pos_sales_integrations
  set enabled = p_enabled,
      sync_start_hour = p_start_hour,
      sync_end_hour = p_end_hour,
      sync_interval_minutes = p_interval_minutes,
      next_sync_at = case when p_enabled then now() else null end,
      configured_by = auth.uid(),
      configured_at = now(),
      last_error = null
  where id = p_integration_id
  returning * into v_integration;

  v_issuer := coalesce(auth.jwt()->>'iss', '');
  if v_issuer !~ '^https://[a-z0-9-]+\.supabase\.co/auth/v1/?$' then
    raise exception 'unable to determine Supabase project URL' using errcode = '22023';
  end if;
  v_url := regexp_replace(v_issuer, '/auth/v1/?$', '/functions/v1/pospal-sales');
  select cron_token into v_token
  from private.pos_sales_automation_config
  where singleton;
  v_token := coalesce(v_token, gen_random_uuid()::text || gen_random_uuid()::text);

  insert into private.pos_sales_automation_config(
    singleton, function_url, cron_token, enabled, configured_by, configured_at
  ) values (
    true, v_url, v_token, true, auth.uid(), now()
  )
  on conflict(singleton) do update
  set function_url = excluded.function_url,
      enabled = true,
      configured_by = auth.uid(),
      configured_at = now();

  perform cron.unschedule('storehub-pos-sales-sync')
  where exists(select 1 from cron.job where jobname = 'storehub-pos-sales-sync');
  perform cron.schedule(
    'storehub-pos-sales-sync',
    '*/5 * * * *',
    $cron$select private.dispatch_pos_sales_automation();$cron$
  );

  return jsonb_build_object(
    'id', v_integration.id,
    'enabled', v_integration.enabled,
    'startHour', v_integration.sync_start_hour,
    'endHour', v_integration.sync_end_hour,
    'intervalMinutes', v_integration.sync_interval_minutes,
    'nextSyncAt', v_integration.next_sync_at
  );
end;
$$;
revoke all on function public.configure_pos_sales_integration(uuid, boolean, integer, integer, integer) from public, anon;
grant execute on function public.configure_pos_sales_integration(uuid, boolean, integer, integer, integer) to authenticated;

create or replace function public.replace_pos_sales_day(
  p_integration_id uuid,
  p_sync_job_id uuid,
  p_sync_date date,
  p_tickets jsonb,
  p_api_call_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_integration public.pos_sales_integrations%rowtype;
  v_job public.pos_sales_sync_jobs%rowtype;
  v_revenue numeric(14,2);
  v_valid_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_tickets) <> 'array' then
    raise exception 'POS tickets must be an array';
  end if;

  select * into v_integration
  from public.pos_sales_integrations
  where id = p_integration_id
  for update;
  select * into v_job
  from public.pos_sales_sync_jobs
  where id = p_sync_job_id and integration_id = p_integration_id
  for update;
  if v_integration.id is null or v_job.id is null then
    raise exception 'POS integration or sync job not found';
  end if;

  delete from public.pos_sales_tickets
  where integration_id = p_integration_id and revenue_date = p_sync_date;

  insert into public.pos_sales_tickets(
    integration_id, store_id, sync_job_id, revenue_date, external_key,
    external_sn, occurred_at, source_updated_at, ticket_type, invalid,
    total_amount, order_source
  )
  select
    v_integration.id,
    v_integration.store_id,
    v_job.id,
    p_sync_date,
    item->>'externalKey',
    nullif(item->>'externalSn', ''),
    (item->>'occurredAt')::timestamptz,
    nullif(item->>'sourceUpdatedAt', '')::timestamptz,
    item->>'ticketType',
    coalesce((item->>'invalid')::boolean, false),
    (item->>'totalAmount')::numeric,
    nullif(item->>'orderSource', '')
  from jsonb_array_elements(p_tickets) item;

  select
    coalesce(sum(
      case
        when invalid then 0
        when ticket_type = 'SELL_RETURN' then -abs(total_amount)
        else total_amount
      end
    ), 0),
    count(*) filter (where not invalid)
  into v_revenue, v_valid_count
  from public.pos_sales_tickets
  where integration_id = p_integration_id and revenue_date = p_sync_date;

  insert into public.payroll_store_revenues(
    store_id, revenue_date, confirmed_amount, note, updated_by,
    source, source_reference_id, source_updated_at
  ) values (
    v_integration.store_id,
    p_sync_date,
    v_revenue,
    '银豹收银系统同步',
    v_integration.configured_by,
    'pospal',
    v_job.id,
    now()
  )
  on conflict(store_id, revenue_date) do update
  set confirmed_amount = excluded.confirmed_amount,
      note = excluded.note,
      updated_by = excluded.updated_by,
      source = excluded.source,
      source_reference_id = excluded.source_reference_id,
      source_updated_at = excluded.source_updated_at;

  update public.pos_sales_sync_jobs
  set status = 'succeeded',
      api_call_count = p_api_call_count,
      page_count = p_api_call_count,
      fetched_count = jsonb_array_length(p_tickets),
      valid_count = v_valid_count,
      revenue_amount = v_revenue,
      error_message = null,
      finished_at = now()
  where id = v_job.id;

  update public.pos_sales_integrations
  set last_sync_at = now(),
      last_success_at = now(),
      last_error = null,
      next_sync_at = case
        when v_job.trigger_type = 'scheduled'
          then now() + make_interval(mins => sync_interval_minutes)
        else next_sync_at
      end
  where id = v_integration.id;

  return jsonb_build_object(
    'syncDate', p_sync_date,
    'ticketCount', jsonb_array_length(p_tickets),
    'validCount', v_valid_count,
    'revenueAmount', v_revenue,
    'apiCallCount', p_api_call_count
  );
end;
$$;
revoke all on function public.replace_pos_sales_day(uuid, uuid, date, jsonb, integer) from public, anon, authenticated;
grant execute on function public.replace_pos_sales_day(uuid, uuid, date, jsonb, integer) to service_role;
