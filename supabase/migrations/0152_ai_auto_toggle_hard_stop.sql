-- Hard stop for all model egress when automatic analysis is disabled.
-- The enqueue gate already blocks new auto/draft runs, but previously-queued
-- runs could still be dispatched and claimed. Gate dispatch and claim as well
-- so turning the switch off stops every API call.

create or replace function private.dispatch_ai_review_queue()
returns bigint
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_settings private.ai_review_settings%rowtype;
  v_request_id bigint;
begin
  select * into v_settings
  from private.ai_review_settings
  where singleton and global_enabled
    and auto_run_enabled
    and function_url is not null and cron_token is not null
  for update;

  if not found
    or v_settings.last_dispatched_at > now() - interval '5 seconds'
    or not exists(
    select 1 from public.ai_review_queue
    where status = 'queued' and available_at <= now()
  ) then
    return null;
  end if;

  update private.ai_review_settings
  set last_dispatched_at = now()
  where singleton;

  select net.http_post(
    url := v_settings.function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-storehub-cron-secret', v_settings.cron_token
    ),
    body := jsonb_build_object('action', 'process-queue'),
    timeout_milliseconds := 25000
  ) into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.claim_ai_review_jobs(
  p_limit integer default 10,
  p_worker_id text default null
)
returns setof jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_claim jsonb;
  v_count integer := 0;
begin
  if not exists(select 1 from private.ai_review_settings where singleton and auto_run_enabled) then
    return;
  end if;
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 50 then
    raise exception 'claim limit must be between 1 and 50' using errcode = '22023';
  end if;
  loop
    exit when v_count >= p_limit;
    v_claim := private.ai_claim_one(null, p_worker_id);
    exit when v_claim is null;
    return next v_claim;
    v_count := v_count + 1;
  end loop;
end;
$$;

create or replace function public.claim_ai_review_run(
  p_run_id uuid,
  p_worker_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not exists(select 1 from private.ai_review_settings where singleton and auto_run_enabled) then
    return null;
  end if;
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return private.ai_claim_one(p_run_id, p_worker_id);
end;
$$;
