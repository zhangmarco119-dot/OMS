-- Product management improvements:
-- 1. expose the latest submitted inventory quantity for every product;
-- 2. allow managers/admins to correct arrival product requests before approval;
-- 3. publish one-off product correction tasks and apply approved items.

create or replace function public.list_admin_products_with_last_inventory(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
begin
  if public.current_user_role() <> 'admin' or not public.has_store_access(p_store_id) then
    raise exception 'administrator store access required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    to_jsonb(product) || jsonb_build_object(
      'last_inventory_quantity', latest.quantity,
      'last_inventory_item_status', latest.item_status,
      'last_inventory_submitted_at', latest.submitted_at
    )
    order by product.sort_order, product.name
  ), '[]'::jsonb)
  into v_result
  from public.products product
  left join lateral (
    select item.quantity, item.status as item_status, task.submitted_at
    from public.task_items item
    join public.tasks task on task.id = item.task_id
    where item.product_id = product.id
      and task.store_id = product.store_id
      and task.task_type = 'inventory'
      and task.status = 'submitted'
      and task.submitted_at is not null
    order by task.submitted_at desc, item.updated_at desc
    limit 1
  ) latest on true
  where product.store_id = p_store_id;

  return v_result;
end;
$$;

create or replace function public.review_product_creation_request_v2(
  p_request_id uuid,
  p_action text,
  p_name text default null,
  p_spec text default null,
  p_count_unit text default null,
  p_category_code text default null,
  p_note text default null
)
returns public.product_creation_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.product_creation_requests%rowtype;
  v_product public.products%rowtype;
  v_name text;
  v_spec text;
  v_count_unit text;
  v_category_code text;
  v_original jsonb;
begin
  select * into v_request
  from public.product_creation_requests
  where id = p_request_id
  for update;

  if v_request.id is null or not public.can_manage_store(v_request.store_id) then
    raise exception '没有权限审核此货品申请' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception '此货品申请已处理' using errcode = '55000';
  end if;

  v_original := jsonb_build_object(
    'name', v_request.name,
    'spec', v_request.spec,
    'count_unit', v_request.count_unit,
    'category_code', v_request.category_code
  );

  if p_action = 'approve' then
    v_name := btrim(coalesce(p_name, v_request.name));
    v_spec := btrim(coalesce(p_spec, v_request.spec));
    v_count_unit := btrim(coalesce(p_count_unit, v_request.count_unit));
    v_category_code := btrim(coalesce(p_category_code, v_request.category_code));

    if v_name = '' or v_spec = '' or v_count_unit = '' then
      raise exception '货品名称、规格和单位均为必填项' using errcode = '23514';
    end if;
    if not exists(select 1 from public.product_categories where code = v_category_code) then
      raise exception '请选择有效的货品分类' using errcode = '23514';
    end if;

    select * into v_product
    from public.products
    where store_id = v_request.store_id
      and public.normalize_product_name(name) = public.normalize_product_name(v_name)
    limit 1
    for update;

    if v_product.id is not null then
      raise exception '货品列表中已有货品“%”，不可重复新增。', v_product.name
        using errcode = '23505', constraint = 'products_store_normalized_name_uidx';
    end if;

    insert into public.products(store_id, name, spec, count_unit, category_code, sort_order, is_active)
    values(
      v_request.store_id,
      v_name,
      v_spec,
      v_count_unit,
      v_category_code,
      (select coalesce(max(sort_order), 0) + 10 from public.products where store_id = v_request.store_id),
      true
    )
    returning * into v_product;

    update public.arrival_report_items
    set product_id = v_product.id,
        is_unmatched_product = false,
        product_name_snapshot = v_product.name,
        unit = v_product.count_unit
    where id = v_request.arrival_item_id;

    update public.product_creation_requests
    set name = v_name,
        spec = v_spec,
        count_unit = v_count_unit,
        category_code = v_category_code,
        status = 'approved',
        product_id = v_product.id,
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_note = nullif(btrim(p_note), '')
    where id = v_request.id
    returning * into v_request;
  elsif p_action = 'reject' then
    update public.product_creation_requests
    set status = 'rejected',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_note = nullif(btrim(p_note), '')
    where id = v_request.id
    returning * into v_request;
  else
    raise exception '无效的审核操作' using errcode = '22023';
  end if;

  delete from public.notifications
  where entity_type = 'product_creation_request' and entity_id = v_request.id;

  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values(
    v_request.store_id,
    auth.uid(),
    'product_creation_request_' || v_request.status,
    'product_creation_requests',
    v_request.id,
    jsonb_build_object(
      'product_id', v_request.product_id,
      'original', v_original,
      'reviewed', jsonb_build_object(
        'name', v_request.name,
        'spec', v_request.spec,
        'count_unit', v_request.count_unit,
        'category_code', v_request.category_code
      )
    )
  );
  return v_request;
end;
$$;

create or replace function public.publish_product_correction_tasks(
  p_store_id uuid,
  p_items jsonb,
  p_due_at timestamptz,
  p_publish_at timestamptz default now(),
  p_profile_ids uuid[] default '{}',
  p_target_audiences text[] default array['staff', 'manager']::text[],
  p_manager_review_enabled boolean default false
)
returns setof public.v2_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.v2_task_templates%rowtype;
  v_version public.v2_task_template_versions%rowtype;
  v_group_id uuid := gen_random_uuid();
  v_task public.v2_tasks%rowtype;
  v_profile public.profiles%rowtype;
  v_entry jsonb;
  v_item jsonb;
  v_snapshot_items jsonb := '[]'::jsonb;
  v_snapshot jsonb;
  v_item_id uuid;
  v_product public.products%rowtype;
  v_action text;
  v_name text;
  v_spec text;
  v_count_unit text;
  v_category_code text;
  v_audience text;
  v_publish_at timestamptz := coalesce(p_publish_at, now());
  v_task_name text;
  v_store_name text;
begin
  if public.current_user_role() <> 'admin' or not public.has_store_access(p_store_id) then
    raise exception 'administrator store access required' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 100 then
    raise exception '请选择 1 至 100 个需要更正的货品' using errcode = '22023';
  end if;
  if v_publish_at < now() - interval '1 minute' then
    raise exception '发布时间不能早于当前时间' using errcode = '22023';
  end if;
  if p_due_at <= v_publish_at then
    raise exception '验收截止时间必须晚于发布时间' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_target_audiences), 0) = 0
     or not p_target_audiences <@ array['staff', 'manager', 'part_time']::text[] then
    raise exception '请选择有效的任务接收范围' using errcode = '22023';
  end if;

  select name into v_store_name from public.stores where id = p_store_id;
  v_task_name := coalesce(v_store_name, '门店') || '货品信息更正';

  for v_entry in select value from jsonb_array_elements(p_items)
  loop
    v_action := coalesce(v_entry ->> 'product_action', 'update');
    v_name := btrim(coalesce(v_entry ->> 'name', ''));
    v_spec := btrim(coalesce(v_entry ->> 'spec', ''));
    v_count_unit := btrim(coalesce(v_entry ->> 'count_unit', ''));
    v_category_code := btrim(coalesce(v_entry ->> 'category_code', ''));
    if v_action not in ('update', 'create') or v_name = '' then
      raise exception '货品更正项缺少有效的名称或操作类型' using errcode = '22023';
    end if;
    if not exists(select 1 from public.product_categories where code = v_category_code) then
      raise exception '货品“%”的分类无效', v_name using errcode = '22023';
    end if;
    if v_action = 'update' then
      select * into v_product
      from public.products
      where id = nullif(v_entry ->> 'product_id', '')::uuid and store_id = p_store_id;
      if v_product.id is null then
        raise exception '待更正货品“%”不存在或不属于当前门店', v_name using errcode = 'P0002';
      end if;
    else
      v_product := null;
    end if;

    v_item_id := gen_random_uuid();
    v_item := jsonb_build_object(
      'id', v_item_id,
      'label', v_name,
      'guidance', '请核对并填写正确的货品名称、完整规格、最小点货单位和分类。',
      'field_type', 'short_text',
      'is_required', true,
      'sort_order', jsonb_array_length(v_snapshot_items),
      'answer_schema', 'product_correction',
      'product_action', v_action,
      'product_id', case when v_product.id is null then null else to_jsonb(v_product.id) end,
      'source_key', nullif(v_entry ->> 'source_key', ''),
      'current_name', v_name,
      'current_spec', v_spec,
      'current_count_unit', v_count_unit,
      'current_category_code', v_category_code,
      'initial_answer', jsonb_build_object(
        'name', v_name,
        'spec', v_spec,
        'count_unit', v_count_unit,
        'category_code', v_category_code
      )
    );
    v_snapshot_items := v_snapshot_items || jsonb_build_array(v_item);
  end loop;

  v_snapshot := jsonb_build_object(
    'workflow_type', 'product_correction',
    'template', jsonb_build_object(
      'name', v_task_name,
      'category', 'temporary',
      'description', '逐项核对并更正货品信息。',
      'allow_overdue', false,
      'requires_review', true
    ),
    'groups', jsonb_build_array(jsonb_build_object(
      'id', v_group_id,
      'title', '待更正货品',
      'description', '请逐一填写正确的名称、规格、单位和分类。',
      'sort_order', 0,
      'items', v_snapshot_items
    ))
  );

  insert into public.v2_task_templates(
    name, category, description, requires_review, allow_overdue, recurrence,
    status, current_version, created_by
  ) values (
    v_task_name, 'temporary', '由货品管理批量生成的更正任务。', true, false, 'none',
    'archived', 1, auth.uid()
  ) returning * into v_template;

  insert into public.v2_task_template_stores(template_id, store_id)
  values(v_template.id, p_store_id);
  insert into public.v2_task_template_groups(id, template_id, title, description, sort_order)
  values(v_group_id, v_template.id, '待更正货品', '请逐一填写正确的名称、规格、单位和分类。', 0);
  for v_item in select value from jsonb_array_elements(v_snapshot_items)
  loop
    insert into public.v2_task_template_items(
      id, template_id, group_id, label, guidance, field_type, is_required,
      image_requirement, options, sort_order
    ) values (
      (v_item ->> 'id')::uuid, v_template.id, v_group_id, v_item ->> 'label',
      v_item ->> 'guidance', 'short_text', true, 'none', '[]'::jsonb,
      (v_item ->> 'sort_order')::integer
    );
  end loop;
  insert into public.v2_task_template_versions(template_id, version_number, snapshot, published_by)
  values(v_template.id, 1, v_snapshot, auth.uid())
  returning * into v_version;

  if coalesce(cardinality(p_profile_ids), 0) > 0 then
    for v_profile in
      select distinct profile.*
      from public.profiles profile
      where profile.id = any(p_profile_ids)
      order by profile.display_name, profile.id
    loop
      if not v_profile.is_active or v_profile.deleted_at is not null
         or v_profile.role not in ('staff', 'manager')
         or not (
           v_profile.store_id = p_store_id
           or exists(
             select 1 from public.profile_store_access access
             where access.profile_id = v_profile.id and access.store_id = p_store_id
           )
         ) then
        raise exception 'task recipient access denied' using errcode = '42501';
      end if;
      v_audience := public.v2_task_audience_for_profile(v_profile.id);
      insert into public.v2_tasks(
        template_id, template_version_id, store_id, assigned_profile_id,
        target_audiences, name, category, snapshot, due_at, publish_at,
        allow_overdue, requires_review, manager_review_enabled, created_by
      ) values (
        v_template.id, v_version.id, p_store_id, v_profile.id,
        array[v_audience], v_task_name, 'temporary', v_snapshot, p_due_at, v_publish_at,
        false, true, p_manager_review_enabled, auth.uid()
      ) returning * into v_task;

      for v_item in select value from jsonb_array_elements(v_snapshot_items)
      loop
        insert into public.v2_task_answers(task_id, item_id, group_id, item_snapshot, answer)
        values(v_task.id, (v_item ->> 'id')::uuid, v_group_id, v_item, v_item -> 'initial_answer');
      end loop;
      perform public.notify_v2_task_publication(v_task.id);
      return next v_task;
    end loop;
    if not found then
      raise exception 'task recipient required' using errcode = '22023';
    end if;
    return;
  end if;

  insert into public.v2_tasks(
    template_id, template_version_id, store_id, target_audiences, name, category,
    snapshot, due_at, publish_at, allow_overdue, requires_review,
    manager_review_enabled, created_by
  ) values (
    v_template.id, v_version.id, p_store_id, p_target_audiences, v_task_name, 'temporary',
    v_snapshot, p_due_at, v_publish_at, false, true, p_manager_review_enabled, auth.uid()
  ) returning * into v_task;
  for v_item in select value from jsonb_array_elements(v_snapshot_items)
  loop
    insert into public.v2_task_answers(task_id, item_id, group_id, item_snapshot, answer)
    values(v_task.id, (v_item ->> 'id')::uuid, v_group_id, v_item, v_item -> 'initial_answer');
  end loop;
  perform public.notify_v2_task_publication(v_task.id);
  return next v_task;
end;
$$;

-- Extend the per-item review workflow while preserving the earlier
-- product_spec_correction tasks already assigned to managers.
create or replace function public.review_v2_task_items(
  p_task_id uuid,
  p_decisions jsonb,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.v2_tasks%rowtype;
  v_expected_status text;
  v_eligible_count integer;
  v_processed_count integer := 0;
  v_rejected_ids uuid[] := '{}'::uuid[];
  v_decision jsonb;
  v_item_id uuid;
  v_value text;
  v_item_note text;
  v_round integer;
  v_action text;
  v_answer jsonb;
  v_item_snapshot jsonb;
  v_product_id uuid;
  v_product public.products%rowtype;
  v_name text;
  v_spec text;
  v_count_unit text;
  v_category_code text;
  v_workflow_type text;
  v_is_product_workflow boolean;
begin
  select * into v_task from public.v2_tasks where id = p_task_id for update;
  if v_task.id is null or not public.can_review_v2_task(p_task_id) then
    raise exception 'review denied' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_decisions, 'null'::jsonb)) <> 'array' then
    raise exception 'review decisions must be an array' using errcode = '22023';
  end if;

  v_workflow_type := coalesce(v_task.snapshot ->> 'workflow_type', '');
  v_is_product_workflow := v_workflow_type in ('product_spec_correction', 'product_correction');
  v_expected_status := case when v_task.status = 'resubmitted' then 'resubmitted' else 'pending' end;
  select count(*) into v_eligible_count
  from public.v2_task_answers
  where task_id = p_task_id and review_status = v_expected_status;
  if v_eligible_count = 0 then
    raise exception 'no task items require review' using errcode = '55000';
  end if;

  for v_decision in select value from jsonb_array_elements(p_decisions)
  loop
    v_item_id := (v_decision ->> 'item_id')::uuid;
    v_value := v_decision ->> 'decision';
    v_item_note := btrim(coalesce(v_decision ->> 'note', ''));
    if v_value not in ('approved', 'rejected') then
      raise exception 'invalid item review decision' using errcode = '22023';
    end if;
    select submission_round, answer, item_snapshot
    into v_round, v_answer, v_item_snapshot
    from public.v2_task_answers
    where task_id = p_task_id and item_id = v_item_id and review_status = v_expected_status
    for update;
    if not found then
      raise exception 'task item is not reviewable' using errcode = '55000';
    end if;

    if v_is_product_workflow and v_value = 'approved' then
      if jsonb_typeof(coalesce(v_answer, 'null'::jsonb)) <> 'object' then
        raise exception 'invalid product correction task item' using errcode = '22023';
      end if;
      v_spec := btrim(coalesce(v_answer ->> 'spec', ''));
      v_count_unit := btrim(coalesce(v_answer ->> 'count_unit', ''));
      if v_spec = '' or v_count_unit = '' then
        raise exception '货品规格和单位均为必填项' using errcode = '23514';
      end if;

      if v_workflow_type = 'product_spec_correction' then
        if coalesce(v_item_snapshot ->> 'answer_schema', '') <> 'product_spec'
           or nullif(v_item_snapshot ->> 'product_id', '') is null then
          raise exception 'invalid product specification task item' using errcode = '22023';
        end if;
        v_product_id := (v_item_snapshot ->> 'product_id')::uuid;
        select * into v_product from public.products
        where id = v_product_id and store_id = v_task.store_id for update;
        if v_product.id is null then
          raise exception 'product for task item not found' using errcode = 'P0002';
        end if;
        if nullif(v_item_snapshot ->> 'product_name', '') is not null
           and v_product.name <> v_item_snapshot ->> 'product_name' then
          raise exception 'product name changed after task publication' using errcode = '55000';
        end if;
        update public.products set spec = v_spec, count_unit = v_count_unit where id = v_product.id;
      else
        if coalesce(v_item_snapshot ->> 'answer_schema', '') <> 'product_correction' then
          raise exception 'invalid product correction task item' using errcode = '22023';
        end if;
        v_name := btrim(coalesce(v_answer ->> 'name', ''));
        v_category_code := btrim(coalesce(v_answer ->> 'category_code', ''));
        if v_name = '' then
          raise exception '货品名称为必填项' using errcode = '23514';
        end if;
        if not exists(select 1 from public.product_categories where code = v_category_code) then
          raise exception '请选择有效的货品分类' using errcode = '23514';
        end if;

        if coalesce(v_item_snapshot ->> 'product_action', 'update') = 'create' then
          select * into v_product from public.products
          where store_id = v_task.store_id
            and public.normalize_product_name(name) = public.normalize_product_name(v_name)
          limit 1 for update;
          if v_product.id is null then
            insert into public.products(store_id, name, spec, count_unit, category_code, sort_order, is_active)
            values(
              v_task.store_id, v_name, v_spec, v_count_unit, v_category_code,
              (select coalesce(max(sort_order), 0) + 10 from public.products where store_id = v_task.store_id), true
            ) returning * into v_product;
          else
            update public.products
            set name = v_name, spec = v_spec, count_unit = v_count_unit,
                category_code = v_category_code, is_active = true
            where id = v_product.id
            returning * into v_product;
          end if;
        else
          v_product_id := nullif(v_item_snapshot ->> 'product_id', '')::uuid;
          select * into v_product from public.products
          where id = v_product_id and store_id = v_task.store_id for update;
          if v_product.id is null then
            raise exception 'product for task item not found' using errcode = 'P0002';
          end if;
          update public.products
          set name = v_name, spec = v_spec, count_unit = v_count_unit,
              category_code = v_category_code, is_active = true
          where id = v_product.id
          returning * into v_product;
        end if;
      end if;

      insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
      values(
        v_task.store_id, auth.uid(), case when v_workflow_type = 'product_spec_correction' then 'product_spec_updated_from_task' else 'product_updated_from_task' end, 'products', v_product.id,
        jsonb_build_object('task_id', v_task.id, 'item_id', v_item_id, 'answer', v_answer, 'workflow_type', v_workflow_type)
      );
    end if;

    update public.v2_task_answers
    set review_status = v_value,
        last_reviewed_by = auth.uid(),
        last_reviewed_at = now(),
        note = case when v_is_product_workflow and v_value = 'rejected' then v_item_note when v_is_product_workflow then '' else note end
    where task_id = p_task_id and item_id = v_item_id;

    insert into public.v2_task_item_reviews(task_id, item_id, submission_round, decision, actor_id, note)
    values(p_task_id, v_item_id, v_round, v_value, auth.uid(), case when v_is_product_workflow then v_item_note else coalesce(p_note, '') end);
    if v_value = 'rejected' then v_rejected_ids := array_append(v_rejected_ids, v_item_id); end if;
    v_processed_count := v_processed_count + 1;
  end loop;

  if v_processed_count <> v_eligible_count then
    raise exception 'every reviewable task item needs a decision' using errcode = '22023';
  end if;
  if coalesce(array_length(v_rejected_ids, 1), 0) > 0
     and not v_is_product_workflow and btrim(coalesce(p_note, '')) = '' then
    raise exception 'rejection reason required' using errcode = '23514';
  end if;

  v_action := case when coalesce(array_length(v_rejected_ids, 1), 0) > 0 then 'rejected' else 'approved' end;
  update public.v2_tasks
  set status = v_action, reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = coalesce(p_note, ''),
      correction_item_ids = case when v_action = 'rejected' then v_rejected_ids else '{}'::uuid[] end,
      version = version + 1
  where id = p_task_id returning * into v_task;

  insert into public.v2_task_reviews(task_id, action, actor_id, note, correction_item_ids)
  values(p_task_id, v_action, auth.uid(), coalesce(p_note, ''), v_rejected_ids);
  insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  values(
    coalesce(v_task.submitted_by, v_task.started_by), v_task.store_id, 'v2_task_' || v_action,
    case when v_action = 'approved' then '任务审核通过' else '任务需要整改' end,
    case when v_action = 'approved' then v_task.name else coalesce(nullif(left(btrim(coalesce(p_note, '')), 180), ''), case when v_workflow_type = 'product_spec_correction' then '有货品规格需要修改，请打开任务查看。' else '有货品信息需要修改，请打开任务查看。' end) end,
    'v2_task', v_task.id, 'v2-task-review:' || v_task.id || ':' || v_task.version
  ) on conflict(dedupe_key) do nothing;
  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values(v_task.store_id, auth.uid(), 'v2_task_' || v_action, 'v2_tasks', v_task.id,
    jsonb_build_object('note', p_note, 'item_decisions', p_decisions, 'reviewer_role', public.current_user_role(), 'workflow_type', v_workflow_type));
  return to_jsonb(v_task);
end;
$$;

revoke all on function public.list_admin_products_with_last_inventory(uuid) from public, anon;
revoke all on function public.review_product_creation_request_v2(uuid, text, text, text, text, text, text) from public, anon;
revoke all on function public.publish_product_correction_tasks(uuid, jsonb, timestamptz, timestamptz, uuid[], text[], boolean) from public, anon;
grant execute on function public.list_admin_products_with_last_inventory(uuid) to authenticated;
grant execute on function public.review_product_creation_request_v2(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.publish_product_correction_tasks(uuid, jsonb, timestamptz, timestamptz, uuid[], text[], boolean) to authenticated;
