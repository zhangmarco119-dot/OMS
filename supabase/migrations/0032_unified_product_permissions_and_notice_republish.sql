-- 员工和店长共用商品操作权限：权限由 profile_product_permissions 决定，而非角色名称。
create or replace function public.manager_update_product_from_task(
  p_task_item_id uuid,
  p_name text,
  p_spec text,
  p_count_unit text,
  p_product_code text default null,
  p_note text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor public.profiles%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_feedback_id uuid;
  v_original jsonb;
  v_updated jsonb;
begin
  select * into v_actor from public.profiles
  where id = auth.uid() and role in ('staff', 'manager') and is_active = true;
  if not found or not public.can_request_product_feedback('incorrect') then
    raise exception 'product correction permission required' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_spec), '') is null or nullif(trim(p_count_unit), '') is null then
    raise exception 'Product name, spec, and unit are required' using errcode = '22023';
  end if;

  select item.store_id, item.product_id into v_item
  from public.task_items item join public.tasks task on task.id = item.task_id
  where item.id = p_task_item_id and task.created_by = auth.uid() and task.status <> 'submitted' and item.store_id = v_actor.store_id;
  if not found or v_item.product_id is null then raise exception 'The current task item is not linked to an editable product' using errcode = '22023'; end if;

  select * into v_product from public.products where id = v_item.product_id and store_id = v_actor.store_id for update;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  v_original := jsonb_build_object('product_id', v_product.id, 'name', v_product.name, 'spec', v_product.spec, 'count_unit', v_product.count_unit, 'product_code', v_product.product_code);

  update public.products set name = trim(p_name), spec = trim(p_spec), count_unit = trim(p_count_unit), product_code = nullif(trim(p_product_code), '')
  where id = v_product.id returning * into v_product;
  v_updated := jsonb_build_object('product_id', v_product.id, 'name', v_product.name, 'spec', v_product.spec, 'count_unit', v_product.count_unit, 'product_code', v_product.product_code);
  update public.task_items set product_snapshot = v_updated where id = p_task_item_id;

  insert into public.product_feedback(store_id, task_item_id, product_id, feedback_type, original_snapshot, suggested_changes, note, created_by)
  values (v_actor.store_id, p_task_item_id, v_product.id, 'incorrect', v_original, v_updated, nullif(trim(p_note), ''), auth.uid())
  returning id into v_feedback_id;
  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values (v_actor.store_id, auth.uid(), 'product_updated_from_task', 'products', v_product.id, jsonb_build_object('feedback_id', v_feedback_id, 'before', v_original, 'after', v_updated));
  return jsonb_build_object('feedback_id', v_feedback_id, 'product_snapshot', v_updated);
end;
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
  where product_id = v_item.product_id and feedback_type = 'discontinued' and status = 'open'
  order by created_at desc limit 1;
  if found then return v_feedback_id; end if;

  select * into v_product from public.products where id = v_item.product_id and store_id = v_actor.store_id;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  v_original := jsonb_build_object('product_id', v_product.id, 'name', v_product.name, 'spec', v_product.spec, 'count_unit', v_product.count_unit, 'product_code', v_product.product_code);

  insert into public.product_feedback(store_id, task_item_id, product_id, feedback_type, original_snapshot, suggested_changes, note, created_by)
  values (v_actor.store_id, p_task_item_id, v_product.id, 'discontinued', v_original, '{}'::jsonb, nullif(trim(p_note), ''), auth.uid())
  returning id into v_feedback_id;
  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values (v_actor.store_id, auth.uid(), 'product_deletion_requested', 'products', v_product.id, jsonb_build_object('feedback_id', v_feedback_id));
  return v_feedback_id;
end;
$$;

-- 撤回后重新发布视作一次新的公告：恢复所有接收人的未读状态并重新生成通知。
create or replace function public.publish_v2_notice(p_notice_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_notice public.v2_notices%rowtype;
  v_previous_status text;
begin
  if not public.can_manage_v2_notice(p_notice_id) then raise exception 'notice management denied' using errcode = '42501'; end if;
  if not exists(select 1 from public.v2_notice_recipients where notice_id = p_notice_id) then raise exception 'notice recipients required' using errcode = '22023'; end if;
  select status into v_previous_status from public.v2_notices where id = p_notice_id for update;
  if not found then raise exception 'notice not found' using errcode = 'P0002'; end if;

  if v_previous_status = 'retracted' then
    update public.v2_notice_recipients
    set first_read_at = null, last_read_at = null, dismissed_at = null, acknowledged_at = null
    where notice_id = p_notice_id;
    delete from public.notifications where entity_type = 'v2_notice' and entity_id = p_notice_id;
  end if;

  update public.v2_notices set status = 'published', published_at = now(), retracted_at = null
  where id = p_notice_id returning * into v_notice;
  insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  select r.profile_id, r.store_id, 'notice_published', v_notice.title, left(v_notice.body, 180), 'v2_notice', v_notice.id, 'notice:' || v_notice.id || ':' || r.profile_id
  from public.v2_notice_recipients r where r.notice_id = v_notice.id
  on conflict(dedupe_key) do nothing;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), case when v_previous_status = 'retracted' then 'v2_notice_republished' else 'v2_notice_published' end, 'v2_notices', v_notice.id, jsonb_build_object('previous_status', v_previous_status));
  return to_jsonb(v_notice);
end;
$$;

grant execute on function public.manager_update_product_from_task(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.manager_request_product_deletion(uuid, text) to authenticated;
grant execute on function public.publish_v2_notice(uuid) to authenticated;
