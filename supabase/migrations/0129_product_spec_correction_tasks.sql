-- Allow a manager to complete product specifications inside an assigned task.
-- Administrators review each product independently; approved answers are
-- written to the product library immediately, while rejected answers remain
-- editable for a focused resubmission.

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
  v_spec text;
  v_count_unit text;
  v_is_product_spec_workflow boolean;
begin
  select * into v_task
  from public.v2_tasks
  where id = p_task_id
  for update;

  if v_task.id is null or not public.can_review_v2_task(p_task_id) then
    raise exception 'review denied' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_decisions, 'null'::jsonb)) <> 'array' then
    raise exception 'review decisions must be an array' using errcode = '22023';
  end if;

  v_is_product_spec_workflow := coalesce(v_task.snapshot ->> 'workflow_type', '') = 'product_spec_correction';
  v_expected_status := case when v_task.status = 'resubmitted' then 'resubmitted' else 'pending' end;

  select count(*) into v_eligible_count
  from public.v2_task_answers
  where task_id = p_task_id
    and review_status = v_expected_status;

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
    where task_id = p_task_id
      and item_id = v_item_id
      and review_status = v_expected_status
    for update;

    if not found then
      raise exception 'task item is not reviewable' using errcode = '55000';
    end if;

    if v_is_product_spec_workflow and v_value = 'approved' then
      if coalesce(v_item_snapshot ->> 'answer_schema', '') <> 'product_spec'
        or nullif(v_item_snapshot ->> 'product_id', '') is null
        or jsonb_typeof(coalesce(v_answer, 'null'::jsonb)) <> 'object'
      then
        raise exception 'invalid product specification task item' using errcode = '22023';
      end if;

      v_product_id := (v_item_snapshot ->> 'product_id')::uuid;
      v_spec := btrim(coalesce(v_answer ->> 'spec', ''));
      v_count_unit := btrim(coalesce(v_answer ->> 'count_unit', ''));
      if v_spec = '' or v_count_unit = '' then
        raise exception 'product specification and count unit are required' using errcode = '23514';
      end if;

      select * into v_product
      from public.products
      where id = v_product_id
        and store_id = v_task.store_id
      for update;
      if v_product.id is null then
        raise exception 'product for task item not found' using errcode = 'P0002';
      end if;
      if nullif(v_item_snapshot ->> 'product_name', '') is not null
        and v_product.name <> v_item_snapshot ->> 'product_name'
      then
        raise exception 'product name changed after task publication' using errcode = '55000';
      end if;

      update public.products
      set spec = v_spec,
          count_unit = v_count_unit
      where id = v_product.id;

      insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
      values(
        v_task.store_id,
        auth.uid(),
        'product_spec_updated_from_task',
        'products',
        v_product.id,
        jsonb_build_object(
          'task_id', v_task.id,
          'item_id', v_item_id,
          'before', jsonb_build_object('spec', v_product.spec, 'count_unit', v_product.count_unit),
          'after', jsonb_build_object('spec', v_spec, 'count_unit', v_count_unit)
        )
      );
    end if;

    update public.v2_task_answers
    set review_status = v_value,
        last_reviewed_by = auth.uid(),
        last_reviewed_at = now(),
        note = case
          when v_is_product_spec_workflow and v_value = 'rejected' then v_item_note
          when v_is_product_spec_workflow then ''
          else note
        end
    where task_id = p_task_id
      and item_id = v_item_id;

    insert into public.v2_task_item_reviews(
      task_id, item_id, submission_round, decision, actor_id, note
    ) values (
      p_task_id, v_item_id, v_round, v_value, auth.uid(),
      case when v_is_product_spec_workflow then v_item_note else coalesce(p_note, '') end
    );

    if v_value = 'rejected' then
      v_rejected_ids := array_append(v_rejected_ids, v_item_id);
    end if;
    v_processed_count := v_processed_count + 1;
  end loop;

  if v_processed_count <> v_eligible_count then
    raise exception 'every reviewable task item needs a decision' using errcode = '22023';
  end if;
  if coalesce(array_length(v_rejected_ids, 1), 0) > 0
    and not v_is_product_spec_workflow
    and btrim(coalesce(p_note, '')) = ''
  then
    raise exception 'rejection reason required' using errcode = '23514';
  end if;

  v_action := case when coalesce(array_length(v_rejected_ids, 1), 0) > 0 then 'rejected' else 'approved' end;
  update public.v2_tasks
  set status = v_action,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = coalesce(p_note, ''),
      correction_item_ids = case when v_action = 'rejected' then v_rejected_ids else '{}'::uuid[] end,
      version = version + 1
  where id = p_task_id
  returning * into v_task;

  insert into public.v2_task_reviews(task_id, action, actor_id, note, correction_item_ids)
  values(p_task_id, v_action, auth.uid(), coalesce(p_note, ''), v_rejected_ids);

  insert into public.notifications(
    recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key
  ) values (
    coalesce(v_task.submitted_by, v_task.started_by),
    v_task.store_id,
    'v2_task_' || v_action,
    case when v_action = 'approved' then '任务审核通过' else '任务需要整改' end,
    case
      when v_action = 'approved' then v_task.name
      else coalesce(nullif(left(btrim(coalesce(p_note, '')), 180), ''), '有货品规格需要修改，请打开任务查看。')
    end,
    'v2_task',
    v_task.id,
    'v2-task-review:' || v_task.id || ':' || v_task.version
  ) on conflict(dedupe_key) do nothing;

  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values(
    v_task.store_id,
    auth.uid(),
    'v2_task_' || v_action,
    'v2_tasks',
    v_task.id,
    jsonb_build_object(
      'note', p_note,
      'item_decisions', p_decisions,
      'reviewer_role', public.current_user_role(),
      'workflow_type', v_task.snapshot ->> 'workflow_type'
    )
  );

  return to_jsonb(v_task);
end;
$$;

revoke all on function public.review_v2_task_items(uuid, jsonb, text) from public, anon;
grant execute on function public.review_v2_task_items(uuid, jsonb, text) to authenticated;
