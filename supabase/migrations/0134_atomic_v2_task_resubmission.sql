-- Save the latest answers and submit the task in one transaction. This avoids
-- the autosave/submit race where answers were persisted but a rejected task
-- could remain in the rejected state.
create or replace function public.submit_v2_task_with_answers(
  p_task_id uuid,
  p_expected_version integer,
  p_key text,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saved jsonb;
begin
  v_saved := public.save_v2_task_progress(p_task_id, p_expected_version, p_answers);
  return public.submit_v2_task(p_task_id, (v_saved ->> 'version')::integer, p_key);
end;
$$;

revoke all on function public.submit_v2_task_with_answers(uuid, integer, text, jsonb) from public;
grant execute on function public.submit_v2_task_with_answers(uuid, integer, text, jsonb) to authenticated;

-- Repair the confirmed production record. Both rejected items received new
-- photos after the rejection, but the old client never completed the status
-- transition or created the resubmission review entry.
do $$
declare
  v_task_id constant uuid := '17e9ee79-bf2f-4f54-be84-17f295b188ff';
  v_task public.v2_tasks%rowtype;
  v_resubmitted_at timestamptz;
begin
  select * into v_task
  from public.v2_tasks
  where id = v_task_id
  for update;

  if v_task.id is not null
    and v_task.status = 'rejected'
    and coalesce(array_length(v_task.correction_item_ids, 1), 0) > 0
    and not exists (
      select 1
      from unnest(v_task.correction_item_ids) correction_item_id
      where not exists (
        select 1
        from public.v2_task_images image
        where image.task_id = v_task.id
          and image.item_id = correction_item_id
          and image.created_at > v_task.reviewed_at
      )
    )
  then
    select max(image.created_at) into v_resubmitted_at
    from public.v2_task_images image
    where image.task_id = v_task.id
      and image.item_id = any(v_task.correction_item_ids)
      and image.created_at > v_task.reviewed_at;

    update public.v2_task_answers
    set review_status = 'resubmitted',
        submission_round = greatest(submission_round + 1, 2),
        last_reviewed_by = null,
        last_reviewed_at = null
    where task_id = v_task.id
      and item_id = any(v_task.correction_item_ids)
      and review_status = 'rejected';

    update public.v2_tasks
    set status = 'resubmitted',
        submitted_at = v_resubmitted_at,
        version = version + 1
    where id = v_task.id
    returning * into v_task;

    insert into public.v2_task_reviews(task_id, action, actor_id, created_at)
    values(v_task.id, 'resubmitted', v_task.submitted_by, v_resubmitted_at)
    on conflict do nothing;

    insert into public.notifications(
      recipient_role, store_id, type, title, body,
      entity_type, entity_id, dedupe_key
    ) values (
      'admin', v_task.store_id, 'v2_task_submitted', '整改任务已重新提交', v_task.name,
      'v2_task', v_task.id, 'v2-task-submitted:' || v_task.id || ':' || v_task.version || ':admin'
    ) on conflict(dedupe_key) do nothing;
  end if;
end;
$$;
