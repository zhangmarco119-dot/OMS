-- Administrator-controlled AI provider configuration and a global
-- automatic-analysis switch. The API key is stored server-side and is never
-- returned to browser clients.

create table private.ai_provider_config (
  singleton boolean primary key default true check (singleton),
  provider text not null default 'deepseek'
    check (provider in ('deepseek', 'openai')),
  api_key text,
  base_url text,
  model text not null default 'deepseek-v4-pro',
  configured_by uuid references public.profiles(id) on delete set null,
  configured_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into private.ai_provider_config(singleton) values(true)
on conflict(singleton) do nothing;

update private.ai_provider_config
set base_url = coalesce(base_url, 'https://api.deepseek.com')
where singleton and base_url is null;

revoke all on table private.ai_provider_config from public, anon, authenticated;

create or replace function private.ai_provider_model_allowed(p_provider text, p_model text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    (p_provider = 'deepseek' and p_model in ('deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'))
    or (p_provider = 'openai' and p_model in ('gpt-4o', 'gpt-4o-mini', 'gpt-4.1'))
$$;

create or replace function public.admin_get_ai_provider_config()
returns jsonb
language plpgsql
security definer
set search_path = public, private
stable
as $$
declare
  v_config private.ai_provider_config%rowtype;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;
  select * into v_config from private.ai_provider_config where singleton;
  return jsonb_build_object(
    'provider', v_config.provider,
    'base_url', v_config.base_url,
    'model', v_config.model,
    'api_key_configured', v_config.api_key is not null,
    'api_key_last4', case when v_config.api_key is null then null else right(v_config.api_key, 4) end,
    'configured_at', v_config.configured_at
  );
end;
$$;

create or replace function public.admin_save_ai_provider_config(
  p_provider text,
  p_model text,
  p_api_key text default null,
  p_clear_api_key boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_base_url text;
  v_new_key text;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;

  if p_provider not in ('deepseek', 'openai') then
    raise exception 'invalid AI provider' using errcode = '22023';
  end if;
  if not private.ai_provider_model_allowed(p_provider, p_model) then
    raise exception 'invalid AI model for provider' using errcode = '22023';
  end if;

  v_base_url := case p_provider
    when 'deepseek' then 'https://api.deepseek.com'
    else 'https://api.openai.com/v1'
  end;

  if p_clear_api_key then
    v_new_key := null;
  elsif p_api_key is not null and nullif(btrim(p_api_key), '') is not null then
    v_new_key := btrim(p_api_key);
    if char_length(v_new_key) not between 12 and 300
      or v_new_key !~ '^[A-Za-z0-9._-]+$' then
      raise exception 'API key format is invalid' using errcode = '22023';
    end if;
  else
    select api_key into v_new_key from private.ai_provider_config where singleton;
  end if;

  update private.ai_provider_config
  set provider = p_provider,
      base_url = v_base_url,
      model = p_model,
      api_key = v_new_key,
      configured_by = auth.uid(),
      configured_at = now(),
      updated_at = now()
  where singleton;

  return public.admin_get_ai_provider_config();
end;
$$;

create or replace function public.service_get_ai_provider_config()
returns jsonb
language plpgsql
security definer
set search_path = public, private
stable
as $$
declare
  v_config private.ai_provider_config%rowtype;
begin
  select * into v_config from private.ai_provider_config where singleton;
  return jsonb_build_object(
    'provider', v_config.provider,
    'api_key', v_config.api_key,
    'base_url', v_config.base_url,
    'model', v_config.model
  );
end;
$$;

revoke all on function public.admin_get_ai_provider_config(),
  public.admin_save_ai_provider_config(text, text, text, boolean),
  public.service_get_ai_provider_config()
from public, anon, authenticated;

grant execute on function public.admin_get_ai_provider_config(),
  public.admin_save_ai_provider_config(text, text, text, boolean)
to authenticated;

grant execute on function public.service_get_ai_provider_config()
to service_role;


create or replace function private.ai_enqueue_review(
  p_store_id uuid,
  p_workflow text,
  p_entity_id uuid,
  p_trigger_type text,
  p_context jsonb default null,
  p_actor_id uuid default null,
  p_parent_run_id uuid default null,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_settings private.ai_review_settings%rowtype;
  v_context jsonb;
  v_source_hash text;
  v_entity_version text;
  v_dedupe_key text;
  v_run public.ai_review_runs%rowtype;
  v_job public.ai_review_queue%rowtype;
  v_stale_run record;
begin
  if p_workflow not in (
    'product', 'product_creation_request', 'arrival_report',
    'inventory', 'order', 'v2_task'
  ) or p_trigger_type not in ('auto', 'ensure', 'rerun', 'draft') then
    raise exception 'invalid AI review workflow or trigger' using errcode = '22023';
  end if;
  if p_trigger_type = 'draft' and (p_workflow <> 'product' or p_context is null) then
    raise exception 'product draft context is required' using errcode = '22023';
  end if;
  if not public.ai_review_is_enabled(p_store_id, p_workflow, false, false) then
    return jsonb_build_object('status', 'disabled', 'deduplicated', false);
  end if;

  select * into v_settings from private.ai_review_settings where singleton;
  if p_trigger_type in ('auto', 'draft') and not v_settings.auto_run_enabled then
    return jsonb_build_object('status', 'disabled', 'deduplicated', false);
  end if;
  if (
    select count(*) from public.ai_review_runs
    where created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'
      and error_code is distinct from 'PILOT_INITIAL_BACKFILL_CANCELLED'
  ) >= v_settings.daily_run_limit then
    return jsonb_build_object('status', 'daily_limit_reached', 'deduplicated', false);
  end if;

  if p_entity_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'storehub-ai-review:' || p_store_id::text || ':' || p_workflow || ':' || p_entity_id::text,
      0
    ));
  end if;

  v_context := coalesce(p_context, private.ai_build_context(p_store_id, p_workflow, p_entity_id));
  if jsonb_typeof(v_context) <> 'object'
    or v_context ->> 'workflow' <> p_workflow
    or (v_context ->> 'storeId')::uuid <> p_store_id then
    raise exception 'AI review context does not match its scope' using errcode = '23514';
  end if;
  v_source_hash := private.ai_context_hash(v_context);
  v_entity_version := coalesce(v_context ->> 'sourceVersion', v_source_hash);
  v_dedupe_key := p_workflow || ':' || coalesce(p_entity_id::text, 'draft') || ':' || v_source_hash;
  if p_force then
    v_dedupe_key := v_dedupe_key || ':' || gen_random_uuid()::text;
  end if;

  if not p_force then
    select * into v_run
    from public.ai_review_runs
    where dedupe_key = v_dedupe_key;
    if v_run.id is not null then
      return jsonb_build_object(
        'run_id', v_run.id,
        'job_id', (select id from public.ai_review_queue where run_id = v_run.id),
        'status', v_run.status,
        'deduplicated', true,
        'store_id', v_run.store_id,
        'workflow', v_run.workflow,
        'entity_id', v_run.entity_id,
        'source_hash', v_run.source_hash,
        'context', v_run.source_context
      );
    end if;
  end if;

  if p_entity_id is not null then
    for v_stale_run in
      update public.ai_review_runs
      set status = 'stale', completed_at = coalesce(completed_at, now())
      where store_id = p_store_id
        and workflow = p_workflow
        and entity_id = p_entity_id
        and source_hash <> v_source_hash
        and status in ('queued', 'running', 'completed', 'failed')
      returning id
    loop
      update public.ai_review_queue
      set status = 'cancelled'
      where run_id = v_stale_run.id and status in ('queued', 'running');
      update public.ai_suggestions
      set status = 'stale'
      where run_id = v_stale_run.id and status <> 'stale';
      insert into public.ai_suggestion_events(run_id, store_id, event_type, metadata)
      values(v_stale_run.id, p_store_id, 'stale', jsonb_build_object('replacementSourceHash', v_source_hash));
    end loop;
  end if;

  insert into public.ai_review_runs(
    store_id, workflow, entity_id, trigger_type, entity_version,
    source_hash, source_context, dedupe_key, parent_run_id, created_by
  ) values (
    p_store_id, p_workflow, p_entity_id, p_trigger_type, v_entity_version,
    v_source_hash, v_context, v_dedupe_key, p_parent_run_id, p_actor_id
  )
  on conflict (dedupe_key) do nothing
  returning * into v_run;

  if v_run.id is null then
    select * into v_run
    from public.ai_review_runs
    where dedupe_key = v_dedupe_key;
    if v_run.id is null then
      raise exception 'AI review deduplication did not resolve a run' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'run_id', v_run.id,
      'job_id', (select id from public.ai_review_queue where run_id = v_run.id),
      'status', v_run.status,
      'deduplicated', true,
      'store_id', v_run.store_id,
      'workflow', v_run.workflow,
      'entity_id', v_run.entity_id,
      'source_hash', v_run.source_hash,
      'context', v_run.source_context
    );
  end if;

  insert into public.ai_review_queue(run_id, store_id)
  values(v_run.id, p_store_id)
  returning * into v_job;

  insert into public.ai_suggestion_events(run_id, store_id, actor_id, event_type, metadata)
  values(v_run.id, p_store_id, p_actor_id, 'queued', jsonb_build_object('triggerType', p_trigger_type));

  perform private.dispatch_ai_review_queue();

  return jsonb_build_object(
    'run_id', v_run.id,
    'job_id', v_job.id,
    'status', v_run.status,
    'deduplicated', false,
    'store_id', v_run.store_id,
    'workflow', v_run.workflow,
    'entity_id', v_run.entity_id,
    'source_hash', v_run.source_hash,
    'context', v_run.source_context
  );
end;
$$;

revoke all on function private.ai_enqueue_review(uuid, text, uuid, text, jsonb, uuid, uuid, boolean)
from public, anon, authenticated;
