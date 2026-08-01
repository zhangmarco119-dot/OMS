-- Allow administrators to change how a recurring task is completed after it
-- has been published. Schedules created for several independent assignees are
-- grouped so one edit updates the whole recurring definition.

alter table public.v2_task_schedules
  add column recipient_group_id uuid not null default gen_random_uuid(),
  add column completion_mode text not null default 'shared';

alter table public.v2_task_schedules
  add constraint v2_task_schedules_completion_mode_check
  check (completion_mode in ('shared', 'individual', 'single', 'selected'));

update public.v2_task_schedules
set completion_mode = case when assigned_profile_id is null then 'shared' else 'single' end;

create index v2_task_schedules_recipient_group_idx
  on public.v2_task_schedules(recipient_group_id, store_id)
  where withdrawn_at is null;

create or replace function public.create_v2_task_schedule_v5(
  p_template_id uuid,
  p_store_ids uuid[],
  p_profile_ids uuid[],
  p_fields jsonb,
  p_related_sop_id uuid default null,
  p_related_notice_id uuid default null,
  p_requires_inventory boolean default false,
  p_inventory_category_codes text[] default '{}',
  p_completion_mode text default 'shared'
)
returns setof public.v2_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.v2_tasks%rowtype;
  v_started_at timestamptz := now();
  v_store uuid;
  v_group_id uuid;
begin
  if p_completion_mode not in ('shared', 'individual', 'single', 'selected') then
    raise exception '请选择有效的任务完成方式' using errcode = '22023';
  end if;
  if p_completion_mode = 'shared' and coalesce(cardinality(p_profile_ids), 0) <> 0 then
    raise exception '共同完成任务不能指定个人' using errcode = '22023';
  end if;
  if p_completion_mode = 'single' and coalesce(cardinality(p_profile_ids), 0) <> 1 then
    raise exception '单独指定任务必须选择一人' using errcode = '22023';
  end if;
  if p_completion_mode = 'selected' and coalesce(cardinality(p_profile_ids), 0) < 2 then
    raise exception '指定多人任务至少选择两人' using errcode = '22023';
  end if;
  if p_completion_mode = 'individual' and coalesce(cardinality(p_profile_ids), 0) = 0 then
    raise exception '每人分别完成任务至少需要一位接收人' using errcode = '22023';
  end if;

  for v_task in
    select * from public.create_v2_task_schedule_v4(
      p_template_id,
      p_store_ids,
      p_profile_ids,
      p_fields,
      p_related_sop_id,
      p_related_notice_id,
      p_requires_inventory,
      p_inventory_category_codes
    )
  loop
    return next v_task;
  end loop;

  for v_store in
    select distinct schedule.store_id
    from public.v2_task_schedules schedule
    where schedule.created_by = auth.uid()
      and schedule.template_id = p_template_id
      and schedule.store_id = any(p_store_ids)
      and schedule.created_at >= v_started_at
  loop
    v_group_id := gen_random_uuid();
    update public.v2_task_schedules
    set recipient_group_id = v_group_id,
        completion_mode = p_completion_mode
    where created_by = auth.uid()
      and template_id = p_template_id
      and store_id = v_store
      and created_at >= v_started_at;
  end loop;
  return;
end;
$$;

create or replace function public.update_v2_task_schedule_recipients(
  p_schedule_id uuid,
  p_completion_mode text,
  p_profile_ids uuid[] default '{}',
  p_target_audiences text[] default array['staff', 'manager']::text[]
)
returns setof public.v2_task_schedules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.v2_task_schedules%rowtype;
  v_created public.v2_task_schedules%rowtype;
  v_profile public.profiles%rowtype;
  v_profile_id uuid;
  v_profile_ids uuid[] := coalesce(p_profile_ids, '{}'::uuid[]);
  v_profile_audience text;
  v_group_schedule_ids uuid[];
  v_current_due timestamptz;
  v_has_current boolean := false;
  v_has_started boolean := false;
  v_first boolean := true;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;
  select * into v_source from public.v2_task_schedules where id = p_schedule_id for update;
  if v_source.id is null or not public.has_store_access(v_source.store_id) then
    raise exception 'schedule access denied' using errcode = '42501';
  end if;
  if p_completion_mode not in ('shared', 'individual', 'single', 'selected') then
    raise exception '请选择有效的任务完成方式' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_target_audiences), 0) = 0
     or not p_target_audiences <@ array['staff', 'manager', 'part_time']::text[] then
    raise exception '请选择有效的任务接收范围' using errcode = '22023';
  end if;
  if p_completion_mode = 'shared' then
    v_profile_ids := '{}'::uuid[];
  elsif p_completion_mode = 'single' and cardinality(v_profile_ids) <> 1 then
    raise exception '单独指定任务必须选择一人' using errcode = '22023';
  elsif p_completion_mode = 'selected' and cardinality(v_profile_ids) < 2 then
    raise exception '指定多人任务至少选择两人' using errcode = '22023';
  elsif p_completion_mode = 'individual' and cardinality(v_profile_ids) = 0 then
    raise exception '每人分别完成任务至少需要一位接收人' using errcode = '22023';
  end if;

  foreach v_profile_id in array v_profile_ids loop
    select * into v_profile from public.profiles where id = v_profile_id;
    if v_profile.id is null or not v_profile.is_active or v_profile.deleted_at is not null
       or v_profile.role not in ('staff', 'manager') or v_profile.store_id <> v_source.store_id then
      raise exception 'task recipient access denied' using errcode = '42501';
    end if;
  end loop;

  select coalesce(array_agg(schedule.id), array[v_source.id]) into v_group_schedule_ids
  from public.v2_task_schedules schedule
  where schedule.recipient_group_id = v_source.recipient_group_id
    and schedule.store_id = v_source.store_id
    and schedule.withdrawn_at is null;

  perform 1 from public.v2_task_schedules
  where id = any(v_group_schedule_ids)
  for update;

  select exists(
    select 1 from public.v2_tasks task
    where task.schedule_id = any(v_group_schedule_ids)
      and task.status in ('pending', 'in_progress', 'rejected', 'overdue')
  ), exists(
    select 1 from public.v2_tasks task
    where task.schedule_id = any(v_group_schedule_ids)
      and task.status in ('in_progress', 'rejected', 'submitted', 'resubmitted')
  ), min(task.due_at)
  into v_has_current, v_has_started, v_current_due
  from public.v2_tasks task
  where task.schedule_id = any(v_group_schedule_ids)
    and task.status in ('pending', 'in_progress', 'rejected', 'overdue', 'submitted', 'resubmitted');

  -- A task that someone has already started or submitted keeps its original
  -- assignee. The edited completion mode is applied to all future releases.
  if v_has_current and not v_has_started then
    update public.v2_tasks
    set status = 'cancelled', version = version + 1
    where schedule_id = any(v_group_schedule_ids)
      and status in ('pending', 'overdue')
      and started_by is null
      and submitted_by is null;
  end if;

  update public.v2_task_schedules
  set is_active = false,
      withdrawn_at = now(),
      withdrawn_by = auth.uid()
  where id = any(v_group_schedule_ids)
    and id <> v_source.id;

  if p_completion_mode = 'shared' then
    update public.v2_task_schedules
    set assigned_profile_id = null,
        target_audiences = p_target_audiences,
        completion_mode = 'shared',
        withdrawn_at = null,
        withdrawn_by = null
    where id = v_source.id
    returning * into v_source;
  else
    foreach v_profile_id in array v_profile_ids loop
      select * into v_profile from public.profiles where id = v_profile_id;
      v_profile_audience := public.v2_task_audience_for_profile(v_profile.id);
      if v_first then
        update public.v2_task_schedules
        set assigned_profile_id = v_profile.id,
            target_audiences = array[v_profile_audience],
            completion_mode = p_completion_mode,
            withdrawn_at = null,
            withdrawn_by = null
        where id = v_source.id
        returning * into v_source;
        v_first := false;
      else
        insert into public.v2_task_schedules(
          template_id, template_version_id, store_id, assigned_profile_id, target_audiences,
          schedule_type, interval_days, weekdays, month_day, publish_time, due_time,
          acceptance_type, acceptance_interval_days, acceptance_weekday, acceptance_month_day,
          next_due_at, last_published_at, manager_review_enabled, created_by,
          content_name, content_snapshot, related_sop_id, related_notice_id, related_content_title,
          requires_inventory, inventory_category_codes, is_active, paused_at, paused_by,
          recipient_group_id, completion_mode
        ) values (
          v_source.template_id, v_source.template_version_id, v_source.store_id, v_profile.id, array[v_profile_audience],
          v_source.schedule_type, v_source.interval_days, v_source.weekdays, v_source.month_day, v_source.publish_time, v_source.due_time,
          v_source.acceptance_type, v_source.acceptance_interval_days, v_source.acceptance_weekday, v_source.acceptance_month_day,
          v_source.next_due_at, v_source.last_published_at, v_source.manager_review_enabled, v_source.created_by,
          v_source.content_name, v_source.content_snapshot, v_source.related_sop_id, v_source.related_notice_id, v_source.related_content_title,
          v_source.requires_inventory, v_source.inventory_category_codes, v_source.is_active, v_source.paused_at, v_source.paused_by,
          v_source.recipient_group_id, p_completion_mode
        ) returning * into v_created;
      end if;
    end loop;
  end if;

  if v_has_current and not v_has_started and v_current_due > now() then
    for v_created in
      select * from public.v2_task_schedules schedule
      where schedule.recipient_group_id = v_source.recipient_group_id
        and schedule.store_id = v_source.store_id
        and schedule.withdrawn_at is null
        and schedule.is_active
    loop
      perform public.create_v2_task_from_schedule(v_created.id, v_current_due);
    end loop;
  end if;

  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values(v_source.store_id, auth.uid(), 'v2_task_schedule_recipients_updated', 'v2_task_schedules', v_source.id,
    jsonb_build_object('completion_mode', p_completion_mode, 'profile_ids', v_profile_ids, 'target_audiences', p_target_audiences, 'current_started_unchanged', v_has_started));

  return query
  select schedule.* from public.v2_task_schedules schedule
  where schedule.recipient_group_id = v_source.recipient_group_id
    and schedule.store_id = v_source.store_id
    and schedule.withdrawn_at is null
  order by schedule.assigned_profile_id nulls first;
end;
$$;

create or replace function public.update_v2_task_schedule_all_v4(
  p_schedule_id uuid,
  p_fields jsonb,
  p_name text,
  p_snapshot jsonb,
  p_related_sop_id uuid default null,
  p_related_notice_id uuid default null,
  p_requires_inventory boolean default false,
  p_inventory_category_codes text[] default '{}',
  p_completion_mode text default 'shared',
  p_profile_ids uuid[] default '{}',
  p_target_audiences text[] default array['staff', 'manager']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.v2_task_schedules%rowtype;
  v_schedule_id uuid;
  v_result jsonb;
begin
  select * into v_source from public.v2_task_schedules where id = p_schedule_id;
  if v_source.id is null or not public.has_store_access(v_source.store_id) then
    raise exception 'schedule access denied' using errcode = '42501';
  end if;
  for v_schedule_id in
    select schedule.id from public.v2_task_schedules schedule
    where schedule.recipient_group_id = v_source.recipient_group_id
      and schedule.store_id = v_source.store_id
      and schedule.withdrawn_at is null
  loop
    v_result := public.update_v2_task_schedule_all_v3(
      v_schedule_id, p_fields, p_name, p_snapshot, p_related_sop_id,
      p_related_notice_id, p_requires_inventory, p_inventory_category_codes
    );
  end loop;
  perform * from public.update_v2_task_schedule_recipients(
    p_schedule_id, p_completion_mode, p_profile_ids, p_target_audiences
  );
  return (
    select to_jsonb(schedule) from public.v2_task_schedules schedule where schedule.id = p_schedule_id
  );
end;
$$;

revoke all on function public.create_v2_task_schedule_v5(uuid,uuid[],uuid[],jsonb,uuid,uuid,boolean,text[],text),
  public.update_v2_task_schedule_recipients(uuid,text,uuid[],text[]),
  public.update_v2_task_schedule_all_v4(uuid,jsonb,text,jsonb,uuid,uuid,boolean,text[],text,uuid[],text[])
from public, anon;

grant execute on function public.create_v2_task_schedule_v5(uuid,uuid[],uuid[],jsonb,uuid,uuid,boolean,text[],text),
  public.update_v2_task_schedule_recipients(uuid,text,uuid[],text[]),
  public.update_v2_task_schedule_all_v4(uuid,jsonb,text,jsonb,uuid,uuid,boolean,text[],text,uuid[],text[])
to authenticated;
