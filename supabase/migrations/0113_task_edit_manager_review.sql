-- Allow administrators to change manager-review routing while editing an
-- already-published one-off task. Recurring schedules already persist the
-- same field through update_v2_task_schedule_v2.

create function public.update_v2_task_content_v2(
  p_task_id uuid,
  p_name text,
  p_snapshot jsonb,
  p_due_at timestamptz,
  p_manager_review_enabled boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.v2_tasks%rowtype;
begin
  perform public.update_v2_task_content(p_task_id, p_name, p_snapshot, p_due_at);

  update public.v2_tasks
  set manager_review_enabled = coalesce(p_manager_review_enabled, false)
  where id = p_task_id
  returning * into v_task;

  if v_task.id is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values(
    v_task.store_id,
    auth.uid(),
    'v2_task_review_route_updated',
    'v2_tasks',
    v_task.id,
    jsonb_build_object('manager_review_enabled', v_task.manager_review_enabled)
  );

  return to_jsonb(v_task);
end;
$$;

revoke all on function public.update_v2_task_content_v2(uuid, text, jsonb, timestamptz, boolean) from public, anon;
grant execute on function public.update_v2_task_content_v2(uuid, text, jsonb, timestamptz, boolean) to authenticated;
