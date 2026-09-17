-- Allow reviewers to reject selected rows from a linked inventory sheet. The
-- original submission remains immutable; a focused recount draft is created
-- with only the rejected rows.

alter table public.tasks
  add column if not exists inventory_recount_only boolean not null default false;

alter table public.v2_tasks
  add column if not exists inventory_correction_task_id uuid references public.tasks(id),
  add column if not exists inventory_correction_item_ids uuid[] not null default '{}'::uuid[];

alter table public.v2_task_reviews
  add column if not exists inventory_correction_item_ids uuid[] not null default '{}'::uuid[];

create index if not exists v2_tasks_inventory_correction_task_idx
  on public.v2_tasks(inventory_correction_task_id)
  where inventory_correction_task_id is not null;

create or replace function public.create_linked_inventory_task(p_v2_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_v2 public.v2_tasks%rowtype;
  v_task public.tasks%rowtype;
  v_product public.products%rowtype;
begin
  select * into v_v2 from public.v2_tasks where id = p_v2_task_id;
  if v_v2.id is null or not public.can_edit_v2_task(v_v2.id) or not v_v2.requires_inventory then
    raise exception '此任务没有可执行的关联点货' using errcode = '42501';
  end if;

  if v_v2.inventory_correction_task_id is not null then
    select * into v_task
    from public.tasks
    where id = v_v2.inventory_correction_task_id
      and linked_v2_task_id = v_v2.id
      and created_by = auth.uid();
    if v_task.id is null then
      raise exception '本轮重新点货单不属于当前提交人' using errcode = '42501';
    end if;
    return v_task;
  end if;

  select * into v_task
  from public.tasks
  where linked_v2_task_id = v_v2.id and created_by = auth.uid()
  order by (status = 'draft') desc, created_at desc
  limit 1;
  if v_task.id is not null then return v_task; end if;

  insert into public.tasks(
    store_id, created_by, task_type, status, inventory_category_codes,
    linked_v2_task_id, inventory_recount_only
  ) values (
    v_v2.store_id, auth.uid(), 'inventory', 'draft', v_v2.inventory_category_codes,
    v_v2.id, false
  ) returning * into v_task;

  for v_product in
    select * from public.products
    where store_id = v_v2.store_id and is_active
      and category_code = any(v_v2.inventory_category_codes)
    order by sort_order, name
  loop
    insert into public.task_items(
      task_id, store_id, product_id, product_snapshot, status, quantity, sort_order
    ) values (
      v_task.id, v_task.store_id, v_product.id,
      jsonb_build_object(
        'product_id', v_product.id, 'name', v_product.name, 'spec', v_product.spec,
        'count_unit', v_product.count_unit, 'product_code', v_product.product_code,
        'category_code', v_product.category_code
      ),
      'pending', null, v_product.sort_order
    );
  end loop;
  return v_task;
end;
$$;

create or replace function public.require_inventory_before_v2_task_submission()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.requires_inventory
     and new.status in ('submitted', 'resubmitted', 'approved')
     and old.status not in ('submitted', 'resubmitted', 'approved') then
    if old.status = 'rejected' and old.inventory_correction_task_id is not null then
      if not exists (
        select 1 from public.tasks inventory
        where inventory.id = old.inventory_correction_task_id
          and inventory.linked_v2_task_id = new.id
          and inventory.task_type = 'inventory'
          and inventory.inventory_recount_only
          and inventory.status = 'submitted'
          and inventory.created_by = auth.uid()
      ) then
        raise exception '请先完成并提交本轮被驳回货品的重新点货单' using errcode = '23514';
      end if;
    elsif not exists (
      select 1 from public.tasks inventory
      where inventory.linked_v2_task_id = new.id
        and inventory.task_type = 'inventory'
        and inventory.status = 'submitted'
        and inventory.store_id = new.store_id
        and inventory.inventory_category_codes = new.inventory_category_codes
        and inventory.created_by = auth.uid()
    ) then
      raise exception '请先完成并提交任务要求范围内的点货单' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.review_v2_task_items_with_inventory(
  p_task_id uuid,
  p_decisions jsonb,
  p_note text,
  p_inventory_task_id uuid,
  p_inventory_rejected_item_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started timestamptz := transaction_timestamp();
  v_task public.v2_tasks%rowtype;
  v_inventory public.tasks%rowtype;
  v_recount public.tasks%rowtype;
  v_result jsonb;
  v_expected_answer_status text;
  v_reviewable_answer_count integer;
  v_inventory_item_count integer;
  v_rejected_count integer;
  v_base_status text;
  v_base_version integer;
  v_action text;
  v_new_item_ids uuid[] := '{}'::uuid[];
  v_rejected_inventory_ids uuid[] := '{}'::uuid[];
begin
  select * into v_task from public.v2_tasks where id = p_task_id for update;
  if v_task.id is null or not public.can_review_v2_task(p_task_id) then
    raise exception 'review denied' using errcode = '42501';
  end if;
  if not v_task.requires_inventory then
    raise exception 'task does not require inventory review' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_decisions, 'null'::jsonb)) <> 'array' then
    raise exception 'review decisions must be an array' using errcode = '22023';
  end if;

  select * into v_inventory
  from public.tasks
  where id = p_inventory_task_id
    and linked_v2_task_id = p_task_id
    and task_type = 'inventory'
    and status = 'submitted'
  for update;
  if v_inventory.id is null then
    raise exception '关联点货单尚未提交或不属于当前任务' using errcode = '23514';
  end if;
  if v_task.inventory_correction_task_id is not null
     and v_inventory.id <> v_task.inventory_correction_task_id then
    raise exception '请审核本轮重新提交的点货结果' using errcode = '55000';
  end if;

  select coalesce(array_agg(distinct item_id), '{}'::uuid[])
  into v_rejected_inventory_ids
  from unnest(coalesce(p_inventory_rejected_item_ids, '{}'::uuid[])) item_id;

  select count(*) into v_inventory_item_count
  from public.task_items where task_id = v_inventory.id;
  select count(*) into v_rejected_count
  from public.task_items
  where task_id = v_inventory.id and id = any(v_rejected_inventory_ids);
  if v_inventory_item_count = 0 then
    raise exception '关联点货单没有可审核条目' using errcode = '55000';
  end if;
  if v_rejected_count <> cardinality(v_rejected_inventory_ids) then
    raise exception '包含不属于当前点货单的驳回条目' using errcode = '22023';
  end if;
  if v_rejected_count > 0 and btrim(coalesce(p_note, '')) = '' then
    raise exception 'rejection reason required' using errcode = '23514';
  end if;

  v_expected_answer_status := case when v_task.status = 'resubmitted' then 'resubmitted' else 'pending' end;
  select count(*) into v_reviewable_answer_count
  from public.v2_task_answers
  where task_id = p_task_id and review_status = v_expected_answer_status;

  if v_reviewable_answer_count > 0 then
    v_result := public.review_v2_task_items(p_task_id, p_decisions, p_note);
    v_base_status := v_result ->> 'status';
    v_base_version := (v_result ->> 'version')::integer;
    select * into v_task from public.v2_tasks where id = p_task_id for update;
  elsif jsonb_array_length(p_decisions) <> 0 then
    raise exception 'no task items require review' using errcode = '55000';
  elsif v_task.status not in ('submitted', 'resubmitted') then
    raise exception 'task is not reviewable' using errcode = '55000';
  else
    v_base_status := null;
    v_base_version := v_task.version;
  end if;

  if v_rejected_count > 0 then
    insert into public.tasks(
      store_id, created_by, task_type, status, inventory_category_codes,
      linked_v2_task_id, inventory_recount_only
    ) values (
      v_inventory.store_id, v_inventory.created_by, 'inventory', 'draft',
      v_inventory.inventory_category_codes, p_task_id, true
    ) returning * into v_recount;

    with inserted as (
      insert into public.task_items(
        task_id, store_id, product_id, product_snapshot, status, quantity,
        sort_order, is_extra_item
      )
      select
        v_recount.id, source.store_id, source.product_id, source.product_snapshot,
        'pending', null, source.sort_order, source.is_extra_item
      from public.task_items source
      where source.task_id = v_inventory.id
        and source.id = any(v_rejected_inventory_ids)
      order by source.sort_order, source.id
      returning id
    )
    select coalesce(array_agg(id), '{}'::uuid[]) into v_new_item_ids from inserted;

    if v_base_status = 'approved' then
      delete from public.notifications
      where dedupe_key = 'v2-task-review:' || p_task_id || ':' || v_base_version;
      delete from public.v2_task_reviews
      where task_id = p_task_id and action = 'approved'
        and actor_id = auth.uid() and created_at >= v_started;
      delete from public.audit_logs
      where entity_table = 'v2_tasks' and entity_id = p_task_id
        and action = 'v2_task_approved' and actor_id = auth.uid()
        and created_at >= v_started;
    end if;

    update public.v2_tasks
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
        review_note = coalesce(p_note, ''),
        inventory_correction_task_id = v_recount.id,
        inventory_correction_item_ids = v_new_item_ids,
        version = case when v_base_status = 'approved' or v_base_status is null then version + 1 else version end
    where id = p_task_id
    returning * into v_task;

    if v_base_status = 'rejected' then
      update public.v2_task_reviews
      set inventory_correction_item_ids = v_rejected_inventory_ids
      where id = (
        select id from public.v2_task_reviews
        where task_id = p_task_id and action = 'rejected'
          and actor_id = auth.uid() and created_at >= v_started
        order by created_at desc limit 1
      );
    else
      insert into public.v2_task_reviews(
        task_id, action, actor_id, note, correction_item_ids,
        inventory_correction_item_ids
      ) values (
        p_task_id, 'rejected', auth.uid(), coalesce(p_note, ''),
        v_task.correction_item_ids, v_rejected_inventory_ids
      );
      insert into public.notifications(
        recipient_user_id, store_id, type, title, body,
        entity_type, entity_id, dedupe_key
      ) values (
        coalesce(v_task.submitted_by, v_task.started_by), v_task.store_id,
        'v2_task_rejected', '任务需要整改',
        coalesce(nullif(left(btrim(coalesce(p_note, '')), 180), ''), '部分点货结果需要重新点货，请打开任务查看。'),
        'v2_task', v_task.id,
        'v2-task-review:' || v_task.id || ':' || v_task.version
      ) on conflict(dedupe_key) do nothing;
    end if;

    insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
    values(
      v_task.store_id, auth.uid(), 'v2_task_inventory_items_rejected',
      'v2_tasks', v_task.id,
      jsonb_build_object(
        'inventory_task_id', v_inventory.id,
        'rejected_inventory_item_ids', v_rejected_inventory_ids,
        'recount_task_id', v_recount.id,
        'recount_item_ids', v_new_item_ids,
        'note', p_note
      )
    );
  else
    v_action := coalesce(v_base_status, 'approved');
    if v_base_status is null then
      update public.v2_tasks
      set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
          review_note = coalesce(p_note, ''), correction_item_ids = '{}'::uuid[],
          inventory_correction_task_id = null,
          inventory_correction_item_ids = '{}'::uuid[], version = version + 1
      where id = p_task_id returning * into v_task;
      insert into public.v2_task_reviews(
        task_id, action, actor_id, note, correction_item_ids,
        inventory_correction_item_ids
      ) values (p_task_id, 'approved', auth.uid(), coalesce(p_note, ''), '{}'::uuid[], '{}'::uuid[]);
      insert into public.notifications(
        recipient_user_id, store_id, type, title, body,
        entity_type, entity_id, dedupe_key
      ) values (
        coalesce(v_task.submitted_by, v_task.started_by), v_task.store_id,
        'v2_task_approved', '任务审核通过', v_task.name,
        'v2_task', v_task.id,
        'v2-task-review:' || v_task.id || ':' || v_task.version
      ) on conflict(dedupe_key) do nothing;
      insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
      values(v_task.store_id, auth.uid(), 'v2_task_approved', 'v2_tasks', v_task.id,
        jsonb_build_object('note', p_note, 'inventory_task_id', v_inventory.id));
    else
      update public.v2_tasks
      set inventory_correction_task_id = null,
          inventory_correction_item_ids = '{}'::uuid[]
      where id = p_task_id returning * into v_task;
    end if;
  end if;

  return to_jsonb(v_task);
end;
$$;

revoke all on function public.review_v2_task_items_with_inventory(uuid, jsonb, text, uuid, uuid[]) from public, anon;
grant execute on function public.review_v2_task_items_with_inventory(uuid, jsonb, text, uuid, uuid[]) to authenticated;
