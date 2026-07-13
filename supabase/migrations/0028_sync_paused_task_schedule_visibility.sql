-- Pausing a recurring plan retires only unfinished generated instances; history remains intact.
create or replace function public.pause_v2_task_schedule(p_schedule_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare schedule_row public.v2_task_schedules%rowtype; cancelled_count integer;
begin
  select * into schedule_row from public.v2_task_schedules where id = p_schedule_id for update;
  if schedule_row.id is null or public.current_user_role() <> 'admin' or not public.has_store_access(schedule_row.store_id) then raise exception 'task schedule access denied' using errcode = '42501'; end if;
  update public.v2_task_schedules set is_active = false, paused_at = now(), paused_by = auth.uid() where id = schedule_row.id returning * into schedule_row;
  update public.v2_tasks set status = 'cancelled', version = version + 1
  where schedule_id = schedule_row.id and status in ('pending','in_progress','rejected','overdue');
  get diagnostics cancelled_count = row_count;
  insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata)
  values (schedule_row.store_id, auth.uid(), 'v2_task_schedule_paused', 'v2_task_schedules', schedule_row.id, jsonb_build_object('cancelled_unfinished_tasks', cancelled_count));
  return to_jsonb(schedule_row);
end;
$$;

create or replace function public.create_v2_task_from_schedule(p_schedule_id uuid, p_due_at timestamptz)
returns public.v2_tasks language plpgsql security definer set search_path = public as $$
declare schedule public.v2_task_schedules%rowtype; version_row public.v2_task_template_versions%rowtype; task_row public.v2_tasks%rowtype; task_group jsonb; task_item jsonb;
begin
  select * into schedule from public.v2_task_schedules where id = p_schedule_id for update;
  if schedule.id is null then raise exception 'task schedule not found' using errcode = 'P0002'; end if;
  select * into version_row from public.v2_task_template_versions where id = schedule.template_version_id;
  if version_row.id is null then raise exception 'task template version not found' using errcode = 'P0002'; end if;
  insert into public.v2_tasks (template_id, template_version_id, schedule_id, store_id, name, category, snapshot, due_at, allow_overdue, requires_review, created_by)
  values (schedule.template_id, schedule.template_version_id, schedule.id, schedule.store_id, version_row.snapshot -> 'template' ->> 'name', version_row.snapshot -> 'template' ->> 'category', version_row.snapshot, p_due_at, coalesce((version_row.snapshot -> 'template' ->> 'allow_overdue')::boolean, false), coalesce((version_row.snapshot -> 'template' ->> 'requires_review')::boolean, true), schedule.created_by)
  returning * into task_row;
  for task_group in select value from jsonb_array_elements(version_row.snapshot -> 'groups') loop
    for task_item in select value from jsonb_array_elements(task_group -> 'items') loop
      insert into public.v2_task_answers(task_id,item_id,group_id,item_snapshot) values(task_row.id,(task_item->>'id')::uuid,(task_group->>'id')::uuid,task_item);
    end loop;
  end loop;
  insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
  select p.id,schedule.store_id,'v2_task_published','新周期任务：'||task_row.name,'截止时间：'||to_char(task_row.due_at,'YYYY-MM-DD HH24:MI'),'v2_task',task_row.id,'v2-scheduled-task:'||task_row.id||':'||p.id
  from public.profiles p where p.store_id=schedule.store_id and p.role in ('staff','manager') and p.is_active and p.deleted_at is null on conflict(dedupe_key) do nothing;
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(schedule.store_id,schedule.created_by,'v2_scheduled_task_published','v2_tasks',task_row.id,jsonb_build_object('schedule_id',schedule.id));
  return task_row;
end;
$$;

create or replace function public.resume_v2_task_schedule(p_schedule_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_schedule public.v2_task_schedules%rowtype; v_due_at timestamptz; v_task public.v2_tasks%rowtype;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required' using errcode = '42501'; end if;
  select * into v_schedule from public.v2_task_schedules where id = p_schedule_id for update;
  if v_schedule.id is null or not public.has_store_access(v_schedule.store_id) then raise exception 'schedule access denied' using errcode = '42501'; end if;
  if v_schedule.is_active then return to_jsonb(v_schedule); end if;
  v_due_at := case when v_schedule.next_due_at <= now() then public.v2_task_schedule_next_due(v_schedule.id, now()) else v_schedule.next_due_at end;
  update public.v2_task_schedules set is_active=true,paused_at=null,paused_by=null,next_due_at=v_due_at where id=v_schedule.id returning * into v_schedule;
  select * into v_task from public.create_v2_task_from_schedule(v_schedule.id,v_due_at);
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(v_schedule.store_id,auth.uid(),'v2_task_schedule_resumed','v2_task_schedules',v_schedule.id,jsonb_build_object('next_due_at',v_due_at,'replacement_task_id',v_task.id));
  return to_jsonb(v_schedule);
end;
$$;

revoke all on function public.pause_v2_task_schedule(uuid), public.resume_v2_task_schedule(uuid) from public;
grant execute on function public.pause_v2_task_schedule(uuid), public.resume_v2_task_schedule(uuid) to authenticated;
