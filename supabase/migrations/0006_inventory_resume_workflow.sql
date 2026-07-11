alter table public.task_items
  add column product_action_status text
  check (product_action_status in ('deletion_requested', 'deletion_approved', 'deletion_ignored'));

update public.task_items item
set product_action_status = case feedback.status
      when 'open' then 'deletion_requested'
      when 'resolved' then 'deletion_approved'
      when 'ignored' then 'deletion_ignored'
      else item.product_action_status
    end,
    status = case when feedback.status = 'open' then 'completed' else item.status end,
    quantity = case when feedback.status = 'open' then null else item.quantity end
from public.product_feedback feedback
where feedback.task_item_id = item.id
  and feedback.feedback_type = 'discontinued';

create or replace function public.sync_product_deletion_feedback_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
begin
  if new.feedback_type <> 'discontinued' then
    return new;
  end if;

  if new.status = 'open' then
    update public.task_items
    set product_action_status = 'deletion_requested',
        status = 'completed',
        quantity = null
    where id = new.task_item_id;
  elsif new.status = 'resolved' then
    begin
      v_product_id := coalesce(new.product_id, nullif(new.original_snapshot ->> 'product_id', '')::uuid);
    exception when invalid_text_representation then
      v_product_id := null;
    end;

    update public.task_items
    set product_action_status = 'deletion_approved',
        status = 'completed',
        quantity = null
    where id = new.task_item_id
      or (
        v_product_id is not null
        and product_action_status = 'deletion_requested'
        and product_snapshot ->> 'product_id' = v_product_id::text
      );
  elsif new.status = 'ignored' then
    v_product_id := new.product_id;

    update public.task_items
    set product_action_status = 'deletion_ignored',
        status = 'pending',
        quantity = null
    where id = new.task_item_id
      or (
        v_product_id is not null
        and product_action_status = 'deletion_requested'
        and product_snapshot ->> 'product_id' = v_product_id::text
      );
  end if;

  return new;
end;
$$;

create trigger product_feedback_sync_deletion_state_insert
after insert on public.product_feedback
for each row execute function public.sync_product_deletion_feedback_state();

create trigger product_feedback_sync_deletion_state_update
after update of status on public.product_feedback
for each row execute function public.sync_product_deletion_feedback_state();

create or replace function public.list_store_inventory_templates(p_limit integer default 30)
returns table (
  task_id uuid,
  submitted_at timestamptz,
  created_by uuid,
  created_by_name text,
  total_count bigint,
  processed_count bigint,
  pending_count bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_actor public.profiles%rowtype;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid()
    and is_active = true;

  if not found then
    raise exception 'Active account required' using errcode = '42501';
  end if;

  return query
  select
    task.id,
    task.submitted_at,
    task.created_by,
    creator.display_name,
    count(item.id) as total_count,
    count(item.id) filter (where item.status <> 'pending' or item.quantity is not null) as processed_count,
    count(item.id) filter (where item.status = 'pending' and item.quantity is null) as pending_count
  from public.tasks task
  join public.profiles creator on creator.id = task.created_by
  left join public.task_items item on item.task_id = task.id
  where task.store_id = v_actor.store_id
    and task.task_type = 'inventory'
    and task.status = 'submitted'
  group by task.id, task.submitted_at, task.created_by, creator.display_name
  order by task.submitted_at desc nulls last
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

create or replace function public.import_inventory_task(
  p_target_task_id uuid,
  p_source_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_target public.tasks%rowtype;
  v_source public.tasks%rowtype;
  v_imported_count integer;
  v_processed_count integer;
  v_pending_count integer;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid()
    and role in ('staff', 'manager')
    and is_active = true;

  if not found then
    raise exception 'Active staff or manager account required' using errcode = '42501';
  end if;

  select * into v_target
  from public.tasks
  where id = p_target_task_id
    and store_id = v_actor.store_id
    and created_by = auth.uid()
    and task_type = 'inventory'
    and status = 'draft'
  for update;

  if not found then
    raise exception 'Editable target inventory task not found' using errcode = 'P0002';
  end if;

  select * into v_source
  from public.tasks
  where id = p_source_task_id
    and store_id = v_actor.store_id
    and task_type = 'inventory'
    and status = 'submitted';

  if not found then
    raise exception 'Submitted source inventory task not found' using errcode = 'P0002';
  end if;

  with item_matches as (
    select distinct on (target.id)
      target.id as target_item_id,
      source.quantity,
      source.status,
      source.product_action_status
    from public.task_items target
    join public.task_items source
      on source.task_id = v_source.id
      and (
        (target.product_id is not null and source.product_id = target.product_id)
        or (
          target.product_snapshot ->> 'name' = source.product_snapshot ->> 'name'
          and target.product_snapshot ->> 'spec' = source.product_snapshot ->> 'spec'
          and target.product_snapshot ->> 'count_unit' = source.product_snapshot ->> 'count_unit'
        )
      )
    where target.task_id = v_target.id
    order by target.id, source.sort_order
  )
  update public.task_items target
  set quantity = matched.quantity,
      status = matched.status,
      product_action_status = matched.product_action_status
  from item_matches matched
  where target.id = matched.target_item_id;

  get diagnostics v_imported_count = row_count;

  update public.tasks
  set updated_at = now(),
      export_meta = coalesce(export_meta, '{}'::jsonb) || jsonb_build_object(
        'imported_from_task_id', v_source.id,
        'imported_at', now()
      )
  where id = v_target.id;

  select
    count(*) filter (where status <> 'pending' or quantity is not null),
    count(*) filter (where status = 'pending' and quantity is null)
  into v_processed_count, v_pending_count
  from public.task_items
  where task_id = v_target.id;

  insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata)
  values (
    v_actor.store_id,
    auth.uid(),
    'inventory_task_imported',
    'tasks',
    v_target.id,
    jsonb_build_object('source_task_id', v_source.id, 'imported_item_count', v_imported_count)
  );

  return jsonb_build_object(
    'target_task_id', v_target.id,
    'source_task_id', v_source.id,
    'imported_item_count', v_imported_count,
    'processed_count', v_processed_count,
    'pending_count', v_pending_count
  );
end;
$$;

revoke all on function public.list_store_inventory_templates(integer) from public;
revoke all on function public.import_inventory_task(uuid, uuid) from public;

grant execute on function public.list_store_inventory_templates(integer) to authenticated;
grant execute on function public.import_inventory_task(uuid, uuid) to authenticated;
