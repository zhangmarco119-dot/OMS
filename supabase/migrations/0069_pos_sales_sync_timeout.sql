-- Allow the scheduled HTTP request to outlive the upstream Pospal timeout.
-- The Edge Function waits at most 45 seconds for each page, while pg_net
-- waits up to 55 seconds for the complete function response.

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
    timeout_milliseconds := 55000
  ) into v_request_id;
  return v_request_id;
end;
$$;
revoke all on function private.dispatch_pos_sales_automation() from public, anon, authenticated;
