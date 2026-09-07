-- Add a reversible archive outcome alongside permanent product deletion.
-- Employees and managers submit a request from the inventory/order workflow;
-- only an administrator can archive or permanently delete the catalog item.

alter table public.product_feedback
  drop constraint if exists product_feedback_feedback_type_check,
  add constraint product_feedback_feedback_type_check
    check (feedback_type in ('discontinued', 'archived', 'incorrect', 'new'));

alter table public.task_items
  drop constraint if exists task_items_product_action_status_check,
  add constraint task_items_product_action_status_check
    check (product_action_status in (
      'deletion_requested', 'deletion_approved', 'deletion_ignored',
      'archive_requested', 'archive_approved', 'archive_ignored'
    ));

create or replace function public.can_request_product_feedback(p_feedback_type text)
returns boolean language sql security definer set search_path = public stable as $$
  select public.current_user_role() in ('staff', 'manager') and case
    when p_feedback_type = 'new' then coalesce((select can_request_new from public.profile_product_permissions where profile_id = auth.uid()), true)
    when p_feedback_type = 'incorrect' then coalesce((select can_request_incorrect from public.profile_product_permissions where profile_id = auth.uid()), true)
    when p_feedback_type in ('discontinued', 'archived') then coalesce((select can_request_discontinued from public.profile_product_permissions where profile_id = auth.uid()), true)
    else false end
$$;

create or replace function public.manager_request_product_deletion(
  p_task_item_id uuid,
  p_note text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_actor public.profiles%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_feedback_id uuid;
  v_original jsonb;
begin
  select * into v_actor from public.profiles
  where id = auth.uid() and role in ('staff', 'manager') and is_active = true;
  if not found or not public.can_request_product_feedback('discontinued') then
    raise exception 'product deletion permission required' using errcode = '42501';
  end if;
  select item.store_id, item.product_id into v_item
  from public.task_items item join public.tasks task on task.id = item.task_id
  where item.id = p_task_item_id and task.created_by = auth.uid() and task.status <> 'submitted' and item.store_id = v_actor.store_id;
  if not found or v_item.product_id is null then raise exception 'The current task item is not linked to a product' using errcode = '22023'; end if;
  select id into v_feedback_id from public.product_feedback
  where product_id = v_item.product_id and feedback_type in ('discontinued', 'archived') and status = 'open'
  order by created_at desc limit 1;
  if found then return v_feedback_id; end if;
  select * into v_product from public.products where id = v_item.product_id and store_id = v_actor.store_id and is_active;
  if not found then raise exception 'Active product not found' using errcode = 'P0002'; end if;
  v_original := jsonb_build_object('product_id', v_product.id, 'name', v_product.name, 'spec', v_product.spec, 'count_unit', v_product.count_unit, 'product_code', v_product.product_code);
  insert into public.product_feedback(store_id, task_item_id, product_id, feedback_type, original_snapshot, suggested_changes, note, created_by)
  values (v_actor.store_id, p_task_item_id, v_product.id, 'discontinued', v_original, '{}'::jsonb, nullif(trim(p_note), ''), auth.uid())
  returning id into v_feedback_id;
  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values (v_actor.store_id, auth.uid(), 'product_deletion_requested', 'products', v_product.id, jsonb_build_object('feedback_id', v_feedback_id));
  return v_feedback_id;
end;
$$;

create or replace function public.manager_request_product_archive(
  p_task_item_id uuid,
  p_note text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_actor public.profiles%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_feedback_id uuid;
  v_original jsonb;
begin
  select * into v_actor from public.profiles
  where id = auth.uid() and role in ('staff', 'manager') and is_active = true;
  if not found or not public.can_request_product_feedback('archived') then
    raise exception 'product archive permission required' using errcode = '42501';
  end if;
  select item.store_id, item.product_id into v_item
  from public.task_items item join public.tasks task on task.id = item.task_id
  where item.id = p_task_item_id and task.created_by = auth.uid() and task.status <> 'submitted' and item.store_id = v_actor.store_id;
  if not found or v_item.product_id is null then raise exception 'The current task item is not linked to a product' using errcode = '22023'; end if;
  select id into v_feedback_id from public.product_feedback
  where product_id = v_item.product_id and feedback_type in ('discontinued', 'archived') and status = 'open'
  order by created_at desc limit 1;
  if found then return v_feedback_id; end if;
  select * into v_product from public.products where id = v_item.product_id and store_id = v_actor.store_id and is_active;
  if not found then raise exception 'Active product not found' using errcode = 'P0002'; end if;
  v_original := jsonb_build_object('product_id', v_product.id, 'name', v_product.name, 'spec', v_product.spec, 'count_unit', v_product.count_unit, 'product_code', v_product.product_code);
  insert into public.product_feedback(store_id, task_item_id, product_id, feedback_type, original_snapshot, suggested_changes, note, created_by)
  values (v_actor.store_id, p_task_item_id, v_product.id, 'archived', v_original, '{}'::jsonb, nullif(trim(p_note), ''), auth.uid())
  returning id into v_feedback_id;
  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values (v_actor.store_id, auth.uid(), 'product_archive_requested', 'products', v_product.id, jsonb_build_object('feedback_id', v_feedback_id));
  return v_feedback_id;
end;
$$;

create or replace function public.sync_product_deletion_feedback_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_product_id uuid;
  v_requested_status text;
  v_approved_status text;
  v_ignored_status text;
  v_resolution text;
begin
  if new.feedback_type not in ('discontinued', 'archived') then return new; end if;
  v_requested_status := case when new.feedback_type = 'archived' then 'archive_requested' else 'deletion_requested' end;
  v_ignored_status := case when new.feedback_type = 'archived' then 'archive_ignored' else 'deletion_ignored' end;
  if new.status = 'open' then
    update public.task_items set product_action_status = v_requested_status, status = 'completed', quantity = null where id = new.task_item_id;
  elsif new.status = 'resolved' then
    begin
      v_product_id := coalesce(new.product_id, nullif(new.original_snapshot ->> 'product_id', '')::uuid);
    exception when invalid_text_representation then v_product_id := null;
    end;
    v_resolution := coalesce(new.suggested_changes ->> '_resolution', case when new.feedback_type = 'archived' then 'confirm_archive' else 'confirm_delete' end);
    v_approved_status := case when v_resolution = 'confirm_archive' then 'archive_approved' else 'deletion_approved' end;
    update public.task_items
    set product_action_status = v_approved_status, status = 'completed', quantity = null
    where id = new.task_item_id or (
      v_product_id is not null and product_action_status in ('deletion_requested', 'archive_requested') and product_snapshot ->> 'product_id' = v_product_id::text
    );
  elsif new.status = 'ignored' then
    v_product_id := new.product_id;
    update public.task_items
    set product_action_status = v_ignored_status, status = 'pending', quantity = null
    where id = new.task_item_id or (
      v_product_id is not null and product_action_status = v_requested_status and product_snapshot ->> 'product_id' = v_product_id::text
    );
  end if;
  return new;
end;
$$;

create or replace function public.admin_handle_product_feedback(
  p_feedback_id uuid,
  p_action text,
  p_resolution_note text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor public.profiles%rowtype;
  v_feedback public.product_feedback%rowtype;
  v_product public.products%rowtype;
  v_status text;
  v_audit_action text;
begin
  select * into v_actor from public.profiles where id = auth.uid() and role = 'admin' and is_active = true;
  if not found then raise exception 'Only an active admin can handle product feedback' using errcode = '42501'; end if;
  select * into v_feedback from public.product_feedback where id = p_feedback_id for update;
  if not found or not public.has_store_access(v_feedback.store_id) then raise exception 'Feedback not found or inaccessible' using errcode = '42501'; end if;
  if v_feedback.status <> 'open' then raise exception 'Feedback has already been handled' using errcode = '22023'; end if;

  if v_feedback.feedback_type in ('discontinued', 'archived') then
    if p_action = 'confirm_delete' then
      if v_feedback.product_id is not null then delete from public.products where id = v_feedback.product_id and store_id = v_feedback.store_id; end if;
      v_status := 'resolved'; v_audit_action := 'admin_product_deleted';
    elsif p_action = 'confirm_archive' then
      if v_feedback.product_id is not null then update public.products set is_active = false where id = v_feedback.product_id and store_id = v_feedback.store_id; end if;
      v_status := 'resolved'; v_audit_action := 'admin_product_archived';
    elsif p_action = 'ignore' then
      v_status := 'ignored'; v_audit_action := case when v_feedback.feedback_type = 'archived' then 'admin_product_archive_ignored' else 'admin_product_deletion_ignored' end;
    else raise exception 'Unsupported product lifecycle feedback action' using errcode = '22023'; end if;
  elsif v_feedback.feedback_type = 'incorrect' and v_feedback.suggested_changes <> '{}'::jsonb then
    if p_action = 'acknowledge' then
      v_status := 'resolved'; v_audit_action := 'admin_product_update_acknowledged';
    elsif p_action = 'revert' then
      if v_feedback.product_id is null then raise exception 'The product was deleted and cannot be reverted' using errcode = '22023'; end if;
      select * into v_product from public.products where id = v_feedback.product_id and store_id = v_feedback.store_id for update;
      if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
      if v_product.name is distinct from (v_feedback.suggested_changes ->> 'name')
        or v_product.spec is distinct from (v_feedback.suggested_changes ->> 'spec')
        or v_product.count_unit is distinct from (v_feedback.suggested_changes ->> 'count_unit')
        or v_product.product_code is distinct from (v_feedback.suggested_changes ->> 'product_code') then
        raise exception 'Product information changed again; review it manually before reverting' using errcode = '40001';
      end if;
      update public.products set name = v_feedback.original_snapshot ->> 'name', spec = v_feedback.original_snapshot ->> 'spec', count_unit = v_feedback.original_snapshot ->> 'count_unit', product_code = v_feedback.original_snapshot ->> 'product_code' where id = v_feedback.product_id;
      update public.task_items set product_snapshot = v_feedback.original_snapshot where id = v_feedback.task_item_id;
      v_status := 'reverted'; v_audit_action := 'admin_product_update_reverted';
    else raise exception 'Unsupported product update feedback action' using errcode = '22023'; end if;
  else
    if p_action = 'resolve' then v_status := 'resolved'; v_audit_action := 'admin_product_feedback_resolved';
    elsif p_action = 'ignore' then v_status := 'ignored'; v_audit_action := 'admin_product_feedback_ignored';
    else raise exception 'Unsupported feedback action' using errcode = '22023'; end if;
  end if;

  update public.product_feedback
  set status = v_status,
      handled_by = auth.uid(),
      handled_at = now(),
      resolution_note = nullif(trim(p_resolution_note), ''),
      suggested_changes = case when v_feedback.feedback_type in ('discontinued', 'archived')
        then coalesce(v_feedback.suggested_changes, '{}'::jsonb) || jsonb_build_object('_resolution', p_action)
        else v_feedback.suggested_changes end
  where id = p_feedback_id;
  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values (v_feedback.store_id, auth.uid(), v_audit_action, 'product_feedback', p_feedback_id, jsonb_build_object('product_id', v_feedback.product_id, 'status', v_status, 'resolution', p_action));
  return jsonb_build_object('feedback_id', p_feedback_id, 'status', v_status, 'resolution', p_action);
end;
$$;

revoke all on function public.manager_request_product_archive(uuid, text) from public;
grant execute on function public.manager_request_product_archive(uuid, text) to authenticated;
