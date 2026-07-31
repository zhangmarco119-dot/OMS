-- Let administrators add, replace, or remove linked SOP/notice content while
-- editing an already-published one-off task or recurring task schedule.

create function public.update_v2_task_content_v3(
  p_task_id uuid,
  p_name text,
  p_snapshot jsonb,
  p_due_at timestamptz,
  p_manager_review_enabled boolean default false,
  p_related_sop_id uuid default null,
  p_related_notice_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.v2_tasks%rowtype;
  v_title text;
begin
  perform public.update_v2_task_content_v2(
    p_task_id,
    p_name,
    p_snapshot,
    p_due_at,
    p_manager_review_enabled
  );

  select * into v_task
  from public.v2_tasks
  where id = p_task_id
  for update;

  if v_task.id is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  v_title := public.validate_v2_task_related_content(
    p_related_sop_id,
    p_related_notice_id,
    array[v_task.store_id],
    coalesce(v_task.target_audiences, array['staff', 'manager']::text[])
  );

  update public.v2_tasks
  set related_sop_id = p_related_sop_id,
      related_notice_id = p_related_notice_id,
      related_content_title = v_title
  where id = v_task.id
  returning * into v_task;

  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values(
    v_task.store_id,
    auth.uid(),
    'v2_task_related_content_updated',
    'v2_tasks',
    v_task.id,
    jsonb_build_object(
      'related_sop_id', v_task.related_sop_id,
      'related_notice_id', v_task.related_notice_id,
      'related_content_title', v_task.related_content_title
    )
  );

  return to_jsonb(v_task);
end;
$$;

create function public.update_v2_task_schedule_all_v2(
  p_schedule_id uuid,
  p_fields jsonb,
  p_name text,
  p_snapshot jsonb,
  p_related_sop_id uuid default null,
  p_related_notice_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_schedule public.v2_task_schedules%rowtype;
  v_title text;
  v_updated_tasks integer := 0;
begin
  v_result := public.update_v2_task_schedule_all(
    p_schedule_id,
    p_fields,
    p_name,
    p_snapshot
  );

  select * into v_schedule
  from public.v2_task_schedules
  where id = p_schedule_id
  for update;

  if v_schedule.id is null then
    raise exception 'task schedule not found' using errcode = 'P0002';
  end if;

  v_title := public.validate_v2_task_related_content(
    p_related_sop_id,
    p_related_notice_id,
    array[v_schedule.store_id],
    coalesce(v_schedule.target_audiences, array['staff', 'manager']::text[])
  );

  update public.v2_task_schedules
  set related_sop_id = p_related_sop_id,
      related_notice_id = p_related_notice_id,
      related_content_title = v_title
  where id = v_schedule.id
  returning * into v_schedule;

  update public.v2_tasks
  set related_sop_id = p_related_sop_id,
      related_notice_id = p_related_notice_id,
      related_content_title = v_title,
      version = version + 1
  where schedule_id = v_schedule.id
    and status in ('pending', 'in_progress', 'rejected', 'overdue');
  get diagnostics v_updated_tasks = row_count;

  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values(
    v_schedule.store_id,
    auth.uid(),
    'v2_task_schedule_related_content_updated',
    'v2_task_schedules',
    v_schedule.id,
    jsonb_build_object(
      'related_sop_id', v_schedule.related_sop_id,
      'related_notice_id', v_schedule.related_notice_id,
      'related_content_title', v_schedule.related_content_title,
      'updated_active_tasks', v_updated_tasks
    )
  );

  return v_result || jsonb_build_object(
    'related_content_title', v_title,
    'updated_related_tasks', v_updated_tasks
  );
end;
$$;

revoke all on function
  public.update_v2_task_content_v3(uuid, text, jsonb, timestamptz, boolean, uuid, uuid),
  public.update_v2_task_schedule_all_v2(uuid, jsonb, text, jsonb, uuid, uuid)
from public, anon;

grant execute on function
  public.update_v2_task_content_v3(uuid, text, jsonb, timestamptz, boolean, uuid, uuid),
  public.update_v2_task_schedule_all_v2(uuid, jsonb, text, jsonb, uuid, uuid)
to authenticated;
