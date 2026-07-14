-- Add stable per-item review state so partial rejection and focused re-review are
-- enforced by the database instead of being only a presentation convention.
alter table public.v2_task_answers
  add column review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected', 'resubmitted')),
  add column submission_round integer not null default 0 check (submission_round >= 0),
  add column last_reviewed_by uuid references public.profiles(id),
  add column last_reviewed_at timestamptz;

update public.v2_task_answers answer
set review_status = case
  when task.status = 'approved' then 'approved'
  when task.status = 'rejected' and answer.item_id = any(task.correction_item_ids) then 'rejected'
  when task.status = 'rejected' then 'approved'
  when task.status = 'resubmitted' then 'resubmitted'
  else 'pending'
end,
submission_round = case when task.status in ('submitted', 'approved', 'rejected', 'resubmitted') then 1 else 0 end
from public.v2_tasks task
where task.id = answer.task_id;

create table public.v2_task_item_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.v2_tasks(id) on delete cascade,
  item_id uuid not null,
  submission_round integer not null check (submission_round > 0),
  decision text not null check (decision in ('approved', 'rejected')),
  actor_id uuid not null references public.profiles(id),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique(task_id, item_id, submission_round)
);

create index v2_task_item_reviews_task_idx on public.v2_task_item_reviews(task_id, created_at);
alter table public.v2_task_item_reviews enable row level security;
create policy v2_task_item_reviews_select_allowed on public.v2_task_item_reviews
  for select to authenticated using(public.can_read_v2_task(task_id));
revoke insert, update, delete on public.v2_task_item_reviews from authenticated;
grant select on public.v2_task_item_reviews to authenticated;

create or replace function public.can_edit_v2_task_item(p_task_id uuid, p_item_id uuid)
returns boolean language sql security definer set search_path=public stable as $$
  select exists(
    select 1
    from public.v2_tasks task
    where task.id = p_task_id
      and public.can_edit_v2_task(task.id)
      and (task.status <> 'rejected' or p_item_id = any(task.correction_item_ids))
  )
$$;

drop policy if exists v2_task_images_insert_allowed on public.v2_task_images;
drop policy if exists v2_task_images_delete_allowed on public.v2_task_images;
create policy v2_task_images_insert_allowed on public.v2_task_images
  for insert to authenticated
  with check(uploaded_by = auth.uid() and public.can_edit_v2_task_item(task_id, item_id));
create policy v2_task_images_delete_allowed on public.v2_task_images
  for delete to authenticated
  using(uploaded_by = auth.uid() and public.can_edit_v2_task_item(task_id, item_id));

create or replace function public.save_v2_task_progress(p_task_id uuid, p_expected_version integer, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_task public.v2_tasks%rowtype;
  v_answer jsonb;
  v_item_id uuid;
begin
  select * into v_task from public.v2_tasks where id = p_task_id for update;
  if not public.can_edit_v2_task(p_task_id) then raise exception 'task edit denied' using errcode='42501'; end if;
  if v_task.version <> p_expected_version then raise exception 'task version conflict' using errcode='40001'; end if;

  for v_answer in select value from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) loop
    v_item_id := (v_answer->>'item_id')::uuid;
    if not exists(select 1 from public.v2_task_answers where task_id = p_task_id and item_id = v_item_id) then
      raise exception 'task item not found' using errcode='P0002';
    end if;
    -- Approved items remain immutable while an employee corrects rejected work.
    if v_task.status = 'rejected' and not (v_item_id = any(v_task.correction_item_ids)) then
      continue;
    end if;
    update public.v2_task_answers
    set answer = v_answer->'answer',
        note = coalesce(v_answer->>'note', ''),
        is_issue = coalesce((v_answer->>'is_issue')::boolean, false),
        updated_by = auth.uid(),
        updated_at = now()
    where task_id = p_task_id and item_id = v_item_id;
  end loop;

  update public.v2_tasks
  set status = case when status = 'pending' then 'in_progress' else status end,
      started_by = coalesce(started_by, auth.uid()),
      started_at = coalesce(started_at, now()),
      version = version + 1
  where id = p_task_id
  returning * into v_task;
  return to_jsonb(v_task);
end $$;

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
        and not exists(select 1 from public.v2_task_images image where image.task_id = answer.task_id and image.item_id = answer.item_id))
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
    set review_status = 'resubmitted',
        submission_round = greatest(submission_round + 1, 2),
        last_reviewed_by = null,
        last_reviewed_at = null
    where task_id = p_task_id and item_id = any(v_task.correction_item_ids) and review_status = 'rejected';
  elsif v_task.requires_review then
    update public.v2_task_answers
    set review_status = 'pending',
        submission_round = greatest(submission_round, 1),
        last_reviewed_by = null,
        last_reviewed_at = null
    where task_id = p_task_id;
  else
    update public.v2_task_answers
    set review_status = 'approved',
        submission_round = greatest(submission_round, 1),
        last_reviewed_by = auth.uid(),
        last_reviewed_at = now()
    where task_id = p_task_id;
  end if;

  update public.v2_tasks
  set status = case when v_is_resubmission then 'resubmitted' when requires_review then 'submitted' else 'approved' end,
      submission_key = p_key,
      submitted_by = auth.uid(),
      submitted_at = now(),
      correction_item_ids = case when v_is_resubmission then correction_item_ids else '{}'::uuid[] end,
      version = version + 1
  where id = p_task_id
  returning * into v_task;

  insert into public.v2_task_reviews(task_id, action, actor_id)
  values(p_task_id, case when v_is_resubmission then 'resubmitted' else 'submitted' end, auth.uid());
  insert into public.notifications(recipient_role, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  values('admin', v_task.store_id, 'v2_task_submitted', case when v_is_resubmission then '整改任务已重新提交' else '任务待审核' end,
    v_task.name, 'v2_task', v_task.id, 'v2-task-submitted:' || v_task.id || ':' || v_task.version)
  on conflict(dedupe_key) do nothing;
  return to_jsonb(v_task);
end $$;

create or replace function public.review_v2_task_items(p_task_id uuid, p_decisions jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_task public.v2_tasks%rowtype;
  v_expected_status text;
  v_eligible_count integer;
  v_processed_count integer := 0;
  v_rejected_ids uuid[] := '{}'::uuid[];
  v_decision jsonb;
  v_item_id uuid;
  v_value text;
  v_round integer;
  v_action text;
begin
  select * into v_task from public.v2_tasks where id = p_task_id for update;
  if v_task.id is null or public.current_user_role() <> 'admin' or not public.has_store_access(v_task.store_id) then
    raise exception 'review denied' using errcode='42501';
  end if;
  if v_task.status not in ('submitted', 'resubmitted') then raise exception 'task is not reviewable' using errcode='55000'; end if;
  if jsonb_typeof(coalesce(p_decisions, 'null'::jsonb)) <> 'array' then raise exception 'review decisions must be an array' using errcode='22023'; end if;

  v_expected_status := case when v_task.status = 'resubmitted' then 'resubmitted' else 'pending' end;
  select count(*) into v_eligible_count from public.v2_task_answers
  where task_id = p_task_id and review_status = v_expected_status;
  if v_eligible_count = 0 then raise exception 'no task items require review' using errcode='55000'; end if;

  for v_decision in select value from jsonb_array_elements(p_decisions) loop
    v_item_id := (v_decision->>'item_id')::uuid;
    v_value := v_decision->>'decision';
    if v_value not in ('approved', 'rejected') then raise exception 'invalid item review decision' using errcode='22023'; end if;
    select submission_round into v_round
    from public.v2_task_answers
    where task_id = p_task_id and item_id = v_item_id and review_status = v_expected_status
    for update;
    if not found then raise exception 'task item is not reviewable' using errcode='55000'; end if;

    update public.v2_task_answers
    set review_status = v_value,
        last_reviewed_by = auth.uid(),
        last_reviewed_at = now()
    where task_id = p_task_id and item_id = v_item_id;
    insert into public.v2_task_item_reviews(task_id, item_id, submission_round, decision, actor_id, note)
    values(p_task_id, v_item_id, v_round, v_value, auth.uid(), coalesce(p_note, ''));
    if v_value = 'rejected' then v_rejected_ids := array_append(v_rejected_ids, v_item_id); end if;
    v_processed_count := v_processed_count + 1;
  end loop;

  if v_processed_count <> v_eligible_count then
    raise exception 'every reviewable task item needs a decision' using errcode='22023';
  end if;
  if coalesce(array_length(v_rejected_ids, 1), 0) > 0 and btrim(coalesce(p_note, '')) = '' then
    raise exception 'rejection reason required' using errcode='23514';
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
  insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  values(coalesce(v_task.submitted_by, v_task.started_by), v_task.store_id, 'v2_task_' || v_action,
    case when v_action = 'approved' then '任务审核通过' else '任务需要整改' end,
    case when v_action = 'approved' then v_task.name else left(p_note, 180) end,
    'v2_task', v_task.id, 'v2-task-review:' || v_task.id || ':' || v_task.version)
  on conflict(dedupe_key) do nothing;
  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values(v_task.store_id, auth.uid(), 'v2_task_' || v_action, 'v2_tasks', v_task.id,
    jsonb_build_object('note', p_note, 'item_decisions', p_decisions));
  return to_jsonb(v_task);
end $$;

-- Preserve compatibility for older clients while routing their whole-task action
-- through the new item-level audit trail.
create or replace function public.review_v2_task(p_task_id uuid, p_action text, p_note text, p_correction_item_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_task public.v2_tasks%rowtype;
  v_expected_status text;
  v_decisions jsonb;
begin
  select * into v_task from public.v2_tasks where id = p_task_id;
  if p_action not in ('approved', 'rejected') then raise exception 'invalid review action' using errcode='22023'; end if;
  v_expected_status := case when v_task.status = 'resubmitted' then 'resubmitted' else 'pending' end;
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', item_id,
    'decision', case when p_action = 'rejected' and item_id = any(coalesce(p_correction_item_ids, '{}'::uuid[])) then 'rejected' else 'approved' end
  ) order by item_id), '[]'::jsonb)
  into v_decisions
  from public.v2_task_answers
  where task_id = p_task_id and review_status = v_expected_status;
  return public.review_v2_task_items(p_task_id, v_decisions, p_note);
end $$;

revoke all on function public.can_edit_v2_task_item(uuid, uuid), public.review_v2_task_items(uuid, jsonb, text) from public;
grant execute on function public.can_edit_v2_task_item(uuid, uuid), public.review_v2_task_items(uuid, jsonb, text) to authenticated;
grant execute on function public.save_v2_task_progress(uuid, integer, jsonb), public.submit_v2_task(uuid, integer, text), public.review_v2_task(uuid, text, text, uuid[]) to authenticated;
