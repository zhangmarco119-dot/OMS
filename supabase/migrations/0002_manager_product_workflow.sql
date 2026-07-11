alter table public.task_items
  drop constraint task_items_product_id_fkey,
  add constraint task_items_product_id_fkey
    foreign key (product_id) references public.products(id) on delete set null;

alter table public.product_feedback
  add column product_id uuid references public.products(id) on delete set null;

update public.product_feedback feedback
set product_id = item.product_id
from public.task_items item
where feedback.task_item_id = item.id
  and feedback.product_id is null;

alter table public.product_feedback
  drop constraint product_feedback_status_check,
  add constraint product_feedback_status_check
    check (status in ('open', 'resolved', 'ignored', 'reverted'));

create index product_feedback_product_status_idx
on public.product_feedback (product_id, status, created_at desc);

create or replace function public.manager_update_product_from_task(
  p_task_item_id uuid,
  p_name text,
  p_spec text,
  p_count_unit text,
  p_product_code text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_feedback_id uuid;
  v_original jsonb;
  v_updated jsonb;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid()
    and role = 'manager'
    and is_active = true;

  if not found then
    raise exception 'Only an active manager can update a product from a task' using errcode = '42501';
  end if;

  if nullif(trim(p_name), '') is null
    or nullif(trim(p_spec), '') is null
    or nullif(trim(p_count_unit), '') is null then
    raise exception 'Product name, spec, and unit are required' using errcode = '22023';
  end if;

  select item.store_id, item.product_id
  into v_item
  from public.task_items item
  join public.tasks task on task.id = item.task_id
  where item.id = p_task_item_id
    and task.created_by = auth.uid()
    and task.status <> 'submitted'
    and item.store_id = v_actor.store_id;

  if not found or v_item.product_id is null then
    raise exception 'The current task item is not linked to an editable product' using errcode = '22023';
  end if;

  select * into v_product
  from public.products
  where id = v_item.product_id
    and store_id = v_actor.store_id
  for update;

  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  v_original := jsonb_build_object(
    'product_id', v_product.id,
    'name', v_product.name,
    'spec', v_product.spec,
    'count_unit', v_product.count_unit,
    'product_code', v_product.product_code
  );

  update public.products
  set name = trim(p_name),
      spec = trim(p_spec),
      count_unit = trim(p_count_unit),
      product_code = nullif(trim(p_product_code), '')
  where id = v_product.id
  returning * into v_product;

  v_updated := jsonb_build_object(
    'product_id', v_product.id,
    'name', v_product.name,
    'spec', v_product.spec,
    'count_unit', v_product.count_unit,
    'product_code', v_product.product_code
  );

  update public.task_items
  set product_snapshot = v_updated
  where id = p_task_item_id;

  insert into public.product_feedback (
    store_id,
    task_item_id,
    product_id,
    feedback_type,
    original_snapshot,
    suggested_changes,
    note,
    created_by
  )
  values (
    v_actor.store_id,
    p_task_item_id,
    v_product.id,
    'incorrect',
    v_original,
    v_updated,
    nullif(trim(p_note), ''),
    auth.uid()
  )
  returning id into v_feedback_id;

  insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata)
  values (
    v_actor.store_id,
    auth.uid(),
    'manager_product_updated',
    'products',
    v_product.id,
    jsonb_build_object('feedback_id', v_feedback_id, 'before', v_original, 'after', v_updated)
  );

  return jsonb_build_object('feedback_id', v_feedback_id, 'product_snapshot', v_updated);
end;
$$;

create or replace function public.manager_request_product_deletion(
  p_task_item_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_feedback_id uuid;
  v_original jsonb;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid()
    and role = 'manager'
    and is_active = true;

  if not found then
    raise exception 'Only an active manager can request product deletion' using errcode = '42501';
  end if;

  select item.store_id, item.product_id
  into v_item
  from public.task_items item
  join public.tasks task on task.id = item.task_id
  where item.id = p_task_item_id
    and task.created_by = auth.uid()
    and task.status <> 'submitted'
    and item.store_id = v_actor.store_id;

  if not found or v_item.product_id is null then
    raise exception 'The current task item is not linked to a product' using errcode = '22023';
  end if;

  select id into v_feedback_id
  from public.product_feedback
  where product_id = v_item.product_id
    and feedback_type = 'discontinued'
    and status = 'open'
  order by created_at desc
  limit 1;

  if found then
    return v_feedback_id;
  end if;

  select * into v_product
  from public.products
  where id = v_item.product_id
    and store_id = v_actor.store_id;

  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  v_original := jsonb_build_object(
    'product_id', v_product.id,
    'name', v_product.name,
    'spec', v_product.spec,
    'count_unit', v_product.count_unit,
    'product_code', v_product.product_code
  );

  insert into public.product_feedback (
    store_id,
    task_item_id,
    product_id,
    feedback_type,
    original_snapshot,
    suggested_changes,
    note,
    created_by
  )
  values (
    v_actor.store_id,
    p_task_item_id,
    v_product.id,
    'discontinued',
    v_original,
    '{}'::jsonb,
    nullif(trim(p_note), ''),
    auth.uid()
  )
  returning id into v_feedback_id;

  insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata)
  values (
    v_actor.store_id,
    auth.uid(),
    'manager_product_deletion_requested',
    'products',
    v_product.id,
    jsonb_build_object('feedback_id', v_feedback_id)
  );

  return v_feedback_id;
end;
$$;

create or replace function public.admin_handle_product_feedback(
  p_feedback_id uuid,
  p_action text,
  p_resolution_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_feedback public.product_feedback%rowtype;
  v_product public.products%rowtype;
  v_status text;
  v_audit_action text;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid()
    and role = 'admin'
    and is_active = true;

  if not found then
    raise exception 'Only an active admin can handle product feedback' using errcode = '42501';
  end if;

  select * into v_feedback
  from public.product_feedback
  where id = p_feedback_id
  for update;

  if not found or not public.has_store_access(v_feedback.store_id) then
    raise exception 'Feedback not found or inaccessible' using errcode = '42501';
  end if;

  if v_feedback.status <> 'open' then
    raise exception 'Feedback has already been handled' using errcode = '22023';
  end if;

  if v_feedback.feedback_type = 'discontinued' then
    if p_action = 'confirm_delete' then
      if v_feedback.product_id is not null then
        delete from public.products
        where id = v_feedback.product_id
          and store_id = v_feedback.store_id;
      end if;
      v_status := 'resolved';
      v_audit_action := 'admin_product_deleted';
    elsif p_action = 'ignore' then
      v_status := 'ignored';
      v_audit_action := 'admin_product_deletion_ignored';
    else
      raise exception 'Unsupported deletion feedback action' using errcode = '22023';
    end if;
  elsif v_feedback.feedback_type = 'incorrect' and v_feedback.suggested_changes <> '{}'::jsonb then
    if p_action = 'acknowledge' then
      v_status := 'resolved';
      v_audit_action := 'admin_product_update_acknowledged';
    elsif p_action = 'revert' then
      if v_feedback.product_id is null then
        raise exception 'The product was deleted and cannot be reverted' using errcode = '22023';
      end if;

      select * into v_product
      from public.products
      where id = v_feedback.product_id
        and store_id = v_feedback.store_id
      for update;

      if not found then
        raise exception 'Product not found' using errcode = 'P0002';
      end if;

      if v_product.name is distinct from (v_feedback.suggested_changes ->> 'name')
        or v_product.spec is distinct from (v_feedback.suggested_changes ->> 'spec')
        or v_product.count_unit is distinct from (v_feedback.suggested_changes ->> 'count_unit')
        or v_product.product_code is distinct from (v_feedback.suggested_changes ->> 'product_code') then
        raise exception 'Product information changed again; review it manually before reverting' using errcode = '40001';
      end if;

      update public.products
      set name = v_feedback.original_snapshot ->> 'name',
          spec = v_feedback.original_snapshot ->> 'spec',
          count_unit = v_feedback.original_snapshot ->> 'count_unit',
          product_code = v_feedback.original_snapshot ->> 'product_code'
      where id = v_feedback.product_id;

      update public.task_items
      set product_snapshot = v_feedback.original_snapshot
      where id = v_feedback.task_item_id;

      v_status := 'reverted';
      v_audit_action := 'admin_product_update_reverted';
    else
      raise exception 'Unsupported product update feedback action' using errcode = '22023';
    end if;
  else
    if p_action = 'resolve' then
      v_status := 'resolved';
      v_audit_action := 'admin_product_feedback_resolved';
    elsif p_action = 'ignore' then
      v_status := 'ignored';
      v_audit_action := 'admin_product_feedback_ignored';
    else
      raise exception 'Unsupported feedback action' using errcode = '22023';
    end if;
  end if;

  update public.product_feedback
  set status = v_status,
      handled_by = auth.uid(),
      handled_at = now(),
      resolution_note = nullif(trim(p_resolution_note), '')
  where id = p_feedback_id;

  insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata)
  values (
    v_feedback.store_id,
    auth.uid(),
    v_audit_action,
    'product_feedback',
    p_feedback_id,
    jsonb_build_object('product_id', v_feedback.product_id, 'status', v_status)
  );

  return jsonb_build_object('feedback_id', p_feedback_id, 'status', v_status);
end;
$$;

revoke all on function public.manager_update_product_from_task(uuid, text, text, text, text, text) from public;
revoke all on function public.manager_request_product_deletion(uuid, text) from public;
revoke all on function public.admin_handle_product_feedback(uuid, text, text) from public;

grant execute on function public.manager_update_product_from_task(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.manager_request_product_deletion(uuid, text) to authenticated;
grant execute on function public.admin_handle_product_feedback(uuid, text, text) to authenticated;
