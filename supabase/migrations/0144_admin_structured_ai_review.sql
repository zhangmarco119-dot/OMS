-- Administrator-only structured AI review pilot for Wudaokou and Xizhimen.
-- AI output is advisory: it can only be copied into an administrator draft.
-- It never mutates a business entity or changes an existing V1 permission.

create extension if not exists pgcrypto;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.ai_pilot_stores (
  store_id uuid primary key references public.stores(id) on delete cascade,
  enabled boolean not null default true,
  workflow_flags jsonb not null default jsonb_build_object(
    'product', true,
    'product_creation_request', true,
    'arrival_report', true,
    'inventory', true,
    'order', true,
    'v2_task', false
  ),
  initialized_from_name text,
  configured_by uuid references public.profiles(id) on delete set null,
  configured_at timestamptz not null default now(),
  check (jsonb_typeof(workflow_flags) = 'object')
);

create table private.ai_review_settings (
  singleton boolean primary key default true check (singleton),
  global_enabled boolean not null default true,
  auto_run_enabled boolean not null default true,
  admin_visible boolean not null default true,
  admin_apply_enabled boolean not null default true,
  workflow_flags jsonb not null default jsonb_build_object(
    'product', true,
    'product_creation_request', true,
    'arrival_report', true,
    'inventory', true,
    'order', true,
    'v2_task', false
  ),
  function_url text,
  cron_token text,
  daily_run_limit integer not null default 2000 check (daily_run_limit between 1 and 100000),
  last_dispatched_at timestamptz,
  configured_by uuid references public.profiles(id) on delete set null,
  configured_at timestamptz not null default now(),
  check (jsonb_typeof(workflow_flags) = 'object'),
  check (function_url is null or function_url ~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/ai-review$'),
  check (cron_token is null or char_length(cron_token) >= 32)
);

insert into private.ai_review_settings(singleton) values(true)
on conflict(singleton) do nothing;

create table public.ai_review_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  workflow text not null check (workflow in (
    'product', 'product_creation_request', 'arrival_report',
    'inventory', 'order', 'v2_task'
  )),
  entity_id uuid,
  trigger_type text not null check (trigger_type in ('auto', 'ensure', 'rerun', 'draft')),
  entity_version text not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  source_context jsonb not null,
  dedupe_key text not null unique,
  parent_run_id uuid references public.ai_review_runs(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'skipped', 'stale')),
  model text,
  system_fingerprint text,
  usage jsonb not null default '{}'::jsonb,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  summary text,
  error_code text,
  error_message text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  skipped_at timestamptz,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(source_context) = 'object'),
  check ((trigger_type = 'draft' and workflow = 'product') or trigger_type <> 'draft')
);

create table public.ai_review_queue (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.ai_review_runs(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_review_runs(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  issue_type text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  title text not null,
  field_path text,
  current_value jsonb,
  suggested_value jsonb,
  rationale text not null,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  action_type text not null check (action_type in (
    'review', 'replace_fields', 'use_existing_product',
    'edit_quantity', 'mark_no_order_needed'
  )),
  draft_patch jsonb not null default '{}'::jsonb,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'applied_to_draft', 'ignored', 'stale')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(draft_patch) = 'object'),
  check (nullif(btrim(issue_type), '') is not null),
  check (nullif(btrim(title), '') is not null),
  check (nullif(btrim(rationale), '') is not null)
);

create table public.ai_suggestion_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_review_runs(id) on delete cascade,
  suggestion_id uuid references public.ai_suggestions(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in (
    'queued', 'started', 'completed', 'failed', 'retry_scheduled',
    'skipped', 'stale', 'rerun', 'applied_to_draft', 'ignored', 'restored'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);

create index ai_review_runs_store_created_idx
  on public.ai_review_runs(store_id, created_at desc);
create index ai_review_runs_workflow_status_idx
  on public.ai_review_runs(workflow, status, created_at desc);
create index ai_review_runs_entity_idx
  on public.ai_review_runs(store_id, workflow, entity_id, created_at desc);
create index ai_review_queue_claim_idx
  on public.ai_review_queue(status, available_at, created_at)
  where status = 'queued';
create index ai_suggestions_run_status_idx
  on public.ai_suggestions(run_id, status, severity, created_at);
create index ai_suggestion_events_run_created_idx
  on public.ai_suggestion_events(run_id, created_at);

create trigger ai_review_runs_touch_updated_at
before update on public.ai_review_runs
for each row execute function public.touch_updated_at();
create trigger ai_review_queue_touch_updated_at
before update on public.ai_review_queue
for each row execute function public.touch_updated_at();
create trigger ai_suggestions_touch_updated_at
before update on public.ai_suggestions
for each row execute function public.touch_updated_at();

create or replace function private.ai_sync_named_pilot_store()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.name in ('宝珠奶酪（五道口店）', 'OMEGA酸奶（西直门店）') then
    insert into public.ai_pilot_stores(store_id, enabled, initialized_from_name)
    values(new.id, true, new.name)
    on conflict(store_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger stores_initialize_ai_pilot_scope
after insert or update of name on public.stores
for each row execute function private.ai_sync_named_pilot_store();

insert into public.ai_pilot_stores(store_id, enabled, initialized_from_name)
select id, true, name
from public.stores
where name in ('宝珠奶酪（五道口店）', 'OMEGA酸奶（西直门店）')
on conflict(store_id) do nothing;

create or replace function public.ai_review_is_enabled(
  p_store_id uuid,
  p_workflow text,
  p_require_visible boolean default false,
  p_require_apply boolean default false
)
returns boolean
language sql
security definer
set search_path = public, private
stable
as $$
  select exists(
    select 1
    from private.ai_review_settings settings
    join public.ai_pilot_stores scope on scope.store_id = p_store_id
    where settings.singleton
      and settings.global_enabled
      and scope.enabled
      and coalesce((settings.workflow_flags ->> p_workflow)::boolean, false)
      and coalesce((scope.workflow_flags ->> p_workflow)::boolean, false)
      and (not p_require_visible or settings.admin_visible)
      and (not p_require_apply or settings.admin_apply_enabled)
  );
$$;

create or replace function public.can_admin_access_ai_store(p_store_id uuid)
returns boolean
language sql
security definer
set search_path = public, private
stable
as $$
  select public.current_user_role() = 'admin'
    and public.has_store_access(p_store_id)
    and exists(
      select 1
      from private.ai_review_settings settings
      join public.ai_pilot_stores scope on scope.store_id = p_store_id
      where settings.singleton
        and settings.global_enabled
        and settings.admin_visible
        and scope.enabled
    )
$$;

alter table public.ai_pilot_stores enable row level security;
alter table public.ai_review_runs enable row level security;
alter table public.ai_review_queue enable row level security;
alter table public.ai_suggestions enable row level security;
alter table public.ai_suggestion_events enable row level security;

create policy ai_pilot_stores_admin_select
on public.ai_pilot_stores for select to authenticated
using (
  public.current_user_role() = 'admin'
  and public.has_store_access(store_id)
);
create policy ai_review_runs_admin_select
on public.ai_review_runs for select to authenticated
using (public.can_admin_access_ai_store(store_id));
create policy ai_suggestions_admin_select
on public.ai_suggestions for select to authenticated
using (public.can_admin_access_ai_store(store_id));
create policy ai_suggestion_events_admin_select
on public.ai_suggestion_events for select to authenticated
using (public.can_admin_access_ai_store(store_id));

revoke all on public.ai_pilot_stores, public.ai_review_runs, public.ai_review_queue,
  public.ai_suggestions, public.ai_suggestion_events from public, anon, authenticated;
grant select on public.ai_pilot_stores, public.ai_review_runs,
  public.ai_suggestions, public.ai_suggestion_events to authenticated;
grant select, insert, update, delete on public.ai_review_runs, public.ai_review_queue,
  public.ai_suggestions, public.ai_suggestion_events to service_role;
grant execute on function public.can_admin_access_ai_store(uuid) to authenticated, service_role;
grant execute on function public.ai_review_is_enabled(uuid, text, boolean, boolean) to service_role;

create or replace function private.ai_context_hash(p_context jsonb)
returns text
language sql
immutable
as $$
  select encode(
    extensions.digest(convert_to((coalesce(p_context, '{}'::jsonb) - 'sourceVersion')::text, 'UTF8'), 'sha256'),
    'hex'
  )
$$;

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

revoke all on function private.ai_sync_named_pilot_store(),
  private.ai_context_hash(jsonb), private.dispatch_ai_review_queue()
from public, anon, authenticated;

create or replace function private.ai_product_catalog(
  p_store_id uuid,
  p_exclude_product_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'productId', product.id,
    'label', product.name,
    'spec', product.spec,
    'countUnit', product.count_unit,
    'categoryCode', product.category_code,
    'isActive', product.is_active
  ) order by product.sort_order, product.name, product.id), '[]'::jsonb)
  from (
    select p.id, p.name, p.spec, p.count_unit, p.category_code,
      p.is_active, p.sort_order
    from public.products p
    where p.store_id = p_store_id
      and (p_exclude_product_id is null or p.id <> p_exclude_product_id)
    order by p.is_active desc, p.sort_order, p.name, p.id
    limit 400
  ) product
$$;

create or replace function private.ai_build_context(
  p_store_id uuid,
  p_workflow text,
  p_entity_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
stable
as $$
declare
  v_context jsonb;
  v_product public.products%rowtype;
  v_request public.product_creation_requests%rowtype;
  v_arrival public.arrival_reports%rowtype;
  v_task public.tasks%rowtype;
  v_v2_task public.v2_tasks%rowtype;
begin
  if p_workflow = 'product' then
    select * into v_product
    from public.products
    where id = p_entity_id and store_id = p_store_id;
    if v_product.id is null then
      raise exception 'AI review product does not belong to the store'
        using errcode = '23514';
    end if;
    v_context := jsonb_build_object(
      'workflow', p_workflow,
      'storeId', p_store_id,
      'entityId', v_product.id,
      'sourceVersion', v_product.updated_at,
      'product', jsonb_build_object(
        'productId', v_product.id,
        'label', v_product.name,
        'spec', v_product.spec,
        'countUnit', v_product.count_unit,
        'categoryCode', v_product.category_code,
        'isActive', v_product.is_active
      ),
      'catalog', private.ai_product_catalog(p_store_id, v_product.id)
    );
  elsif p_workflow = 'product_creation_request' then
    select * into v_request
    from public.product_creation_requests
    where id = p_entity_id and store_id = p_store_id;
    if v_request.id is null then
      raise exception 'AI review product request does not belong to the store'
        using errcode = '23514';
    end if;
    v_context := jsonb_build_object(
      'workflow', p_workflow,
      'storeId', p_store_id,
      'entityId', v_request.id,
      'sourceVersion', v_request.updated_at,
      'request', jsonb_build_object(
        'requestId', v_request.id,
        'label', v_request.name,
        'spec', v_request.spec,
        'countUnit', v_request.count_unit,
        'categoryCode', v_request.category_code,
        'requestStatus', v_request.status
      ),
      'catalog', private.ai_product_catalog(p_store_id, null)
    );
  elsif p_workflow = 'arrival_report' then
    select * into v_arrival
    from public.arrival_reports
    where id = p_entity_id and store_id = p_store_id;
    if v_arrival.id is null then
      raise exception 'AI review arrival does not belong to the store'
        using errcode = '23514';
    end if;
    select jsonb_build_object(
      'workflow', p_workflow,
      'storeId', p_store_id,
      'entityId', v_arrival.id,
      'sourceVersion', v_arrival.version,
      'arrival', jsonb_build_object(
        'reportId', v_arrival.id,
        'arrivalDate', v_arrival.arrival_date,
        'lifecycleStatus', case when v_arrival.status = 'voided' then 'voided' else 'active' end,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'itemId', item.id,
            'productId', item.product_id,
            'label', item.product_name_snapshot,
            'quantity', item.quantity,
            'unit', item.unit,
            'isUnmatchedProduct', item.is_unmatched_product,
            'sortOrder', item.sort_order
          ) order by item.sort_order, item.created_at, item.id)
          from public.arrival_report_items item
          where item.report_id = v_arrival.id
        ), '[]'::jsonb)
      ),
      'history', coalesce((
        select jsonb_agg(history.entry order by history.arrival_date desc, history.item_id)
        from (
          select prior.arrival_date, prior_item.id as item_id,
            jsonb_build_object(
              'arrivalDate', prior.arrival_date,
              'productId', prior_item.product_id,
              'label', prior_item.product_name_snapshot,
              'quantity', prior_item.quantity,
              'unit', prior_item.unit
            ) as entry
          from public.arrival_reports prior
          join public.arrival_report_items prior_item on prior_item.report_id = prior.id
          where prior.store_id = p_store_id
            and prior.id <> v_arrival.id
            and prior.status in ('submitted', 'viewed')
            and prior.arrival_date >= v_arrival.arrival_date - 60
          order by prior.arrival_date desc, prior_item.id
          limit 600
        ) history
      ), '[]'::jsonb),
      'catalog', private.ai_product_catalog(p_store_id, null)
    ) into v_context;
  elsif p_workflow in ('inventory', 'order') then
    select * into v_task
    from public.tasks
    where id = p_entity_id and store_id = p_store_id and task_type = p_workflow;
    if v_task.id is null then
      raise exception 'AI review V1 task does not match the workflow and store'
        using errcode = '23514';
    end if;
    select jsonb_build_object(
      'workflow', p_workflow,
      'storeId', p_store_id,
      'entityId', v_task.id,
      'sourceVersion', v_task.updated_at,
      'task', jsonb_build_object(
        'taskId', v_task.id,
        'taskType', v_task.task_type,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'itemId', item.id,
            'productId', item.product_id,
            'label', coalesce(item.product_snapshot ->> 'name', product.name, ''),
            'spec', coalesce(item.product_snapshot ->> 'spec', product.spec, ''),
            'countUnit', coalesce(item.product_snapshot ->> 'count_unit', product.count_unit, ''),
            'quantity', item.quantity,
            'itemStatus', item.status,
            'isExtraItem', item.is_extra_item,
            'sortOrder', item.sort_order
          ) order by item.sort_order, item.created_at, item.id)
          from public.task_items item
          left join public.products product on product.id = item.product_id
          where item.task_id = v_task.id
        ), '[]'::jsonb)
      ),
      'history', coalesce((
        select jsonb_agg(history.entry order by history.submitted_at desc, history.item_id)
        from (
          select prior.submitted_at, prior_item.id as item_id,
            jsonb_build_object(
              'taskType', prior.task_type,
              'submittedAt', prior.submitted_at,
              'productId', prior_item.product_id,
              'quantity', prior_item.quantity,
              'itemStatus', prior_item.status
            ) as entry
          from public.tasks prior
          join public.task_items prior_item on prior_item.task_id = prior.id
          where prior.store_id = p_store_id
            and prior.id <> v_task.id
            and prior.status = 'submitted'
            and prior.submitted_at >= coalesce(v_task.submitted_at, now()) - interval '60 days'
          order by prior.submitted_at desc, prior_item.id
          limit 800
        ) history
      ), '[]'::jsonb)
    ) into v_context;
  elsif p_workflow = 'v2_task' then
    select * into v_v2_task
    from public.v2_tasks
    where id = p_entity_id and store_id = p_store_id;
    if v_v2_task.id is null then
      raise exception 'AI review V2 task does not belong to the store'
        using errcode = '23514';
    end if;
    select jsonb_build_object(
      'workflow', p_workflow,
      'storeId', p_store_id,
      'entityId', v_v2_task.id,
      'sourceVersion', v_v2_task.version,
      'task', jsonb_build_object(
        'taskId', v_v2_task.id,
        'taskTitle', v_v2_task.name,
        'category', v_v2_task.category,
        'reviewState', case
          when v_v2_task.status in ('submitted', 'resubmitted') then 'pending_review'
          else v_v2_task.status
        end,
        'answers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'itemId', answer.item_id,
            'prompt', coalesce(answer.item_snapshot ->> 'label', ''),
            'fieldType', coalesce(answer.item_snapshot ->> 'field_type', ''),
            'structuredAnswer', case
              when answer.item_snapshot ->> 'answer_schema' in ('product_spec', 'product_correction') then
                jsonb_build_object(
                  'label', answer.answer ->> 'name',
                  'spec', answer.answer ->> 'spec',
                  'countUnit', answer.answer ->> 'count_unit',
                  'categoryCode', answer.answer ->> 'category_code'
                )
              when answer.item_snapshot ->> 'field_type' in (
                'integer', 'decimal', 'boolean', 'single_choice',
                'multi_choice', 'confirmation', 'rating'
              ) then answer.answer
              else null
            end,
            'isIssue', answer.is_issue
          ) order by answer.item_id)
          from public.v2_task_answers answer
          where answer.task_id = v_v2_task.id
            and (
              answer.item_snapshot ->> 'answer_schema' in ('product_spec', 'product_correction')
              or answer.item_snapshot ->> 'field_type' in (
                'integer', 'decimal', 'boolean', 'single_choice',
                'multi_choice', 'confirmation', 'rating'
              )
            )
        ), '[]'::jsonb)
      )
    ) into v_context;
  else
    raise exception 'unsupported AI review workflow' using errcode = '22023';
  end if;

  return v_context;
end;
$$;

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
  if p_trigger_type = 'auto' and not v_settings.auto_run_enabled then
    return jsonb_build_object('status', 'disabled', 'deduplicated', false);
  end if;
  if (
    select count(*) from public.ai_review_runs
    where created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'
  ) >= v_settings.daily_run_limit then
    return jsonb_build_object('status', 'daily_limit_reached', 'deduplicated', false);
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
  ) returning * into v_run;

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

revoke all on function private.ai_product_catalog(uuid, uuid),
  private.ai_build_context(uuid, text, uuid),
  private.ai_enqueue_review(uuid, text, uuid, text, jsonb, uuid, uuid, boolean)
from public, anon, authenticated;

create or replace function public.admin_get_ai_settings()
returns jsonb
language plpgsql
security definer
set search_path = public, private
stable
as $$
declare
  v_settings private.ai_review_settings%rowtype;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;
  select * into v_settings from private.ai_review_settings where singleton;
  return jsonb_build_object(
    'global_enabled', v_settings.global_enabled,
    'auto_run_enabled', v_settings.auto_run_enabled,
    'admin_visible', v_settings.admin_visible,
    'admin_apply_enabled', v_settings.admin_apply_enabled,
    'workflow_flags', v_settings.workflow_flags,
    'daily_run_limit', v_settings.daily_run_limit,
    'automation_configured', v_settings.function_url is not null and v_settings.cron_token is not null,
    'pilot_stores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'store_id', scope.store_id,
        'store_name', store.name,
        'enabled', scope.enabled,
        'workflow_flags', scope.workflow_flags
      ) order by store.name)
      from public.ai_pilot_stores scope
      join public.stores store on store.id = scope.store_id
      where public.has_store_access(scope.store_id)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_save_ai_settings(
  p_global_enabled boolean,
  p_auto_run_enabled boolean,
  p_admin_visible boolean,
  p_admin_apply_enabled boolean,
  p_workflow_flags jsonb,
  p_daily_run_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_allowed_keys constant text[] := array[
    'product', 'product_creation_request', 'arrival_report',
    'inventory', 'order', 'v2_task'
  ];
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_workflow_flags) <> 'object'
    or exists(select 1 from jsonb_object_keys(p_workflow_flags) key where not key = any(v_allowed_keys))
    or exists(select 1 from jsonb_each(p_workflow_flags) entry where jsonb_typeof(entry.value) <> 'boolean')
    or p_daily_run_limit not between 1 and 100000 then
    raise exception 'invalid AI review settings' using errcode = '22023';
  end if;
  update private.ai_review_settings
  set global_enabled = p_global_enabled,
      auto_run_enabled = p_auto_run_enabled,
      admin_visible = p_admin_visible,
      admin_apply_enabled = p_admin_apply_enabled,
      workflow_flags = p_workflow_flags,
      daily_run_limit = p_daily_run_limit,
      configured_by = auth.uid(),
      configured_at = now()
  where singleton;
  return public.admin_get_ai_settings();
end;
$$;

create or replace function public.admin_save_ai_store_scope(
  p_store_id uuid,
  p_enabled boolean,
  p_workflow_flags jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed_keys constant text[] := array[
    'product', 'product_creation_request', 'arrival_report',
    'inventory', 'order', 'v2_task'
  ];
begin
  if public.current_user_role() <> 'admin' or not public.has_store_access(p_store_id) then
    raise exception 'administrator store access required' using errcode = '42501';
  end if;
  if not exists(select 1 from public.ai_pilot_stores where store_id = p_store_id) then
    raise exception 'store is outside the AI pilot scope' using errcode = '42501';
  end if;
  if jsonb_typeof(p_workflow_flags) <> 'object'
    or exists(select 1 from jsonb_object_keys(p_workflow_flags) key where not key = any(v_allowed_keys))
    or exists(select 1 from jsonb_each(p_workflow_flags) entry where jsonb_typeof(entry.value) <> 'boolean') then
    raise exception 'invalid AI store workflow settings' using errcode = '22023';
  end if;
  update public.ai_pilot_stores
  set enabled = p_enabled,
      workflow_flags = p_workflow_flags,
      configured_by = auth.uid(),
      configured_at = now()
  where store_id = p_store_id;
  return jsonb_build_object(
    'store_id', p_store_id,
    'enabled', p_enabled,
    'workflow_flags', p_workflow_flags
  );
end;
$$;

create or replace function public.configure_ai_review_automation()
returns jsonb
language plpgsql
security definer
set search_path = public, private, cron
as $$
declare
  v_issuer text;
  v_url text;
  v_token text;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;
  v_issuer := coalesce(auth.jwt() ->> 'iss', '');
  if v_issuer !~ '^https://[a-z0-9-]+\.supabase\.co/auth/v1/?$' then
    raise exception 'unable to determine Supabase project URL' using errcode = '22023';
  end if;
  v_url := regexp_replace(v_issuer, '/auth/v1/?$', '/functions/v1/ai-review');
  select cron_token into v_token
  from private.ai_review_settings where singleton;
  v_token := coalesce(v_token, gen_random_uuid()::text || gen_random_uuid()::text);
  update private.ai_review_settings
  set function_url = v_url,
      cron_token = v_token,
      last_dispatched_at = null,
      configured_by = auth.uid(),
      configured_at = now()
  where singleton;
  perform cron.unschedule(jobid)
  from cron.job where jobname = 'storehub-ai-review-queue';
  perform cron.schedule(
    'storehub-ai-review-queue',
    '* * * * *',
    $cron$select private.dispatch_ai_review_queue();$cron$
  );
  return jsonb_build_object('configured', true, 'function_url', v_url);
end;
$$;

create or replace function public.verify_ai_review_cron_token(p_token text)
returns boolean
language sql
security definer
set search_path = private
stable
as $$
  select exists(
    select 1 from private.ai_review_settings
    where singleton and global_enabled and cron_token = coalesce(p_token, '')
  )
$$;

create or replace function public.admin_ensure_ai_review(
  p_store_id uuid,
  p_workflow text,
  p_entity_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if public.current_user_role() <> 'admin'
    or not public.has_store_access(p_store_id)
    or not public.ai_review_is_enabled(p_store_id, p_workflow, true, false) then
    raise exception 'administrator AI review access required' using errcode = '42501';
  end if;
  return private.ai_enqueue_review(
    p_store_id, p_workflow, p_entity_id, 'ensure', null, auth.uid(), null, false
  );
end;
$$;

create or replace function public.admin_rerun_ai_review(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_run public.ai_review_runs%rowtype;
begin
  select * into v_run from public.ai_review_runs where id = p_run_id;
  if v_run.id is null then
    raise exception 'AI review run not found' using errcode = 'P0002';
  end if;
  if not public.can_admin_access_ai_store(v_run.store_id)
    or not public.ai_review_is_enabled(v_run.store_id, v_run.workflow, true, false) then
    raise exception 'administrator AI review access required' using errcode = '42501';
  end if;
  if v_run.trigger_type = 'draft' then
    return private.ai_enqueue_review(
      v_run.store_id, v_run.workflow, v_run.entity_id, 'draft',
      v_run.source_context, auth.uid(), v_run.id, true
    );
  end if;
  return private.ai_enqueue_review(
    v_run.store_id, v_run.workflow, v_run.entity_id, 'rerun',
    null, auth.uid(), v_run.id, true
  );
end;
$$;

create or replace function public.admin_ai_check_product_draft(
  p_store_id uuid,
  p_product_id uuid default null,
  p_draft jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_allowed_keys constant text[] := array['name', 'spec', 'countUnit', 'categoryCode'];
  v_context jsonb;
begin
  if public.current_user_role() <> 'admin'
    or not public.has_store_access(p_store_id)
    or not public.ai_review_is_enabled(p_store_id, 'product', true, false) then
    raise exception 'administrator AI review access required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_draft) <> 'object'
    or exists(select 1 from jsonb_object_keys(p_draft) key where not key = any(v_allowed_keys))
    or nullif(btrim(p_draft ->> 'name'), '') is null
    or nullif(btrim(p_draft ->> 'spec'), '') is null
    or nullif(btrim(p_draft ->> 'countUnit'), '') is null
    or nullif(btrim(p_draft ->> 'categoryCode'), '') is null then
    raise exception 'invalid structured product draft' using errcode = '22023';
  end if;
  if not exists(select 1 from public.product_categories where code = p_draft ->> 'categoryCode') then
    raise exception 'invalid product category' using errcode = '22023';
  end if;
  if p_product_id is not null and not exists(
    select 1 from public.products where id = p_product_id and store_id = p_store_id
  ) then
    raise exception 'product draft target does not belong to the store' using errcode = '23514';
  end if;
  v_context := jsonb_build_object(
    'workflow', 'product',
    'storeId', p_store_id,
    'entityId', p_product_id,
    'sourceVersion', private.ai_context_hash(p_draft),
    'product', jsonb_build_object(
      'productId', p_product_id,
      'label', btrim(p_draft ->> 'name'),
      'spec', btrim(p_draft ->> 'spec'),
      'countUnit', btrim(p_draft ->> 'countUnit'),
      'categoryCode', btrim(p_draft ->> 'categoryCode'),
      'isActive', true
    ),
    'catalog', private.ai_product_catalog(p_store_id, p_product_id)
  );
  return private.ai_enqueue_review(
    p_store_id, 'product', p_product_id, 'draft', v_context,
    auth.uid(), null, false
  );
end;
$$;

create or replace function private.ai_claim_one(
  p_run_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_job public.ai_review_queue%rowtype;
  v_run public.ai_review_runs%rowtype;
begin
  update public.ai_review_queue queue
  set status = 'queued', locked_at = null, locked_by = null
  from public.ai_review_runs run
  where queue.run_id = run.id
    and queue.status = 'running'
    and queue.locked_at < now() - interval '5 minutes'
    and run.status = 'running';
  update public.ai_review_runs run
  set status = 'queued', started_at = null
  from public.ai_review_queue queue
  where queue.run_id = run.id
    and queue.status = 'queued'
    and run.status = 'running';

  select * into v_job
  from public.ai_review_queue
  where (p_run_id is null or run_id = p_run_id)
    and status = 'queued'
    and available_at <= now()
  order by created_at, id
  limit 1
  for update skip locked;
  if v_job.id is null then return null; end if;

  update public.ai_review_queue
  set status = 'running', attempts = attempts + 1,
      locked_at = now(), locked_by = nullif(btrim(coalesce(p_worker_id, '')), '')
  where id = v_job.id
  returning * into v_job;
  update public.ai_review_runs
  set status = 'running', started_at = coalesce(started_at, now()),
      error_code = null, error_message = null
  where id = v_job.run_id
  returning * into v_run;
  insert into public.ai_suggestion_events(run_id, store_id, event_type, metadata)
  values(v_run.id, v_run.store_id, 'started', jsonb_build_object(
    'attempt', v_job.attempts, 'workerId', v_job.locked_by
  ));
  return jsonb_build_object(
    'job_id', v_job.id,
    'run_id', v_run.id,
    'store_id', v_run.store_id,
    'workflow', v_run.workflow,
    'entity_id', v_run.entity_id,
    'entity_version', v_run.entity_version,
    'source_hash', v_run.source_hash,
    'context', v_run.source_context,
    'attempt', v_job.attempts,
    'trigger_type', v_run.trigger_type
  );
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
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return private.ai_claim_one(p_run_id, p_worker_id);
end;
$$;

create or replace function private.ai_assert_current_source(p_run public.ai_review_runs)
returns boolean
language plpgsql
security definer
set search_path = public, private
stable
as $$
declare
  v_current_context jsonb;
begin
  if p_run.trigger_type = 'draft' then return true; end if;
  begin
    v_current_context := private.ai_build_context(p_run.store_id, p_run.workflow, p_run.entity_id);
  exception when others then
    return false;
  end;
  return private.ai_context_hash(v_current_context) = p_run.source_hash;
end;
$$;

create or replace function public.complete_ai_review_run(
  p_run_id uuid,
  p_suggestions jsonb,
  p_model text,
  p_system_fingerprint text,
  p_usage jsonb,
  p_latency_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_run public.ai_review_runs%rowtype;
  v_entry jsonb;
  v_suggestion_id uuid;
  v_summary text;
  v_count integer := 0;
  v_action_type text;
  v_draft_patch jsonb;
  v_allowed_keys constant text[] := array[
    'code', 'issue_type', 'severity', 'title', 'explanation', 'rationale',
    'field_path', 'current_value', 'suggested_value', 'action_type',
    'action_payload', 'draft_patch', 'confidence'
  ];
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_suggestions) <> 'array' or jsonb_array_length(p_suggestions) > 100 then
    raise exception 'invalid AI suggestion array' using errcode = '22023';
  end if;
  select * into v_run from public.ai_review_runs where id = p_run_id for update;
  if v_run.id is null then raise exception 'AI review run not found' using errcode = 'P0002'; end if;
  if v_run.status <> 'running' then
    raise exception 'AI review run is not claimed' using errcode = '55000';
  end if;
  if not private.ai_assert_current_source(v_run) then
    update public.ai_review_runs set status = 'stale', completed_at = now() where id = v_run.id;
    update public.ai_review_queue set status = 'cancelled' where run_id = v_run.id;
    update public.ai_suggestions set status = 'stale' where run_id = v_run.id;
    insert into public.ai_suggestion_events(run_id, store_id, event_type)
    values(v_run.id, v_run.store_id, 'stale');
    return jsonb_build_object('run_id', v_run.id, 'status', 'stale', 'suggestion_count', 0);
  end if;

  delete from public.ai_suggestions where run_id = v_run.id;
  for v_entry in select value from jsonb_array_elements(p_suggestions)
  loop
    if jsonb_typeof(v_entry) <> 'object'
      or exists(select 1 from jsonb_object_keys(v_entry) key where not key = any(v_allowed_keys))
      or coalesce(v_entry ->> 'severity', '') not in ('info', 'warning', 'critical')
      or coalesce(v_entry ->> 'action_type', '') not in (
        'review', 'replace_fields', 'use_existing_product',
        'edit_quantity', 'mark_no_order_needed'
      )
      or nullif(btrim(coalesce(v_entry ->> 'title', '')), '') is null
      or nullif(btrim(coalesce(v_entry ->> 'explanation', v_entry ->> 'rationale', '')), '') is null
      or coalesce(jsonb_typeof(coalesce(v_entry -> 'action_payload', v_entry -> 'draft_patch', '{}'::jsonb)), 'object') <> 'object'
      or coalesce((v_entry ->> 'confidence')::numeric, 0.5) not between 0 and 1 then
      raise exception 'invalid AI suggestion payload' using errcode = '22023';
    end if;
    v_action_type := v_entry ->> 'action_type';
    v_draft_patch := coalesce(v_entry -> 'action_payload', v_entry -> 'draft_patch', '{}'::jsonb);
    if (v_action_type = 'review' and v_draft_patch <> '{}'::jsonb)
      or (v_action_type = 'replace_fields' and exists(
        select 1 from jsonb_object_keys(v_draft_patch) key
        where key not in ('category_code', 'count_unit', 'name', 'spec')
      ))
      or (v_action_type = 'use_existing_product' and exists(
        select 1 from jsonb_object_keys(v_draft_patch) key where key <> 'product_id'
      ))
      or (v_action_type = 'edit_quantity' and exists(
        select 1 from jsonb_object_keys(v_draft_patch) key where key not in ('item_id', 'quantity')
      ))
      or (v_action_type = 'mark_no_order_needed' and exists(
        select 1 from jsonb_object_keys(v_draft_patch) key where key <> 'item_id'
      ))
      or (v_run.workflow in ('product', 'product_creation_request')
        and v_action_type not in ('review', 'replace_fields', 'use_existing_product'))
      or (v_run.workflow = 'arrival_report'
        and v_action_type not in ('review', 'replace_fields', 'use_existing_product', 'edit_quantity'))
      or (v_run.workflow = 'inventory'
        and v_action_type not in ('review', 'use_existing_product', 'edit_quantity'))
      or (v_run.workflow = 'order'
        and v_action_type not in ('review', 'edit_quantity', 'mark_no_order_needed'))
      or (v_run.workflow = 'v2_task' and v_action_type <> 'review') then
      raise exception 'AI suggestion action is outside the workflow draft allowlist'
        using errcode = '22023';
    end if;
    insert into public.ai_suggestions(
      run_id, store_id, issue_type, severity, title, field_path,
      current_value, suggested_value, rationale, confidence,
      action_type, draft_patch, source_hash
    ) values (
      v_run.id, v_run.store_id,
      coalesce(nullif(btrim(v_entry ->> 'issue_type'), ''), nullif(btrim(v_entry ->> 'code'), ''), 'review'),
      v_entry ->> 'severity', left(btrim(v_entry ->> 'title'), 300),
      nullif(btrim(v_entry ->> 'field_path'), ''),
      v_entry -> 'current_value', v_entry -> 'suggested_value',
      left(btrim(coalesce(v_entry ->> 'explanation', v_entry ->> 'rationale')), 2000),
      coalesce((v_entry ->> 'confidence')::numeric, 0.5),
      v_action_type, v_draft_patch,
      v_run.source_hash
    ) returning id into v_suggestion_id;
    v_count := v_count + 1;
  end loop;
  select string_agg(title, '；' order by
    case severity when 'critical' then 3 when 'warning' then 2 else 1 end desc,
    created_at, id)
  into v_summary
  from (select * from public.ai_suggestions where run_id = v_run.id limit 3) top_suggestions;
  update public.ai_review_runs
  set status = 'completed', model = nullif(btrim(coalesce(p_model, '')), ''),
      system_fingerprint = nullif(btrim(coalesce(p_system_fingerprint, '')), ''),
      usage = coalesce(p_usage, '{}'::jsonb), latency_ms = p_latency_ms,
      summary = coalesce(v_summary, '未发现需要提醒的问题'),
      completed_at = now(), error_code = null, error_message = null
  where id = v_run.id
  returning * into v_run;
  update public.ai_review_queue
  set status = 'succeeded', locked_at = null, locked_by = null
  where run_id = v_run.id;
  insert into public.ai_suggestion_events(run_id, store_id, event_type, metadata)
  values(v_run.id, v_run.store_id, 'completed', jsonb_build_object(
    'suggestionCount', v_count, 'model', p_model, 'latencyMs', p_latency_ms
  ));
  return jsonb_build_object(
    'run_id', v_run.id, 'status', v_run.status,
    'suggestion_count', v_count, 'summary', v_run.summary
  );
end;
$$;

create or replace function public.fail_ai_review_run(
  p_run_id uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean,
  p_next_retry_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.ai_review_runs%rowtype;
  v_attempts integer;
  v_retry boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into v_run from public.ai_review_runs where id = p_run_id for update;
  if v_run.id is null then raise exception 'AI review run not found' using errcode = 'P0002'; end if;
  if v_run.status in ('completed', 'skipped', 'stale') then
    return jsonb_build_object(
      'run_id', v_run.id, 'status', v_run.status,
      'retryable', false, 'attempt', 0
    );
  end if;
  select attempts into v_attempts from public.ai_review_queue where run_id = v_run.id for update;
  v_retry := coalesce(p_retryable, false) and coalesce(v_attempts, 0) < 3;
  update public.ai_review_runs
  set status = case when v_retry then 'queued' else 'failed' end,
      error_code = left(coalesce(p_error_code, 'unknown'), 100),
      error_message = left(coalesce(p_error_message, 'AI review failed'), 1000),
      completed_at = case when v_retry then null else now() end,
      started_at = case when v_retry then null else started_at end
  where id = v_run.id
  returning * into v_run;
  update public.ai_review_queue
  set status = case when v_retry then 'queued' else 'failed' end,
      available_at = case when v_retry then coalesce(p_next_retry_at, now() + interval '1 minute') else available_at end,
      locked_at = null, locked_by = null,
      last_error = left(coalesce(p_error_message, 'AI review failed'), 1000)
  where run_id = v_run.id;
  insert into public.ai_suggestion_events(run_id, store_id, event_type, metadata)
  values(v_run.id, v_run.store_id,
    case when v_retry then 'retry_scheduled' else 'failed' end,
    jsonb_build_object('errorCode', p_error_code, 'retryable', v_retry, 'attempt', v_attempts)
  );
  return jsonb_build_object(
    'run_id', v_run.id, 'status', v_run.status,
    'retryable', v_retry, 'attempt', v_attempts
  );
end;
$$;

create or replace function public.admin_ai_list_reviews(
  p_store_ids uuid[] default null,
  p_workflow text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
  v_total integer;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 100 or p_offset < 0
    or (p_workflow is not null and p_workflow not in (
      'product', 'product_creation_request', 'arrival_report',
      'inventory', 'order', 'v2_task'
    ))
    or (p_status is not null and p_status not in (
      'queued', 'running', 'completed', 'failed', 'skipped', 'stale'
    )) then
    raise exception 'invalid AI review list filter' using errcode = '22023';
  end if;

  select count(*)::integer into v_total
  from public.ai_review_runs run
  where public.can_admin_access_ai_store(run.store_id)
    and (p_store_ids is null or run.store_id = any(p_store_ids))
    and (p_workflow is null or run.workflow = p_workflow)
    and (p_status is null or run.status = p_status);

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.created_at desc, row_data.run_id desc), '[]'::jsonb)
  into v_result
  from (
    select run.id as run_id, run.store_id, store.name as store_name,
      run.workflow, run.entity_id, run.status,
      case
        when bool_or(suggestion.severity = 'critical') then 'critical'
        when bool_or(suggestion.severity = 'warning') then 'warning'
        when bool_or(suggestion.severity = 'info') then 'info'
        else null
      end as max_severity,
      run.summary,
      count(suggestion.id)::integer as suggestion_count,
      count(suggestion.id) filter (where suggestion.status = 'pending')::integer as pending_count,
      run.created_at, run.started_at, run.completed_at,
      run.error_code, run.error_message, run.model, run.trigger_type
    from public.ai_review_runs run
    join public.stores store on store.id = run.store_id
    left join public.ai_suggestions suggestion on suggestion.run_id = run.id
    where public.can_admin_access_ai_store(run.store_id)
      and (p_store_ids is null or run.store_id = any(p_store_ids))
      and (p_workflow is null or run.workflow = p_workflow)
      and (p_status is null or run.status = p_status)
    group by run.id, store.name
    order by run.created_at desc, run.id desc
    limit p_limit offset p_offset
  ) row_data;
  return jsonb_build_object('items', v_result, 'total', v_total, 'limit', p_limit, 'offset', p_offset);
end;
$$;

create or replace function public.admin_ai_get_review(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_run public.ai_review_runs%rowtype;
begin
  select * into v_run from public.ai_review_runs where id = p_run_id;
  if v_run.id is null then raise exception 'AI review run not found' using errcode = 'P0002'; end if;
  if not public.can_admin_access_ai_store(v_run.store_id) then
    raise exception 'administrator AI review access required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'run', to_jsonb(v_run) || jsonb_build_object(
      'run_id', v_run.id,
      'store_name', (select name from public.stores where id = v_run.store_id),
      'suggestion_count', (select count(*)::integer from public.ai_suggestions where run_id = v_run.id),
      'pending_count', (select count(*)::integer from public.ai_suggestions where run_id = v_run.id and status = 'pending'),
      'max_severity', (
        select case
          when bool_or(severity = 'critical') then 'critical'
          when bool_or(severity = 'warning') then 'warning'
          when bool_or(severity = 'info') then 'info'
          else null
        end
        from public.ai_suggestions where run_id = v_run.id
      )
    ),
    'suggestions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', suggestion.id,
        'severity', suggestion.severity,
        'issue_type', suggestion.issue_type,
        'title', suggestion.title,
        'field_path', suggestion.field_path,
        'current_value', suggestion.current_value,
        'suggested_value', suggestion.suggested_value,
        'rationale', suggestion.rationale,
        'confidence', suggestion.confidence,
        'status', suggestion.status,
        'action_type', suggestion.action_type,
        'draft_patch', suggestion.draft_patch,
        'source_hash', suggestion.source_hash,
        'created_at', suggestion.created_at
      ) order by case suggestion.severity when 'critical' then 3 when 'warning' then 2 else 1 end desc,
        suggestion.created_at, suggestion.id)
      from public.ai_suggestions suggestion where suggestion.run_id = v_run.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(to_jsonb(event) order by event.created_at, event.id)
      from public.ai_suggestion_events event where event.run_id = v_run.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_ai_skip_review(
  p_run_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.ai_review_runs%rowtype;
begin
  select * into v_run from public.ai_review_runs where id = p_run_id for update;
  if v_run.id is null then raise exception 'AI review run not found' using errcode = 'P0002'; end if;
  if not public.can_admin_access_ai_store(v_run.store_id) then
    raise exception 'administrator AI review access required' using errcode = '42501';
  end if;
  if v_run.status not in ('queued', 'running') then
    return to_jsonb(v_run);
  end if;
  update public.ai_review_runs
  set status = 'skipped', skipped_at = now(), completed_at = now()
  where id = v_run.id returning * into v_run;
  update public.ai_review_queue
  set status = 'cancelled', locked_at = null, locked_by = null
  where run_id = v_run.id and status in ('queued', 'running');
  insert into public.ai_suggestion_events(run_id, store_id, actor_id, event_type, metadata)
  values(v_run.id, v_run.store_id, auth.uid(), 'skipped', jsonb_build_object(
    'reason', left(nullif(btrim(coalesce(p_reason, '')), ''), 500)
  ));
  return to_jsonb(v_run);
end;
$$;

create or replace function public.admin_ai_act_on_suggestion(
  p_suggestion_id uuid,
  p_action text,
  p_note text default null,
  p_expected_source_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_suggestion public.ai_suggestions%rowtype;
  v_run public.ai_review_runs%rowtype;
  v_target_status text;
  v_event_type text;
begin
  select * into v_suggestion from public.ai_suggestions where id = p_suggestion_id for update;
  if v_suggestion.id is null then raise exception 'AI suggestion not found' using errcode = 'P0002'; end if;
  select * into v_run from public.ai_review_runs where id = v_suggestion.run_id for update;
  if not public.can_admin_access_ai_store(v_run.store_id) then
    raise exception 'administrator AI suggestion access required' using errcode = '42501';
  end if;
  if p_expected_source_hash is not null and p_expected_source_hash <> v_suggestion.source_hash then
    raise exception 'AI suggestion source changed' using errcode = '40001';
  end if;
  if v_run.status <> 'completed' or not private.ai_assert_current_source(v_run) then
    update public.ai_review_runs set status = 'stale', completed_at = coalesce(completed_at, now()) where id = v_run.id;
    update public.ai_suggestions set status = 'stale' where run_id = v_run.id;
    insert into public.ai_suggestion_events(run_id, suggestion_id, store_id, actor_id, event_type)
    values(v_run.id, v_suggestion.id, v_run.store_id, auth.uid(), 'stale');
    return jsonb_build_object(
      'suggestion_id', v_suggestion.id,
      'run_id', v_run.id,
      'status', 'stale',
      'draft_patch', '{}'::jsonb
    );
  end if;
  if p_action = 'apply_to_draft' then
    if not public.ai_review_is_enabled(v_run.store_id, v_run.workflow, true, true) then
      raise exception 'administrator AI draft application is disabled' using errcode = '42501';
    end if;
    v_target_status := 'applied_to_draft';
    v_event_type := 'applied_to_draft';
  elsif p_action = 'ignore' then
    v_target_status := 'ignored';
    v_event_type := 'ignored';
  elsif p_action = 'restore' then
    v_target_status := 'pending';
    v_event_type := 'restored';
  else
    raise exception 'invalid AI suggestion action' using errcode = '22023';
  end if;
  update public.ai_suggestions set status = v_target_status
  where id = v_suggestion.id returning * into v_suggestion;
  insert into public.ai_suggestion_events(
    run_id, suggestion_id, store_id, actor_id, event_type, metadata
  ) values (
    v_run.id, v_suggestion.id, v_run.store_id, auth.uid(), v_event_type,
    jsonb_build_object('note', left(nullif(btrim(coalesce(p_note, '')), ''), 2000))
  );
  return jsonb_build_object(
    'suggestion_id', v_suggestion.id,
    'run_id', v_run.id,
    'status', v_suggestion.status,
    'action_type', v_suggestion.action_type,
    'draft_patch', v_suggestion.draft_patch,
    'target', jsonb_build_object(
      'workflow', v_run.workflow,
      'entity_id', v_run.entity_id,
      'store_id', v_run.store_id,
      'source_hash', v_run.source_hash
    )
  );
end;
$$;

create or replace function private.ai_auto_enqueue_entity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_workflow text;
  v_result jsonb;
begin
  if tg_table_name = 'arrival_reports' then
    if new.status not in ('submitted', 'viewed') then
      return new;
    end if;
    if tg_op = 'UPDATE'
      and old.status in ('submitted', 'viewed')
      and old.generated_summary is not distinct from new.generated_summary
      and old.arrival_date is not distinct from new.arrival_date then
      return new;
    end if;
    v_workflow := 'arrival_report';
  elsif tg_table_name = 'tasks' then
    if new.status <> 'submitted'
      or (tg_op = 'UPDATE' and old.status = 'submitted') then
      return new;
    end if;
    v_workflow := new.task_type;
  elsif tg_table_name = 'v2_tasks' then
    if new.status not in ('submitted', 'resubmitted', 'approved')
      or (tg_op = 'UPDATE' and old.status = new.status and old.version = new.version) then
      return new;
    end if;
    v_workflow := 'v2_task';
  elsif tg_table_name = 'product_creation_requests' then
    if new.status <> 'pending' then return new; end if;
    v_workflow := 'product_creation_request';
  elsif tg_table_name = 'products' then
    if tg_op = 'UPDATE'
      and row(old.name, old.spec, old.count_unit, old.category_code, old.is_active)
          is not distinct from
          row(new.name, new.spec, new.count_unit, new.category_code, new.is_active) then
      return new;
    end if;
    v_workflow := 'product';
  else
    return new;
  end if;

  if public.ai_review_is_enabled(new.store_id, v_workflow, false, false) then
    begin
      v_result := private.ai_enqueue_review(
        new.store_id, v_workflow, new.id, 'auto', null, null, null, false
      );
    exception when others then
      -- AI is deliberately fail-open. Business submissions and edits must never
      -- be rolled back because a pilot queue or context builder failed.
      raise warning 'AI review enqueue failed for %.%: %', tg_table_name, new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

create trigger arrival_reports_ai_review_enqueue
after insert or update of status, generated_summary, arrival_date on public.arrival_reports
for each row execute function private.ai_auto_enqueue_entity();
create trigger tasks_ai_review_enqueue
after insert or update of status on public.tasks
for each row execute function private.ai_auto_enqueue_entity();
create trigger v2_tasks_ai_review_enqueue
after insert or update of status, version on public.v2_tasks
for each row execute function private.ai_auto_enqueue_entity();
create trigger product_creation_requests_ai_review_enqueue
after insert or update of status, name, spec, count_unit, category_code
on public.product_creation_requests
for each row execute function private.ai_auto_enqueue_entity();
create trigger products_ai_review_enqueue
after insert or update of name, spec, count_unit, category_code, is_active
on public.products
for each row execute function private.ai_auto_enqueue_entity();

revoke all on function private.ai_claim_one(uuid, text),
  private.ai_assert_current_source(public.ai_review_runs),
  private.ai_auto_enqueue_entity()
from public, anon, authenticated;

revoke all on function public.admin_get_ai_settings(),
  public.admin_save_ai_settings(boolean, boolean, boolean, boolean, jsonb, integer),
  public.admin_save_ai_store_scope(uuid, boolean, jsonb),
  public.configure_ai_review_automation(),
  public.verify_ai_review_cron_token(text),
  public.admin_ensure_ai_review(uuid, text, uuid),
  public.admin_rerun_ai_review(uuid),
  public.admin_ai_check_product_draft(uuid, uuid, jsonb),
  public.claim_ai_review_jobs(integer, text),
  public.claim_ai_review_run(uuid, text),
  public.complete_ai_review_run(uuid, jsonb, text, text, jsonb, integer),
  public.fail_ai_review_run(uuid, text, text, boolean, timestamptz),
  public.admin_ai_list_reviews(uuid[], text, text, integer, integer),
  public.admin_ai_get_review(uuid),
  public.admin_ai_skip_review(uuid, text),
  public.admin_ai_act_on_suggestion(uuid, text, text, text)
from public, anon, authenticated;

grant execute on function public.admin_get_ai_settings(),
  public.admin_save_ai_settings(boolean, boolean, boolean, boolean, jsonb, integer),
  public.admin_save_ai_store_scope(uuid, boolean, jsonb),
  public.configure_ai_review_automation(),
  public.admin_ensure_ai_review(uuid, text, uuid),
  public.admin_rerun_ai_review(uuid),
  public.admin_ai_check_product_draft(uuid, uuid, jsonb),
  public.admin_ai_list_reviews(uuid[], text, text, integer, integer),
  public.admin_ai_get_review(uuid),
  public.admin_ai_skip_review(uuid, text),
  public.admin_ai_act_on_suggestion(uuid, text, text, text)
to authenticated;

grant execute on function public.verify_ai_review_cron_token(text),
  public.claim_ai_review_jobs(integer, text),
  public.claim_ai_review_run(uuid, text),
  public.complete_ai_review_run(uuid, jsonb, text, text, jsonb, integer),
  public.fail_ai_review_run(uuid, text, text, boolean, timestamptz)
to service_role;

create or replace function public.admin_ai_backfill_pilot(
  p_days integer default 60,
  p_limit integer default 1500
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_entity record;
  v_result jsonb;
  v_examined integer := 0;
  v_queued integer := 0;
  v_deduplicated integer := 0;
  v_disabled integer := 0;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;
  if p_days not between 1 and 365 or p_limit not between 1 and 2000 then
    raise exception 'invalid AI pilot backfill bounds' using errcode = '22023';
  end if;
  for v_entity in
    select candidates.store_id, candidates.workflow, candidates.entity_id
    from (
      select product.store_id, 'product'::text as workflow,
        product.id as entity_id, 10 as priority, product.updated_at as event_at
      from public.products product
      join public.ai_pilot_stores scope on scope.store_id = product.store_id and scope.enabled
      where product.is_active and public.has_store_access(product.store_id)
      union all
      select request.store_id, 'product_creation_request', request.id,
        20, request.updated_at
      from public.product_creation_requests request
      join public.ai_pilot_stores scope on scope.store_id = request.store_id and scope.enabled
      where request.status = 'pending' and public.has_store_access(request.store_id)
      union all
      select report.store_id, 'arrival_report', report.id,
        30, coalesce(report.submitted_at, report.updated_at)
      from public.arrival_reports report
      join public.ai_pilot_stores scope on scope.store_id = report.store_id and scope.enabled
      where report.status in ('submitted', 'viewed')
        and report.arrival_date >= current_date - p_days
        and public.has_store_access(report.store_id)
      union all
      select task.store_id, task.task_type, task.id,
        case when task.task_type = 'inventory' then 40 else 50 end,
        coalesce(task.submitted_at, task.updated_at)
      from public.tasks task
      join public.ai_pilot_stores scope on scope.store_id = task.store_id and scope.enabled
      where task.status = 'submitted'
        and task.task_type in ('inventory', 'order')
        and task.submitted_at >= now() - make_interval(days => p_days)
        and public.has_store_access(task.store_id)
    ) candidates
    order by candidates.priority, candidates.event_at desc, candidates.entity_id
    limit p_limit
  loop
    v_examined := v_examined + 1;
    begin
      v_result := private.ai_enqueue_review(
        v_entity.store_id, v_entity.workflow, v_entity.entity_id,
        'ensure', null, auth.uid(), null, false
      );
      if coalesce((v_result ->> 'deduplicated')::boolean, false) then
        v_deduplicated := v_deduplicated + 1;
      elsif v_result ->> 'status' = 'queued' then
        v_queued := v_queued + 1;
      else
        v_disabled := v_disabled + 1;
      end if;
    exception when others then
      -- A malformed historical row must not abort the rest of the bounded backfill.
      v_disabled := v_disabled + 1;
      raise warning 'AI pilot backfill skipped %.%: %', v_entity.workflow, v_entity.entity_id, sqlerrm;
    end;
  end loop;
  perform private.dispatch_ai_review_queue();
  return jsonb_build_object(
    'examined', v_examined,
    'queued', v_queued,
    'deduplicated', v_deduplicated,
    'skipped', v_disabled,
    'days', p_days,
    'limit', p_limit
  );
end;
$$;

revoke all on function public.admin_ai_backfill_pilot(integer, integer)
from public, anon, authenticated;
grant execute on function public.admin_ai_backfill_pilot(integer, integer)
to authenticated;

-- Reuse an already-configured project function origin when available. The
-- token is dedicated to AI review and is validated by the database, so no API
-- provider secret is stored in SQL or exposed to browser clients.
do $$
declare
  v_function_url text;
begin
  select regexp_replace(source.function_url, '/functions/v1/[^/]+$', '/functions/v1/ai-review')
  into v_function_url
  from (
    select function_url from private.attendance_automation_config
    where singleton and function_url is not null
    union all
    select function_url from private.pos_sales_automation_config
    where singleton and function_url is not null
  ) source
  limit 1;

  if v_function_url is not null then
    update private.ai_review_settings
    set function_url = coalesce(function_url, v_function_url),
        cron_token = coalesce(cron_token, gen_random_uuid()::text || gen_random_uuid()::text),
        last_dispatched_at = null
    where singleton;
  end if;

  perform cron.unschedule(jobid)
  from cron.job where jobname = 'storehub-ai-review-queue';
  perform cron.schedule(
    'storehub-ai-review-queue',
    '* * * * *',
    $cron$select private.dispatch_ai_review_queue();$cron$
  );
end;
$$;

-- Bounded initial coverage for both scoped stores: every active product and
-- pending product request, plus sixty days of effective structured workflows.
do $$
declare
  v_entity record;
begin
  for v_entity in
    select candidates.store_id, candidates.workflow, candidates.entity_id
    from (
      select product.store_id, 'product'::text as workflow,
        product.id as entity_id, 10 as priority, product.updated_at as event_at
      from public.products product
      join public.ai_pilot_stores scope on scope.store_id = product.store_id and scope.enabled
      where product.is_active
      union all
      select request.store_id, 'product_creation_request', request.id,
        20, request.updated_at
      from public.product_creation_requests request
      join public.ai_pilot_stores scope on scope.store_id = request.store_id and scope.enabled
      where request.status = 'pending'
      union all
      select report.store_id, 'arrival_report', report.id,
        30, coalesce(report.submitted_at, report.updated_at)
      from public.arrival_reports report
      join public.ai_pilot_stores scope on scope.store_id = report.store_id and scope.enabled
      where report.status in ('submitted', 'viewed')
        and report.arrival_date >= current_date - 60
      union all
      select task.store_id, task.task_type, task.id,
        case when task.task_type = 'inventory' then 40 else 50 end,
        coalesce(task.submitted_at, task.updated_at)
      from public.tasks task
      join public.ai_pilot_stores scope on scope.store_id = task.store_id and scope.enabled
      where task.status = 'submitted'
        and task.task_type in ('inventory', 'order')
        and task.submitted_at >= now() - interval '60 days'
    ) candidates
    order by candidates.priority, candidates.event_at desc, candidates.entity_id
    limit 1500
  loop
    begin
      perform private.ai_enqueue_review(
        v_entity.store_id, v_entity.workflow, v_entity.entity_id,
        'auto', null, null, null, false
      );
    exception when others then
      raise warning 'Initial AI review backfill skipped %.%: %',
        v_entity.workflow, v_entity.entity_id, sqlerrm;
    end;
  end loop;
  perform private.dispatch_ai_review_queue();
end;
$$;
