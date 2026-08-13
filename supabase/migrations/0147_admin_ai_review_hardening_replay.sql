-- Replay the administrator AI review hardening after the development 0145
-- migration was recorded inside an explicit transaction that rolled back.
-- Every statement remains idempotent when production already has the 0145
-- hardening, and pilot membership remains an explicit UUID allowlist.

drop trigger if exists stores_initialize_ai_pilot_scope on public.stores;
drop function if exists private.ai_sync_named_pilot_store();

-- Defense-in-depth hardening for the administrator AI review pilot.
-- Keep browser-visible configuration private, make enqueue idempotency safe
-- under concurrent requests, and validate every persisted draft action at the
-- database boundary.

revoke all on function public.ai_review_is_enabled(uuid, text, boolean, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.ai_review_is_enabled(uuid, text, boolean, boolean)
to service_role;

revoke all on function public.can_admin_access_ai_store(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.can_admin_access_ai_store(uuid)
to authenticated, service_role;

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

  -- Build persisted-entity context only after competing requests for the same
  -- entity have finished, so a waiter does not enqueue a context captured
  -- before the transaction that won the lock.
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

create or replace function private.ai_validate_suggestion_draft_patch()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_run public.ai_review_runs%rowtype;
  v_key text;
  v_value jsonb;
  v_key_count integer;
  v_target_id uuid;
  v_quantity numeric;
begin
  select * into v_run from public.ai_review_runs where id = new.run_id;
  if v_run.id is null
    or new.store_id <> v_run.store_id
    or new.source_hash <> v_run.source_hash then
    raise exception 'AI suggestion scope does not match its review run' using errcode = '23514';
  end if;
  if jsonb_typeof(new.draft_patch) <> 'object' then
    raise exception 'AI suggestion draft patch must be an object' using errcode = '22023';
  end if;

  if (v_run.workflow in ('product', 'product_creation_request')
      and new.action_type not in ('review', 'replace_fields', 'use_existing_product'))
    or (v_run.workflow = 'arrival_report'
      and new.action_type not in ('review', 'replace_fields', 'use_existing_product', 'edit_quantity'))
    or (v_run.workflow = 'inventory'
      and new.action_type not in ('review', 'use_existing_product', 'edit_quantity'))
    or (v_run.workflow = 'order'
      and new.action_type not in ('review', 'edit_quantity', 'mark_no_order_needed'))
    or (v_run.workflow = 'v2_task' and new.action_type <> 'review') then
    raise exception 'AI suggestion action is outside the workflow draft allowlist'
      using errcode = '22023';
  end if;

  select count(*) into v_key_count from jsonb_object_keys(new.draft_patch);

  if new.action_type = 'review' then
    if v_key_count <> 0 then
      raise exception 'AI review action must have an empty draft patch' using errcode = '22023';
    end if;
  elsif new.action_type = 'replace_fields' then
    if v_key_count < 1 or v_key_count > 4 then
      raise exception 'AI field replacement must contain allowlisted draft fields' using errcode = '22023';
    end if;
    for v_key, v_value in select key, value from jsonb_each(new.draft_patch)
    loop
      if v_key not in ('category_code', 'count_unit', 'name', 'spec')
        or jsonb_typeof(v_value) <> 'string'
        or nullif(btrim(v_value #>> '{}'), '') is null
        or char_length(v_value #>> '{}') > 500 then
        raise exception 'AI field replacement contains an invalid draft value' using errcode = '22023';
      end if;
    end loop;
    if new.draft_patch ? 'category_code' and not exists(
      select 1 from public.product_categories
      where code = new.draft_patch ->> 'category_code'
    ) then
      raise exception 'AI field replacement contains an invalid category' using errcode = '22023';
    end if;
  elsif new.action_type = 'use_existing_product' then
    if v_key_count <> 1
      or not (new.draft_patch ? 'product_id')
      or jsonb_typeof(new.draft_patch -> 'product_id') <> 'string' then
      raise exception 'AI existing-product action has an invalid target' using errcode = '22023';
    end if;
    begin
      v_target_id := (new.draft_patch ->> 'product_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'AI existing-product action has an invalid target' using errcode = '22023';
    end;
    if not exists(
      select 1 from public.products
      where id = v_target_id and store_id = v_run.store_id and is_active
    ) or not exists(
      select 1
      from jsonb_array_elements(coalesce(v_run.source_context -> 'catalog', '[]'::jsonb)) entry
      where coalesce(entry ->> 'productId', entry ->> 'product_id') = v_target_id::text
    ) then
      raise exception 'AI existing-product action target is outside the reviewed store catalog'
        using errcode = '22023';
    end if;
  elsif new.action_type in ('edit_quantity', 'mark_no_order_needed') then
    if not (new.draft_patch ? 'item_id')
      or jsonb_typeof(new.draft_patch -> 'item_id') <> 'string'
      or (new.action_type = 'edit_quantity' and (
        v_key_count <> 2
        or not (new.draft_patch ? 'quantity')
        or jsonb_typeof(new.draft_patch -> 'quantity') <> 'number'
      ))
      or (new.action_type = 'mark_no_order_needed' and v_key_count <> 1) then
      raise exception 'AI task-item action has an invalid draft patch' using errcode = '22023';
    end if;
    begin
      v_target_id := (new.draft_patch ->> 'item_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'AI task-item action has an invalid target' using errcode = '22023';
    end;

    if v_run.workflow = 'arrival_report' then
      if new.action_type <> 'edit_quantity' or not exists(
        select 1
        from public.arrival_report_items item
        join public.arrival_reports report on report.id = item.report_id
        where item.id = v_target_id
          and item.report_id = v_run.entity_id
          and report.store_id = v_run.store_id
      ) then
        raise exception 'AI arrival-item action target is outside the reviewed report'
          using errcode = '22023';
      end if;
    elsif v_run.workflow in ('inventory', 'order') then
      if not exists(
        select 1
        from public.task_items item
        join public.tasks task on task.id = item.task_id
        where item.id = v_target_id
          and item.task_id = v_run.entity_id
          and task.store_id = v_run.store_id
          and task.task_type = v_run.workflow
      ) then
        raise exception 'AI task-item action target is outside the reviewed task'
          using errcode = '22023';
      end if;
    else
      raise exception 'AI task-item action is invalid for this workflow' using errcode = '22023';
    end if;

    if new.action_type = 'edit_quantity' then
      begin
        v_quantity := (new.draft_patch ->> 'quantity')::numeric;
      exception when numeric_value_out_of_range or invalid_text_representation then
        raise exception 'AI quantity action contains an invalid quantity' using errcode = '22023';
      end;
      if v_quantity < 0 or v_quantity > 999999999
        or (v_run.workflow = 'arrival_report' and (v_quantity = 0 or scale(v_quantity) > 3))
        or (v_run.workflow in ('inventory', 'order') and scale(v_quantity) > 2) then
        raise exception 'AI quantity action contains an unsafe quantity' using errcode = '22023';
      end if;
    end if;
  else
    raise exception 'AI suggestion action is outside the draft allowlist' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists ai_suggestions_validate_draft_patch on public.ai_suggestions;
create trigger ai_suggestions_validate_draft_patch
before insert or update of run_id, store_id, source_hash, action_type, draft_patch
on public.ai_suggestions
for each row execute function private.ai_validate_suggestion_draft_patch();

revoke all on function private.ai_validate_suggestion_draft_patch()
from public, anon, authenticated;
