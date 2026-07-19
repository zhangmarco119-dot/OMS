-- Let administrators choose employee, manager and part-time audiences for
-- store-wide one-off and recurring tasks. Existing tasks keep the previous
-- employee + manager scope; part-time is opt-in.

alter table public.v2_tasks
  add column target_audiences text[] not null default array['staff', 'manager']::text[],
  add constraint v2_tasks_target_audiences_check check (
    cardinality(target_audiences) > 0
    and target_audiences <@ array['staff', 'manager', 'part_time']::text[]
  );

alter table public.v2_task_schedules
  add column target_audiences text[] not null default array['staff', 'manager']::text[],
  add constraint v2_task_schedules_target_audiences_check check (
    cardinality(target_audiences) > 0
    and target_audiences <@ array['staff', 'manager', 'part_time']::text[]
  );

create function public.v2_task_audience_for_profile(p_profile_id uuid)
returns text language sql security definer set search_path = public stable as $$
  select case
    when profile.employment_type = 'part_time' then 'part_time'
    when profile.role = 'manager' then 'manager'
    else 'staff'
  end
  from public.profiles profile
  where profile.id = p_profile_id and profile.is_active and profile.deleted_at is null
$$;

create or replace function public.can_read_v2_task(p_task_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists(
    select 1 from public.v2_tasks task
    where task.id = p_task_id
      and public.has_store_access(task.store_id)
      and (
        public.current_user_role() = 'admin'
        or (
          public.current_user_role() in ('staff', 'manager')
          and task.store_id = public.current_user_store_id()
          and (
            task.assigned_profile_id = auth.uid()
            or (
              task.assigned_profile_id is null
              and public.v2_task_audience_for_profile(auth.uid()) = any(task.target_audiences)
            )
          )
        )
      )
  )
$$;

create or replace function public.can_edit_v2_task(p_task_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists(
    select 1 from public.v2_tasks task
    where task.id = p_task_id
      and task.store_id = public.current_user_store_id()
      and public.current_user_role() in ('staff', 'manager')
      and public.has_store_access(task.store_id)
      and (
        task.assigned_profile_id = auth.uid()
        or (
          task.assigned_profile_id is null
          and public.v2_task_audience_for_profile(auth.uid()) = any(task.target_audiences)
        )
      )
      and (task.status in ('pending', 'in_progress', 'rejected') or (task.status = 'overdue' and task.allow_overdue))
  )
$$;

drop function public.publish_v2_tasks(uuid, uuid[], timestamptz, uuid[]);
create function public.publish_v2_tasks(
  p_template_id uuid,
  p_store_ids uuid[],
  p_due_at timestamptz,
  p_profile_ids uuid[] default '{}',
  p_target_audiences text[] default array['staff', 'manager']::text[]
)
returns setof public.v2_tasks language plpgsql security definer set search_path = public as $$
declare
  v_template public.v2_task_templates%rowtype;
  v_version public.v2_task_template_versions%rowtype;
  v_store uuid;
  v_profile public.profiles%rowtype;
  v_task public.v2_tasks%rowtype;
  v_group jsonb;
  v_item jsonb;
  v_profile_audience text;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required' using errcode = '42501'; end if;
  select * into v_template from public.v2_task_templates where id = p_template_id and status = 'published';
  if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then raise exception 'published template required' using errcode = '42501'; end if;
  select * into v_version from public.v2_task_template_versions where template_id = v_template.id and version_number = v_template.current_version;
  if p_due_at <= now() then raise exception 'due time must be in the future' using errcode = '22023'; end if;
  if coalesce(cardinality(p_store_ids), 0) = 0 then raise exception 'at least one store required' using errcode = '22023'; end if;
  if coalesce(cardinality(p_target_audiences), 0) = 0 or not p_target_audiences <@ array['staff', 'manager', 'part_time']::text[] then
    raise exception '请选择有效的任务接收范围' using errcode = '22023';
  end if;

  if coalesce(cardinality(p_profile_ids), 0) > 0 then
    for v_profile in select distinct profile.* from public.profiles profile where profile.id = any(p_profile_ids) loop
      if not v_profile.is_active or v_profile.deleted_at is not null or v_profile.role not in ('staff', 'manager')
         or v_profile.store_id <> all(p_store_ids) or not public.has_store_access(v_profile.store_id)
         or not exists(select 1 from public.v2_task_template_stores where template_id = v_template.id and store_id = v_profile.store_id) then
        raise exception 'task recipient access denied' using errcode = '42501';
      end if;
      v_profile_audience := public.v2_task_audience_for_profile(v_profile.id);
      insert into public.v2_tasks(template_id, template_version_id, store_id, assigned_profile_id, target_audiences, name, category, snapshot, due_at, allow_overdue, requires_review, created_by)
      values(v_template.id, v_version.id, v_profile.store_id, v_profile.id, array[v_profile_audience], v_template.name, v_template.category, v_version.snapshot, p_due_at, v_template.allow_overdue, v_template.requires_review, auth.uid()) returning * into v_task;
      for v_group in select value from jsonb_array_elements(v_version.snapshot->'groups') loop
        for v_item in select value from jsonb_array_elements(v_group->'items') loop
          insert into public.v2_task_answers(task_id, item_id, group_id, item_snapshot) values(v_task.id, (v_item->>'id')::uuid, (v_group->>'id')::uuid, v_item);
        end loop;
      end loop;
      insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
      values(v_profile.id, v_profile.store_id, 'v2_task_published', '新任务：'||v_task.name, '截止时间：'||to_char(v_task.due_at, 'YYYY-MM-DD HH24:MI'), 'v2_task', v_task.id, 'v2-task-published:'||v_task.id||':'||v_profile.id)
      on conflict(dedupe_key) do nothing;
      insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
      values(v_profile.store_id, auth.uid(), 'v2_task_published', 'v2_tasks', v_task.id, jsonb_build_object('template', v_template.name, 'assigned_profile_id', v_profile.id));
      return next v_task;
    end loop;
    if not found then raise exception 'task recipient required' using errcode = '22023'; end if;
    return;
  end if;

  foreach v_store in array p_store_ids loop
    if not public.has_store_access(v_store) or not exists(select 1 from public.v2_task_template_stores where template_id = v_template.id and store_id = v_store) then raise exception 'template store access denied' using errcode = '42501'; end if;
    insert into public.v2_tasks(template_id, template_version_id, store_id, target_audiences, name, category, snapshot, due_at, allow_overdue, requires_review, created_by)
    values(v_template.id, v_version.id, v_store, p_target_audiences, v_template.name, v_template.category, v_version.snapshot, p_due_at, v_template.allow_overdue, v_template.requires_review, auth.uid()) returning * into v_task;
    for v_group in select value from jsonb_array_elements(v_version.snapshot->'groups') loop
      for v_item in select value from jsonb_array_elements(v_group->'items') loop
        insert into public.v2_task_answers(task_id, item_id, group_id, item_snapshot) values(v_task.id, (v_item->>'id')::uuid, (v_group->>'id')::uuid, v_item);
      end loop;
    end loop;
    insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
    select profile.id, v_store, 'v2_task_published', '新任务：'||v_task.name, '截止时间：'||to_char(v_task.due_at, 'YYYY-MM-DD HH24:MI'), 'v2_task', v_task.id, 'v2-task-published:'||v_task.id||':'||profile.id
    from public.profiles profile
    where profile.store_id = v_store and profile.role in ('staff', 'manager') and profile.is_active and profile.deleted_at is null
      and public.v2_task_audience_for_profile(profile.id) = any(p_target_audiences)
    on conflict(dedupe_key) do nothing;
    insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
    values(v_store, auth.uid(), 'v2_task_published', 'v2_tasks', v_task.id, jsonb_build_object('template', v_template.name, 'target_audiences', p_target_audiences));
    return next v_task;
  end loop;
end;
$$;

create or replace function public.update_v2_task_content(p_task_id uuid, p_name text, p_snapshot jsonb, p_due_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_task public.v2_tasks%rowtype;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required' using errcode = '42501'; end if;
  select * into v_task from public.v2_tasks where id = p_task_id for update;
  if v_task.id is null or not public.has_store_access(v_task.store_id) then raise exception 'task access denied' using errcode = '42501'; end if;
  if v_task.schedule_id is not null then raise exception '周期任务请从周期计划编辑'; end if;
  if v_task.status not in ('pending', 'in_progress', 'rejected', 'overdue') then raise exception '当前状态不能编辑任务内容'; end if;
  select * into v_task from public.apply_v2_task_content(p_task_id, p_name, p_snapshot, p_due_at);
  insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  select profile.id, v_task.store_id, 'v2_task_updated', '任务内容已更新：'||v_task.name, '请打开任务查看管理员更新后的内容。', 'v2_task', v_task.id, 'v2-task-updated:'||v_task.id||':'||v_task.version||':'||profile.id
  from public.profiles profile
  where profile.is_active and profile.deleted_at is null and profile.role in ('staff', 'manager') and profile.store_id = v_task.store_id
    and (v_task.assigned_profile_id = profile.id or (v_task.assigned_profile_id is null and public.v2_task_audience_for_profile(profile.id) = any(v_task.target_audiences)))
  on conflict(dedupe_key) do nothing;
  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata) values(v_task.store_id, auth.uid(), 'v2_task_content_updated', 'v2_tasks', v_task.id, jsonb_build_object('name', v_task.name, 'due_at', v_task.due_at));
  return to_jsonb(v_task);
end;
$$;

create or replace function public.update_v2_task_schedule_content(p_schedule_id uuid, p_name text, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.v2_task_schedules%rowtype; v_task public.v2_tasks%rowtype; v_updated integer := 0;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required' using errcode = '42501'; end if;
  select * into s from public.v2_task_schedules where id = p_schedule_id for update;
  if s.id is null or not public.has_store_access(s.store_id) then raise exception 'schedule access denied' using errcode = '42501'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception '请填写任务名称'; end if;
  update public.v2_task_schedules set content_name = btrim(p_name), content_snapshot = p_snapshot || jsonb_build_object('template', coalesce(p_snapshot->'template', '{}'::jsonb) || jsonb_build_object('name', btrim(p_name))) where id = s.id returning * into s;
  for v_task in select * from public.v2_tasks where schedule_id = s.id and status in ('pending', 'in_progress', 'rejected', 'overdue') for update loop
    select * into v_task from public.apply_v2_task_content(v_task.id, p_name, s.content_snapshot, null);
    v_updated := v_updated + 1;
    insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
    select profile.id, v_task.store_id, 'v2_task_updated', '周期任务内容已更新：'||v_task.name, '请打开任务查看管理员更新后的内容。', 'v2_task', v_task.id, 'v2-schedule-task-updated:'||v_task.id||':'||v_task.version||':'||profile.id
    from public.profiles profile
    where profile.is_active and profile.deleted_at is null and profile.role in ('staff', 'manager') and profile.store_id = v_task.store_id
      and (v_task.assigned_profile_id = profile.id or (v_task.assigned_profile_id is null and public.v2_task_audience_for_profile(profile.id) = any(v_task.target_audiences)))
    on conflict(dedupe_key) do nothing;
  end loop;
  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata) values(s.store_id, auth.uid(), 'v2_task_schedule_content_updated', 'v2_task_schedules', s.id, jsonb_build_object('name', p_name, 'updated_tasks', v_updated));
  return jsonb_build_object('scheduleId', s.id, 'updatedTasks', v_updated);
end;
$$;

create or replace function public.create_v2_task_from_schedule(p_schedule_id uuid, p_due_at timestamptz)
returns public.v2_tasks language plpgsql security definer set search_path = public as $$
declare v_schedule public.v2_task_schedules%rowtype; v_version public.v2_task_template_versions%rowtype; v_task public.v2_tasks%rowtype; v_group jsonb; v_item jsonb; v_snapshot jsonb; v_name text;
begin
  select * into v_schedule from public.v2_task_schedules where id = p_schedule_id for update;
  if v_schedule.id is null then raise exception 'task schedule not found' using errcode = 'P0002'; end if;
  select * into v_version from public.v2_task_template_versions where id = v_schedule.template_version_id;
  if v_version.id is null then raise exception 'task template version not found' using errcode = 'P0002'; end if;
  v_snapshot := coalesce(v_schedule.content_snapshot, v_version.snapshot);
  v_name := coalesce(nullif(v_schedule.content_name, ''), v_snapshot->'template'->>'name');
  insert into public.v2_tasks(template_id, template_version_id, schedule_id, store_id, assigned_profile_id, target_audiences, name, category, snapshot, due_at, allow_overdue, requires_review, created_by)
  values(v_schedule.template_id, v_schedule.template_version_id, v_schedule.id, v_schedule.store_id, v_schedule.assigned_profile_id, v_schedule.target_audiences, v_name, v_snapshot->'template'->>'category', v_snapshot, p_due_at, coalesce((v_snapshot->'template'->>'allow_overdue')::boolean, false), coalesce((v_snapshot->'template'->>'requires_review')::boolean, true), v_schedule.created_by)
  returning * into v_task;
  for v_group in select value from jsonb_array_elements(v_snapshot->'groups') loop
    for v_item in select value from jsonb_array_elements(v_group->'items') loop
      insert into public.v2_task_answers(task_id, item_id, group_id, item_snapshot) values(v_task.id, (v_item->>'id')::uuid, (v_group->>'id')::uuid, v_item);
    end loop;
  end loop;
  insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  select profile.id, v_schedule.store_id, 'v2_task_published', '新周期任务：'||v_task.name, '截止时间：'||to_char(v_task.due_at, 'YYYY-MM-DD HH24:MI'), 'v2_task', v_task.id, 'v2-scheduled-task:'||v_task.id||':'||profile.id
  from public.profiles profile
  where profile.is_active and profile.deleted_at is null and profile.role in ('staff', 'manager') and profile.store_id = v_schedule.store_id
    and (v_schedule.assigned_profile_id = profile.id or (v_schedule.assigned_profile_id is null and public.v2_task_audience_for_profile(profile.id) = any(v_schedule.target_audiences)))
  on conflict(dedupe_key) do nothing;
  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata) values(v_schedule.store_id, v_schedule.created_by, 'v2_scheduled_task_published', 'v2_tasks', v_task.id, jsonb_build_object('schedule_id', v_schedule.id, 'assigned_profile_id', v_schedule.assigned_profile_id, 'target_audiences', v_schedule.target_audiences));
  return v_task;
end;
$$;

create or replace function public.create_v2_task_schedule_v2(p_template_id uuid, p_store_ids uuid[], p_profile_ids uuid[], p_fields jsonb)
returns setof public.v2_tasks language plpgsql security definer set search_path = public as $$
declare
  v_template public.v2_task_templates%rowtype; v_version public.v2_task_template_versions%rowtype; v_profile public.profiles%rowtype;
  v_store uuid; v_schedule public.v2_task_schedules%rowtype; v_task public.v2_tasks%rowtype;
  v_release_type text := coalesce(p_fields->>'scheduleType', ''); v_interval smallint := nullif(p_fields->>'intervalDays', '')::smallint;
  v_weekdays smallint[] := coalesce(array(select value::smallint from jsonb_array_elements_text(coalesce(p_fields->'weekdays', '[]'::jsonb)) value), '{}');
  v_month_day smallint := nullif(p_fields->>'monthDay', '')::smallint; v_publish_time time := nullif(p_fields->>'publishTime', '')::time;
  v_acceptance_type text := coalesce(p_fields->>'acceptanceType', ''); v_acceptance_days smallint := nullif(p_fields->>'acceptanceIntervalDays', '')::smallint;
  v_acceptance_weekday smallint := nullif(p_fields->>'acceptanceWeekday', '')::smallint; v_acceptance_month_day smallint := nullif(p_fields->>'acceptanceMonthDay', '')::smallint;
  v_acceptance_time time := nullif(p_fields->>'acceptanceTime', '')::time; v_now timestamptz := now(); v_first_due timestamptz; v_next_release timestamptz;
  v_target_audiences text[] := coalesce(array(select value from jsonb_array_elements_text(coalesce(p_fields->'targetAudiences', '["staff","manager"]'::jsonb)) value), array['staff', 'manager']::text[]);
  v_profile_audience text;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required'; end if;
  select * into v_template from public.v2_task_templates where id = p_template_id and status = 'published';
  if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then raise exception 'published template required'; end if;
  if v_publish_time is null or v_acceptance_time is null then raise exception '请设置发布和验收时间'; end if;
  if coalesce(cardinality(v_target_audiences), 0) = 0 or not v_target_audiences <@ array['staff', 'manager', 'part_time']::text[] then raise exception '请选择有效的任务接收范围'; end if;
  if not ((v_release_type = 'interval_days' and v_interval between 1 and 31 and cardinality(v_weekdays) = 0 and v_month_day is null)
    or (v_release_type = 'weekly' and v_interval is null and cardinality(v_weekdays) between 1 and 7 and v_month_day is null and not exists(select 1 from unnest(v_weekdays) day where day not between 1 and 7))
    or (v_release_type = 'monthly' and v_interval is null and cardinality(v_weekdays) = 0 and v_month_day between 1 and 31)) then raise exception '请完善发布周期'; end if;
  if not ((v_acceptance_type = 'daily' and v_acceptance_days between 0 and 31 and v_acceptance_weekday is null and v_acceptance_month_day is null)
    or (v_acceptance_type = 'weekly' and v_acceptance_days is null and v_acceptance_weekday between 1 and 7 and v_acceptance_month_day is null)
    or (v_acceptance_type = 'monthly' and v_acceptance_days is null and v_acceptance_weekday is null and v_acceptance_month_day between 1 and 31)) then raise exception '请完善验收周期'; end if;
  select * into v_version from public.v2_task_template_versions where template_id = v_template.id and version_number = v_template.current_version;
  for v_profile in select distinct profile.* from public.profiles profile where coalesce(cardinality(p_profile_ids), 0) > 0 and profile.id = any(p_profile_ids) loop
    if not v_profile.is_active or v_profile.deleted_at is not null or v_profile.role not in ('staff', 'manager') or v_profile.store_id <> all(p_store_ids) or not public.has_store_access(v_profile.store_id) or not exists(select 1 from public.v2_task_template_stores where template_id = v_template.id and store_id = v_profile.store_id) then raise exception 'task recipient access denied'; end if;
    v_profile_audience := public.v2_task_audience_for_profile(v_profile.id);
    insert into public.v2_task_schedules(template_id, template_version_id, store_id, assigned_profile_id, target_audiences, schedule_type, interval_days, weekdays, month_day, publish_time, due_time, acceptance_type, acceptance_interval_days, acceptance_weekday, acceptance_month_day, next_due_at, last_published_at, created_by)
    values(v_template.id, v_version.id, v_profile.store_id, v_profile.id, array[v_profile_audience], v_release_type, case when v_release_type='interval_days' then v_interval end, case when v_release_type='weekly' then v_weekdays else '{}' end, case when v_release_type='monthly' then v_month_day end, v_publish_time, v_acceptance_time, v_acceptance_type, case when v_acceptance_type='daily' then v_acceptance_days end, case when v_acceptance_type='weekly' then v_acceptance_weekday end, case when v_acceptance_type='monthly' then v_acceptance_month_day end, v_now, v_now, auth.uid()) returning * into v_schedule;
    v_first_due := public.v2_task_schedule_acceptance_due(v_schedule.id, v_now); v_next_release := public.v2_task_schedule_next_due(v_schedule.id, v_now);
    if v_first_due <= v_now then raise exception '验收时间必须晚于立即发布时间'; end if;
    if v_first_due >= v_next_release then raise exception '验收截止时间必须早于下一次发布时间，请调整发布或验收周期'; end if;
    update public.v2_task_schedules set next_due_at = v_next_release where id = v_schedule.id;
    select * into v_task from public.create_v2_task_from_schedule(v_schedule.id, v_first_due); return next v_task;
  end loop;
  if coalesce(cardinality(p_profile_ids), 0) > 0 then return; end if;
  foreach v_store in array p_store_ids loop
    if not public.has_store_access(v_store) or not exists(select 1 from public.v2_task_template_stores where template_id = v_template.id and store_id = v_store) then raise exception 'template store access denied'; end if;
    insert into public.v2_task_schedules(template_id, template_version_id, store_id, target_audiences, schedule_type, interval_days, weekdays, month_day, publish_time, due_time, acceptance_type, acceptance_interval_days, acceptance_weekday, acceptance_month_day, next_due_at, last_published_at, created_by)
    values(v_template.id, v_version.id, v_store, v_target_audiences, v_release_type, case when v_release_type='interval_days' then v_interval end, case when v_release_type='weekly' then v_weekdays else '{}' end, case when v_release_type='monthly' then v_month_day end, v_publish_time, v_acceptance_time, v_acceptance_type, case when v_acceptance_type='daily' then v_acceptance_days end, case when v_acceptance_type='weekly' then v_acceptance_weekday end, case when v_acceptance_type='monthly' then v_acceptance_month_day end, v_now, v_now, auth.uid()) returning * into v_schedule;
    v_first_due := public.v2_task_schedule_acceptance_due(v_schedule.id, v_now); v_next_release := public.v2_task_schedule_next_due(v_schedule.id, v_now);
    if v_first_due <= v_now then raise exception '验收时间必须晚于立即发布时间'; end if;
    if v_first_due >= v_next_release then raise exception '验收截止时间必须早于下一次发布时间，请调整发布或验收周期'; end if;
    update public.v2_task_schedules set next_due_at = v_next_release where id = v_schedule.id;
    select * into v_task from public.create_v2_task_from_schedule(v_schedule.id, v_first_due); return next v_task;
  end loop;
end;
$$;

revoke all on function public.v2_task_audience_for_profile(uuid) from public, anon, authenticated;
revoke all on function public.publish_v2_tasks(uuid, uuid[], timestamptz, uuid[], text[]) from public, anon;
grant execute on function public.publish_v2_tasks(uuid, uuid[], timestamptz, uuid[], text[]) to authenticated;
