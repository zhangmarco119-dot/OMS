alter table public.v2_task_template_items
  add column if not exists minimum_image_count smallint;

alter table public.v2_task_template_items
  drop constraint if exists v2_task_template_items_minimum_image_count_check;

alter table public.v2_task_template_items
  add constraint v2_task_template_items_minimum_image_count_check
  check (
    minimum_image_count is null
    or (image_requirement = 'multiple' and minimum_image_count between 2 and 20)
  );

create or replace function public.set_v2_task_template_minimum_image_counts(
  p_template_id uuid,
  p_counts jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry jsonb;
  v_item_id uuid;
  v_count smallint;
begin
  if public.current_user_role() <> 'admin' or not public.can_manage_v2_task_template(p_template_id) then
    raise exception 'task template access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_counts, '[]'::jsonb)) <> 'array' then
    raise exception 'minimum image counts must be an array' using errcode = '22023';
  end if;

  update public.v2_task_template_items
  set minimum_image_count = null
  where template_id = p_template_id;

  for v_entry in select value from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) loop
    v_item_id := nullif(v_entry->>'item_id', '')::uuid;
    v_count := nullif(v_entry->>'minimum_image_count', '')::smallint;
    if v_item_id is null or v_count not between 2 and 20 then
      raise exception 'minimum image count must be between 2 and 20' using errcode = '22023';
    end if;
    update public.v2_task_template_items
    set minimum_image_count = v_count
    where id = v_item_id
      and template_id = p_template_id
      and image_requirement = 'multiple';
    if not found then
      raise exception 'multiple-image template item not found' using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function public.submit_v2_task(p_task_id uuid, p_expected_version integer, p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_task public.v2_tasks%rowtype;
  v_missing integer;
  v_is_resubmission boolean;
begin
  select * into v_task from public.v2_tasks where id = p_task_id for update;
  if not public.can_edit_v2_task(p_task_id) then raise exception 'task submit denied' using errcode='42501'; end if;
  if v_task.version <> p_expected_version then raise exception 'task version conflict' using errcode='40001'; end if;

  select count(*) into v_missing
  from public.v2_task_answers answer
  where answer.task_id = p_task_id
    and coalesce((answer.item_snapshot->>'is_required')::boolean, true)
    and (
      ((coalesce(answer.item_snapshot->>'field_type', '') in ('image', 'multi_image')
          or coalesce(answer.item_snapshot->>'image_requirement', 'none') in ('single', 'multiple'))
        and (select count(*) from public.v2_task_images image
             where image.task_id = answer.task_id and image.item_id = answer.item_id)
          < case when coalesce(answer.item_snapshot->>'image_requirement', 'none') = 'multiple'
              then case when answer.item_snapshot ? 'minimum_image_count'
                then greatest(2, least(20, coalesce(nullif(answer.item_snapshot->>'minimum_image_count', '')::integer, 2)))
                else 1 end
              else 1 end)
      or case coalesce(answer.item_snapshot->>'field_type', '')
        when 'instruction' then false
        when 'image' then false
        when 'multi_image' then false
        when 'confirmation' then answer.answer is distinct from 'true'::jsonb
        when 'multi_choice' then answer.answer is null or answer.answer = 'null'::jsonb or (jsonb_typeof(answer.answer) = 'array' and jsonb_array_length(answer.answer) = 0)
        else answer.answer is null or answer.answer = 'null'::jsonb or answer.answer = '""'::jsonb
      end
    );
  if v_missing > 0 then raise exception 'required task answers or images are missing' using errcode='23514'; end if;

  v_is_resubmission := v_task.status = 'rejected';
  if v_is_resubmission then
    update public.v2_task_answers
    set review_status = 'resubmitted', submission_round = greatest(submission_round + 1, 2),
        last_reviewed_by = null, last_reviewed_at = null
    where task_id = p_task_id and item_id = any(v_task.correction_item_ids) and review_status = 'rejected';
  elsif v_task.requires_review then
    update public.v2_task_answers
    set review_status = 'pending', submission_round = greatest(submission_round, 1),
        last_reviewed_by = null, last_reviewed_at = null
    where task_id = p_task_id;
  else
    update public.v2_task_answers
    set review_status = 'approved', submission_round = greatest(submission_round, 1),
        last_reviewed_by = auth.uid(), last_reviewed_at = now()
    where task_id = p_task_id;
  end if;

  update public.v2_tasks
  set status = case when v_is_resubmission then 'resubmitted' when requires_review then 'submitted' else 'approved' end,
      submission_key = p_key, submitted_by = auth.uid(), submitted_at = now(),
      correction_item_ids = case when v_is_resubmission then correction_item_ids else '{}'::uuid[] end,
      version = version + 1
  where id = p_task_id
  returning * into v_task;

  insert into public.v2_task_reviews(task_id, action, actor_id)
  values(p_task_id, case when v_is_resubmission then 'resubmitted' else 'submitted' end, auth.uid());
  insert into public.notifications(recipient_role, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  values('admin', v_task.store_id, 'v2_task_submitted',
    case when v_is_resubmission then '整改任务已重新提交' else '任务待审核' end,
    v_task.name, 'v2_task', v_task.id, 'v2-task-submitted:' || v_task.id || ':' || v_task.version)
  on conflict(dedupe_key) do nothing;
  return to_jsonb(v_task);
end $$;

revoke all on function public.set_v2_task_template_minimum_image_counts(uuid, jsonb) from public, anon;
grant execute on function public.set_v2_task_template_minimum_image_counts(uuid, jsonb) to authenticated;
grant execute on function public.submit_v2_task(uuid, integer, text) to authenticated;
