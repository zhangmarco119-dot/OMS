-- StoreHub V2: task completion scope editing.
-- Shared tasks keep one store-level row. Individual tasks reuse the existing
-- assigned_profile_id model so every recipient owns an independent task row.

create or replace function public.update_v2_task_recipients(
  p_task_id uuid,
  p_mode text,
  p_profile_ids uuid[] default '{}',
  p_target_audiences text[] default array['staff', 'manager']::text[]
)
returns setof public.v2_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.v2_tasks%rowtype;
  v_profile public.profiles%rowtype;
  v_new_task public.v2_tasks%rowtype;
  v_first boolean := true;
  v_audience text;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;
  if p_mode not in ('shared', 'single', 'individual') then
    raise exception 'invalid task completion scope' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_target_audiences), 0) = 0
     or not p_target_audiences <@ array['staff', 'manager', 'part_time']::text[] then
    raise exception '请选择有效的任务接收范围' using errcode = '22023';
  end if;

  select * into v_task from public.v2_tasks where id = p_task_id for update;
  if v_task.id is null or not public.has_store_access(v_task.store_id) then
    raise exception 'task access denied' using errcode = '42501';
  end if;
  if v_task.schedule_id is not null then
    raise exception '周期任务请在周期计划中修改接收对象' using errcode = '55000';
  end if;
  if v_task.status <> 'pending' or v_task.started_by is not null or v_task.submitted_by is not null then
    raise exception '任务已开始或已提交，不能再修改完成对象' using errcode = '55000';
  end if;

  delete from public.notifications
  where entity_type = 'v2_task' and entity_id = v_task.id;

  if p_mode = 'shared' then
    update public.v2_tasks
    set assigned_profile_id = null,
        target_audiences = p_target_audiences,
        publish_notified_at = null,
        version = version + 1
    where id = v_task.id
    returning * into v_task;
    perform public.notify_v2_task_publication(v_task.id);
    return next v_task;
    return;
  end if;

  if p_mode = 'single' and coalesce(cardinality(p_profile_ids), 0) <> 1 then
    raise exception '请选择一位任务接收人' using errcode = '22023';
  end if;
  if p_mode = 'individual' and coalesce(cardinality(p_profile_ids), 0) = 0 then
    raise exception '当前范围内没有可接收任务的人员' using errcode = '22023';
  end if;

  for v_profile in
    select distinct profile.*
    from public.profiles profile
    where profile.id = any(p_profile_ids)
    order by profile.display_name, profile.id
  loop
    if not v_profile.is_active or v_profile.deleted_at is not null
       or v_profile.role not in ('staff', 'manager')
       or v_profile.store_id <> v_task.store_id then
      raise exception 'task recipient access denied' using errcode = '42501';
    end if;
    v_audience := public.v2_task_audience_for_profile(v_profile.id);
    if not (v_audience = any(p_target_audiences)) then
      raise exception 'task recipient audience mismatch' using errcode = '42501';
    end if;

    if v_first then
      update public.v2_tasks
      set assigned_profile_id = v_profile.id,
          target_audiences = array[v_audience],
          publish_notified_at = null,
          version = version + 1
      where id = v_task.id
      returning * into v_new_task;
      v_first := false;
    else
      insert into public.v2_tasks(
        template_id, template_version_id, store_id, assigned_profile_id,
        target_audiences, name, category, snapshot, due_at, publish_at,
        allow_overdue, requires_review, manager_review_enabled, created_by,
        related_sop_id, related_notice_id, related_content_title
      ) values (
        v_task.template_id, v_task.template_version_id, v_task.store_id, v_profile.id,
        array[v_audience], v_task.name, v_task.category, v_task.snapshot,
        v_task.due_at, v_task.publish_at, v_task.allow_overdue,
        v_task.requires_review, v_task.manager_review_enabled, v_task.created_by,
        v_task.related_sop_id, v_task.related_notice_id, v_task.related_content_title
      ) returning * into v_new_task;

      insert into public.v2_task_answers(task_id, item_id, group_id, item_snapshot)
      select v_new_task.id, answer.item_id, answer.group_id, answer.item_snapshot
      from public.v2_task_answers answer
      where answer.task_id = v_task.id;
    end if;

    perform public.notify_v2_task_publication(v_new_task.id);
    insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
    values(v_new_task.store_id, auth.uid(), 'v2_task_recipient_updated', 'v2_tasks', v_new_task.id,
      jsonb_build_object('mode', p_mode, 'assigned_profile_id', v_profile.id));
    return next v_new_task;
  end loop;

  if v_first then
    raise exception 'task recipient required' using errcode = '22023';
  end if;
  return;
end;
$$;

revoke all on function public.update_v2_task_recipients(uuid,text,uuid[],text[]) from public, anon;
grant execute on function public.update_v2_task_recipients(uuid,text,uuid[],text[]) to authenticated;
