drop policy if exists products_insert_manager on public.products;

create policy products_insert_admin
on public.products for insert
to authenticated
with check (
  public.current_user_role() = 'admin'
  and public.has_store_access(store_id)
);

create or replace function public.manager_add_product_from_task(
  p_task_id uuid,
  p_name text,
  p_spec text,
  p_count_unit text,
  p_quantity numeric,
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
  v_task public.tasks%rowtype;
  v_product public.products%rowtype;
  v_task_item public.task_items%rowtype;
  v_feedback_id uuid;
  v_snapshot jsonb;
  v_product_sort integer;
  v_task_sort integer;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid()
    and role = 'manager'
    and is_active = true;

  if not found then
    raise exception 'Only an active manager can add a store product from a task' using errcode = '42501';
  end if;

  if nullif(trim(p_name), '') is null
    or nullif(trim(p_spec), '') is null
    or nullif(trim(p_count_unit), '') is null then
    raise exception 'Product name, spec, and unit are required' using errcode = '22023';
  end if;

  if p_quantity is null or p_quantity < 0 then
    raise exception 'Quantity must be a non-negative number' using errcode = '22023';
  end if;

  select * into v_task
  from public.tasks
  where id = p_task_id
    and created_by = auth.uid()
    and store_id = v_actor.store_id
    and status <> 'submitted'
  for update;

  if not found then
    raise exception 'Editable task not found' using errcode = 'P0002';
  end if;

  select coalesce(max(sort_order), 0) + 10
  into v_product_sort
  from public.products
  where store_id = v_actor.store_id;

  insert into public.products (store_id, name, spec, count_unit, product_code, sort_order, is_active)
  values (
    v_actor.store_id,
    trim(p_name),
    trim(p_spec),
    trim(p_count_unit),
    nullif(trim(p_product_code), ''),
    v_product_sort,
    true
  )
  returning * into v_product;

  v_snapshot := jsonb_build_object(
    'product_id', v_product.id,
    'name', v_product.name,
    'spec', v_product.spec,
    'count_unit', v_product.count_unit,
    'product_code', v_product.product_code
  );

  select coalesce(max(sort_order), 0) + 10
  into v_task_sort
  from public.task_items
  where task_id = v_task.id;

  insert into public.task_items (
    task_id,
    store_id,
    product_id,
    product_snapshot,
    quantity,
    status,
    staff_note,
    is_extra_item,
    sort_order
  )
  values (
    v_task.id,
    v_actor.store_id,
    v_product.id,
    v_snapshot,
    p_quantity,
    'completed',
    nullif(trim(p_note), ''),
    true,
    v_task_sort
  )
  returning * into v_task_item;

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
    v_task_item.id,
    v_product.id,
    'new',
    v_snapshot,
    v_snapshot,
    nullif(trim(p_note), ''),
    auth.uid()
  )
  returning id into v_feedback_id;

  insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata)
  values (
    v_actor.store_id,
    auth.uid(),
    'manager_product_added',
    'products',
    v_product.id,
    jsonb_build_object('feedback_id', v_feedback_id, 'task_item_id', v_task_item.id, 'product', v_snapshot)
  );

  return jsonb_build_object(
    'product_id', v_product.id,
    'task_item_id', v_task_item.id,
    'feedback_id', v_feedback_id
  );
end;
$$;

revoke all on function public.manager_add_product_from_task(uuid, text, text, text, numeric, text, text) from public;
grant execute on function public.manager_add_product_from_task(uuid, text, text, text, numeric, text, text) to authenticated;
