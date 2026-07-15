-- Allow an administrator to publish a one-off or recurring task to one or more
-- explicitly selected employees while preserving existing store-wide tasks.

alter table public.v2_tasks
  add column assigned_profile_id uuid references public.profiles(id) on delete restrict;
alter table public.v2_task_schedules
  add column assigned_profile_id uuid references public.profiles(id) on delete restrict;

create index v2_tasks_assigned_profile_status_idx
  on public.v2_tasks(assigned_profile_id, status, due_at)
  where assigned_profile_id is not null;
create index v2_task_schedules_assigned_profile_idx
  on public.v2_task_schedules(assigned_profile_id, is_active, next_due_at)
  where assigned_profile_id is not null;

create or replace function public.can_read_v2_task(p_task_id uuid)
returns boolean language sql security definer set search_path=public stable as $$
  select exists(
    select 1 from public.v2_tasks task
    where task.id=p_task_id
      and public.has_store_access(task.store_id)
      and (
        public.current_user_role()='admin'
        or (
          public.current_user_role() in ('staff','manager')
          and task.store_id=public.current_user_store_id()
          and (task.assigned_profile_id is null or task.assigned_profile_id=auth.uid())
        )
      )
  )
$$;

create or replace function public.can_edit_v2_task(p_task_id uuid)
returns boolean language sql security definer set search_path=public stable as $$
  select exists(
    select 1 from public.v2_tasks task
    where task.id=p_task_id
      and task.store_id=public.current_user_store_id()
      and public.current_user_role() in ('staff','manager')
      and public.has_store_access(task.store_id)
      and (task.assigned_profile_id is null or task.assigned_profile_id=auth.uid())
      and (task.status in ('pending','in_progress','rejected') or (task.status='overdue' and task.allow_overdue))
  )
$$;

drop function public.publish_v2_tasks(uuid,uuid[],timestamptz);
create function public.publish_v2_tasks(
  p_template_id uuid,
  p_store_ids uuid[],
  p_due_at timestamptz,
  p_profile_ids uuid[] default '{}'
)
returns setof public.v2_tasks language plpgsql security definer set search_path=public as $$
declare
  v_template public.v2_task_templates%rowtype;
  v_version public.v2_task_template_versions%rowtype;
  v_store uuid;
  v_profile public.profiles%rowtype;
  v_task public.v2_tasks%rowtype;
  v_group jsonb;
  v_item jsonb;
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator role required' using errcode='42501'; end if;
  select * into v_template from public.v2_task_templates where id=p_template_id and status='published';
  if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then raise exception 'published template required' using errcode='42501'; end if;
  select * into v_version from public.v2_task_template_versions where template_id=v_template.id and version_number=v_template.current_version;
  if p_due_at<=now() then raise exception 'due time must be in the future' using errcode='22023'; end if;
  if coalesce(cardinality(p_store_ids),0)=0 then raise exception 'at least one store required' using errcode='22023'; end if;

  if coalesce(cardinality(p_profile_ids),0)>0 then
    for v_profile in select distinct profile.* from public.profiles profile where profile.id=any(p_profile_ids) loop
      if not v_profile.is_active or v_profile.deleted_at is not null or v_profile.role not in ('staff','manager')
         or v_profile.store_id<>all(p_store_ids) or not public.has_store_access(v_profile.store_id)
         or not exists(select 1 from public.v2_task_template_stores where template_id=v_template.id and store_id=v_profile.store_id) then
        raise exception 'task recipient access denied' using errcode='42501';
      end if;
      insert into public.v2_tasks(template_id,template_version_id,store_id,assigned_profile_id,name,category,snapshot,due_at,allow_overdue,requires_review,created_by)
      values(v_template.id,v_version.id,v_profile.store_id,v_profile.id,v_template.name,v_template.category,v_version.snapshot,p_due_at,v_template.allow_overdue,v_template.requires_review,auth.uid()) returning * into v_task;
      for v_group in select value from jsonb_array_elements(v_version.snapshot->'groups') loop
        for v_item in select value from jsonb_array_elements(v_group->'items') loop
          insert into public.v2_task_answers(task_id,item_id,group_id,item_snapshot) values(v_task.id,(v_item->>'id')::uuid,(v_group->>'id')::uuid,v_item);
        end loop;
      end loop;
      insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
      values(v_profile.id,v_profile.store_id,'v2_task_published','新任务：'||v_task.name,'截止时间：'||to_char(v_task.due_at,'YYYY-MM-DD HH24:MI'),'v2_task',v_task.id,'v2-task-published:'||v_task.id||':'||v_profile.id)
      on conflict(dedupe_key) do nothing;
      insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata)
      values(v_profile.store_id,auth.uid(),'v2_task_published','v2_tasks',v_task.id,jsonb_build_object('template',v_template.name,'assigned_profile_id',v_profile.id));
      return next v_task;
    end loop;
    if not found then raise exception 'task recipient required' using errcode='22023'; end if;
    return;
  end if;

  foreach v_store in array p_store_ids loop
    if not public.has_store_access(v_store) or not exists(select 1 from public.v2_task_template_stores where template_id=v_template.id and store_id=v_store) then raise exception 'template store access denied' using errcode='42501'; end if;
    insert into public.v2_tasks(template_id,template_version_id,store_id,name,category,snapshot,due_at,allow_overdue,requires_review,created_by)
    values(v_template.id,v_version.id,v_store,v_template.name,v_template.category,v_version.snapshot,p_due_at,v_template.allow_overdue,v_template.requires_review,auth.uid()) returning * into v_task;
    for v_group in select value from jsonb_array_elements(v_version.snapshot->'groups') loop
      for v_item in select value from jsonb_array_elements(v_group->'items') loop
        insert into public.v2_task_answers(task_id,item_id,group_id,item_snapshot) values(v_task.id,(v_item->>'id')::uuid,(v_group->>'id')::uuid,v_item);
      end loop;
    end loop;
    insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
    select profile.id,v_store,'v2_task_published','新任务：'||v_task.name,'截止时间：'||to_char(v_task.due_at,'YYYY-MM-DD HH24:MI'),'v2_task',v_task.id,'v2-task-published:'||v_task.id||':'||profile.id
    from public.profiles profile where profile.store_id=v_store and profile.role in ('staff','manager') and profile.is_active and profile.deleted_at is null on conflict(dedupe_key) do nothing;
    insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(v_store,auth.uid(),'v2_task_published','v2_tasks',v_task.id,jsonb_build_object('template',v_template.name));
    return next v_task;
  end loop;
end;
$$;

create or replace function public.create_v2_task_from_schedule(p_schedule_id uuid,p_due_at timestamptz)
returns public.v2_tasks language plpgsql security definer set search_path=public as $$
declare v_schedule public.v2_task_schedules%rowtype; v_version public.v2_task_template_versions%rowtype; v_task public.v2_tasks%rowtype; v_group jsonb; v_item jsonb;
begin
  select * into v_schedule from public.v2_task_schedules where id=p_schedule_id for update;
  if v_schedule.id is null then raise exception 'task schedule not found' using errcode='P0002'; end if;
  select * into v_version from public.v2_task_template_versions where id=v_schedule.template_version_id;
  if v_version.id is null then raise exception 'task template version not found' using errcode='P0002'; end if;
  insert into public.v2_tasks(template_id,template_version_id,schedule_id,store_id,assigned_profile_id,name,category,snapshot,due_at,allow_overdue,requires_review,created_by)
  values(v_schedule.template_id,v_schedule.template_version_id,v_schedule.id,v_schedule.store_id,v_schedule.assigned_profile_id,v_version.snapshot->'template'->>'name',v_version.snapshot->'template'->>'category',v_version.snapshot,p_due_at,coalesce((v_version.snapshot->'template'->>'allow_overdue')::boolean,false),coalesce((v_version.snapshot->'template'->>'requires_review')::boolean,true),v_schedule.created_by)
  returning * into v_task;
  for v_group in select value from jsonb_array_elements(v_version.snapshot->'groups') loop
    for v_item in select value from jsonb_array_elements(v_group->'items') loop
      insert into public.v2_task_answers(task_id,item_id,group_id,item_snapshot) values(v_task.id,(v_item->>'id')::uuid,(v_group->>'id')::uuid,v_item);
    end loop;
  end loop;
  insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
  select profile.id,v_schedule.store_id,'v2_task_published','新周期任务：'||v_task.name,'截止时间：'||to_char(v_task.due_at,'YYYY-MM-DD HH24:MI'),'v2_task',v_task.id,'v2-scheduled-task:'||v_task.id||':'||profile.id
  from public.profiles profile where profile.is_active and profile.deleted_at is null and profile.role in ('staff','manager') and profile.store_id=v_schedule.store_id and (v_schedule.assigned_profile_id is null or profile.id=v_schedule.assigned_profile_id)
  on conflict(dedupe_key) do nothing;
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(v_schedule.store_id,v_schedule.created_by,'v2_scheduled_task_published','v2_tasks',v_task.id,jsonb_build_object('schedule_id',v_schedule.id,'assigned_profile_id',v_schedule.assigned_profile_id));
  return v_task;
end;
$$;

drop function public.create_v2_task_schedule(uuid,uuid[],timestamptz,text,smallint,smallint[],smallint);
create function public.create_v2_task_schedule(
  p_template_id uuid,
  p_store_ids uuid[],
  p_first_due_at timestamptz,
  p_schedule_type text,
  p_interval_days smallint,
  p_weekdays smallint[],
  p_month_day smallint,
  p_profile_ids uuid[] default '{}'
)
returns setof public.v2_tasks language plpgsql security definer set search_path=public as $$
declare v_template public.v2_task_templates%rowtype; v_version public.v2_task_template_versions%rowtype; v_profile public.profiles%rowtype; v_store uuid; v_schedule public.v2_task_schedules%rowtype; v_task public.v2_tasks%rowtype; v_local timestamp; v_last_day integer;
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator role required' using errcode='42501'; end if;
  select * into v_template from public.v2_task_templates where id=p_template_id and status='published';
  if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then raise exception 'published template required' using errcode='42501'; end if;
  if p_first_due_at<=now() then raise exception 'first due time must be in the future' using errcode='22023'; end if;
  v_local:=timezone('Asia/Shanghai',p_first_due_at);
  if p_schedule_type='interval_days' and coalesce(p_interval_days,0) between 1 and 31 and coalesce(cardinality(p_weekdays),0)=0 and p_month_day is null then null;
  elsif p_schedule_type='weekly' and p_interval_days is null and coalesce(cardinality(p_weekdays),0) between 1 and 7 and p_month_day is null and not exists(select 1 from unnest(p_weekdays) weekday where weekday not between 1 and 7) then
    if extract(isodow from v_local)::smallint<>all(p_weekdays) then raise exception 'first due weekday must be selected' using errcode='22023'; end if;
  elsif p_schedule_type='monthly' and p_interval_days is null and coalesce(cardinality(p_weekdays),0)=0 and p_month_day between 1 and 31 then
    v_last_day:=extract(day from (date_trunc('month',v_local)::date+interval '1 month - 1 day'))::integer;
    if extract(day from v_local)::smallint<>least(p_month_day,v_last_day) then raise exception 'first due month day must match schedule' using errcode='22023'; end if;
  else raise exception 'invalid recurring task schedule' using errcode='22023'; end if;
  select * into v_version from public.v2_task_template_versions where template_id=v_template.id and version_number=v_template.current_version;

  if coalesce(cardinality(p_profile_ids),0)>0 then
    for v_profile in select distinct profile.* from public.profiles profile where profile.id=any(p_profile_ids) loop
      if not v_profile.is_active or v_profile.deleted_at is not null or v_profile.role not in ('staff','manager') or v_profile.store_id<>all(p_store_ids)
         or not public.has_store_access(v_profile.store_id) or not exists(select 1 from public.v2_task_template_stores where template_id=v_template.id and store_id=v_profile.store_id) then raise exception 'task recipient access denied' using errcode='42501'; end if;
      insert into public.v2_task_schedules(template_id,template_version_id,store_id,assigned_profile_id,schedule_type,interval_days,weekdays,month_day,due_time,next_due_at,created_by)
      values(v_template.id,v_version.id,v_profile.store_id,v_profile.id,p_schedule_type,case when p_schedule_type='interval_days' then p_interval_days end,case when p_schedule_type='weekly' then p_weekdays else '{}' end,case when p_schedule_type='monthly' then p_month_day end,timezone('Asia/Shanghai',p_first_due_at)::time,p_first_due_at,auth.uid()) returning * into v_schedule;
      select * into v_task from public.create_v2_task_from_schedule(v_schedule.id,p_first_due_at);
      return next v_task;
    end loop;
    if not found then raise exception 'task recipient required' using errcode='22023'; end if;
    return;
  end if;

  foreach v_store in array p_store_ids loop
    if not public.has_store_access(v_store) or not exists(select 1 from public.v2_task_template_stores where template_id=v_template.id and store_id=v_store) then raise exception 'template store access denied' using errcode='42501'; end if;
    insert into public.v2_task_schedules(template_id,template_version_id,store_id,schedule_type,interval_days,weekdays,month_day,due_time,next_due_at,created_by)
    values(v_template.id,v_version.id,v_store,p_schedule_type,case when p_schedule_type='interval_days' then p_interval_days end,case when p_schedule_type='weekly' then p_weekdays else '{}' end,case when p_schedule_type='monthly' then p_month_day end,timezone('Asia/Shanghai',p_first_due_at)::time,p_first_due_at,auth.uid()) returning * into v_schedule;
    select * into v_task from public.create_v2_task_from_schedule(v_schedule.id,p_first_due_at);
    return next v_task;
  end loop;
end;
$$;

revoke all on function public.publish_v2_tasks(uuid,uuid[],timestamptz,uuid[]), public.create_v2_task_schedule(uuid,uuid[],timestamptz,text,smallint,smallint[],smallint,uuid[]) from public;
grant execute on function public.publish_v2_tasks(uuid,uuid[],timestamptz,uuid[]), public.create_v2_task_schedule(uuid,uuid[],timestamptz,text,smallint,smallint[],smallint,uuid[]) to authenticated;
