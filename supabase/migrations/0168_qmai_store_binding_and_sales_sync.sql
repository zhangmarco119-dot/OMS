-- Qmai store bindings keep external credentials in Edge Function secrets. The
-- public integration row holds only the selected Qmai store identity.

alter table public.pos_sales_integrations
  add column if not exists external_credential_id text,
  add column if not exists external_store_id text;

create table if not exists private.qmai_sales_automation_config (
  singleton boolean primary key default true check (singleton),
  function_url text not null,
  cron_token text not null,
  enabled boolean not null default true,
  configured_by uuid references public.profiles(id) on delete set null,
  configured_at timestamptz not null default now()
);
revoke all on private.qmai_sales_automation_config from public, anon, authenticated;

create or replace function public.bind_qmai_sales_integration(
  p_store_id uuid,
  p_credential_id text,
  p_shop_code text,
  p_shop_id text,
  p_shop_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.pos_sales_integrations%rowtype;
  v_result public.pos_sales_integrations%rowtype;
begin
  if public.current_user_role() <> 'admin' or not public.has_store_access(p_store_id) then
    raise exception 'administrator store access required' using errcode = '42501';
  end if;
  if nullif(trim(p_credential_id), '') is null
    or nullif(trim(p_shop_code), '') is null
    or nullif(trim(p_shop_name), '') is null then
    raise exception 'Qmai credential, shop code and shop name are required' using errcode = '22023';
  end if;

  select * into v_existing
  from public.pos_sales_integrations
  where store_id = p_store_id
  for update;

  if v_existing.id is not null and v_existing.provider <> 'qmai' then
    raise exception 'this StoreHub store is already bound to another POS provider' using errcode = '23505';
  end if;

  if v_existing.id is null then
    insert into public.pos_sales_integrations(
      store_id, provider, display_name, external_account, external_credential_id,
      external_store_id, configured_by, configured_at
    ) values (
      p_store_id, 'qmai', trim(p_shop_name), trim(p_shop_code), trim(p_credential_id),
      nullif(trim(p_shop_id), ''), auth.uid(), now()
    ) returning * into v_result;
  else
    update public.pos_sales_integrations
    set display_name = trim(p_shop_name),
        external_account = trim(p_shop_code),
        external_credential_id = trim(p_credential_id),
        external_store_id = nullif(trim(p_shop_id), ''),
        configured_by = auth.uid(),
        configured_at = now(),
        last_error = null
    where id = v_existing.id
    returning * into v_result;
  end if;

  return to_jsonb(v_result);
end;
$$;
revoke all on function public.bind_qmai_sales_integration(uuid,text,text,text,text) from public, anon;
grant execute on function public.bind_qmai_sales_integration(uuid,text,text,text,text) to authenticated;

create or replace function public.verify_qmai_sales_cron_token(p_token text)
returns boolean
language sql
security definer
set search_path = public, private
stable
as $$
  select exists(
    select 1 from private.qmai_sales_automation_config
    where singleton and enabled and cron_token = coalesce(p_token, '')
  );
$$;
revoke all on function public.verify_qmai_sales_cron_token(text) from public, anon, authenticated;
grant execute on function public.verify_qmai_sales_cron_token(text) to service_role;

create or replace function private.dispatch_qmai_sales_automation()
returns bigint
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_config private.qmai_sales_automation_config%rowtype;
  v_request_id bigint;
  v_china_now timestamp := clock_timestamp() at time zone 'Asia/Shanghai';
  v_china_minute integer;
begin
  select * into v_config from private.qmai_sales_automation_config where singleton and enabled;
  if not found then return null; end if;
  v_china_minute := extract(hour from v_china_now)::integer * 60 + extract(minute from v_china_now)::integer;
  if not exists (
    select 1 from public.pos_sales_integrations integration
    where integration.enabled and integration.provider = 'qmai'
      and integration.next_sync_at <= now()
      and v_china_minute between integration.sync_start_hour * 60 and integration.sync_end_hour * 60
  ) then return null; end if;
  select net.http_post(
    url := v_config.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-storehub-cron-secret', v_config.cron_token),
    body := jsonb_build_object('action', 'scheduled-sync'),
    timeout_milliseconds := 55000
  ) into v_request_id;
  return v_request_id;
end;
$$;
revoke all on function private.dispatch_qmai_sales_automation() from public, anon, authenticated;

create or replace function public.configure_qmai_sales_integration(
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
  if public.current_user_role() <> 'admin' then raise exception 'administrator access required' using errcode = '42501'; end if;
  if p_start_hour < 0 or p_start_hour > 23 or p_end_hour < p_start_hour or p_end_hour > 23 then
    raise exception 'invalid Qmai sync time window';
  end if;
  if p_interval_minutes not in (15, 30, 60, 120) then raise exception 'invalid Qmai sync interval'; end if;
  select * into v_integration from public.pos_sales_integrations where id = p_integration_id and provider = 'qmai';
  if v_integration.id is null or not public.has_store_access(v_integration.store_id) then
    raise exception 'Qmai integration access denied' using errcode = '42501';
  end if;
  update public.pos_sales_integrations
  set enabled = p_enabled, sync_start_hour = p_start_hour, sync_end_hour = p_end_hour,
      sync_interval_minutes = p_interval_minutes, next_sync_at = case when p_enabled then now() else null end,
      configured_by = auth.uid(), configured_at = now(), last_error = null
  where id = p_integration_id returning * into v_integration;

  v_issuer := coalesce(auth.jwt()->>'iss', '');
  if v_issuer !~ '^https://[a-z0-9-]+\\.supabase\\.co/auth/v1/?$' then raise exception 'unable to determine Supabase project URL' using errcode = '22023'; end if;
  v_url := regexp_replace(v_issuer, '/auth/v1/?$', '/functions/v1/qmai-sales');
  select cron_token into v_token from private.qmai_sales_automation_config where singleton;
  v_token := coalesce(v_token, gen_random_uuid()::text || gen_random_uuid()::text);
  insert into private.qmai_sales_automation_config(singleton, function_url, cron_token, enabled, configured_by, configured_at)
  values (true, v_url, v_token, true, auth.uid(), now())
  on conflict(singleton) do update set function_url = excluded.function_url, enabled = true, configured_by = excluded.configured_by, configured_at = excluded.configured_at;
  perform cron.unschedule('storehub-qmai-sales-sync') where exists(select 1 from cron.job where jobname = 'storehub-qmai-sales-sync');
  perform cron.schedule('storehub-qmai-sales-sync', '*/5 * * * *', $cron$select private.dispatch_qmai_sales_automation();$cron$);
  return jsonb_build_object('id', v_integration.id, 'enabled', v_integration.enabled, 'startHour', v_integration.sync_start_hour, 'endHour', v_integration.sync_end_hour, 'intervalMinutes', v_integration.sync_interval_minutes, 'nextSyncAt', v_integration.next_sync_at);
end;
$$;
revoke all on function public.configure_qmai_sales_integration(uuid,boolean,integer,integer,integer) from public, anon;
grant execute on function public.configure_qmai_sales_integration(uuid,boolean,integer,integer,integer) to authenticated;

-- Qmai business-summary returns a daily aggregate, so it is represented as one
-- normalized sale ticket per day. Reuse the existing atomic range replacement,
-- then correct its source label for Qmai.
create or replace function public.replace_qmai_sales_range(
  p_integration_id uuid, p_sync_job_id uuid, p_start_date date, p_end_date date,
  p_tickets jsonb, p_api_call_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if not exists(select 1 from public.pos_sales_integrations where id = p_integration_id and provider = 'qmai') then
    raise exception 'Qmai integration not found';
  end if;
  v_result := public.replace_pos_sales_range(p_integration_id, p_sync_job_id, p_start_date, p_end_date, p_tickets, p_api_call_count);
  update public.payroll_store_revenues
  set source = 'qmai', note = '企迈营业额同步'
  where source_reference_id = p_sync_job_id;
  return v_result;
end;
$$;
revoke all on function public.replace_qmai_sales_range(uuid,uuid,date,date,jsonb,integer) from public, anon, authenticated;
grant execute on function public.replace_qmai_sales_range(uuid,uuid,date,date,jsonb,integer) to service_role;
