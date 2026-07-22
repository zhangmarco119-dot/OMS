-- Recurring schedules must wait for their configured first publish time.
-- Creating a schedule no longer creates an employee task immediately.

create or replace function public.v2_task_schedule_first_release(
  p_schedule_id uuid,
  p_after_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_schedule public.v2_task_schedules%rowtype;
  v_local_after timestamp;
  v_candidate timestamp;
begin
  select * into v_schedule
  from public.v2_task_schedules
  where id = p_schedule_id;

  if v_schedule.id is null then
    raise exception 'task schedule not found';
  end if;

  -- Interval schedules may start later today. The generic next-due helper
  -- intentionally adds the full interval and is therefore only suitable
  -- after the first release has happened.
  if v_schedule.schedule_type = 'interval_days' then
    v_local_after := timezone('Asia/Shanghai', p_after_at);
    v_candidate := v_local_after::date + v_schedule.publish_time;
    if v_candidate <= v_local_after then
      v_candidate := (v_local_after::date + v_schedule.interval_days) + v_schedule.publish_time;
    end if;
    return v_candidate at time zone 'Asia/Shanghai';
  end if;

  -- Weekly and monthly rules already include a future occurrence on the
  -- current day/month when the configured publish time has not passed.
  return public.v2_task_schedule_next_due(p_schedule_id, p_after_at);
end;
$$;

create or replace function public.create_v2_task_schedule_v2(
  p_template_id uuid,
  p_store_ids uuid[],
  p_profile_ids uuid[],
  p_fields jsonb
)
returns setof public.v2_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.v2_task_templates%rowtype;
  v_version public.v2_task_template_versions%rowtype;
  v_profile public.profiles%rowtype;
  v_store uuid;
  v_schedule public.v2_task_schedules%rowtype;
  v_release_type text := coalesce(p_fields->>'scheduleType', '');
  v_interval smallint := nullif(p_fields->>'intervalDays', '')::smallint;
  v_weekdays smallint[] := coalesce(array(
    select value::smallint
    from jsonb_array_elements_text(coalesce(p_fields->'weekdays', '[]'::jsonb)) value
  ), '{}');
  v_month_day smallint := nullif(p_fields->>'monthDay', '')::smallint;
  v_publish_time time := nullif(p_fields->>'publishTime', '')::time;
  v_acceptance_type text := coalesce(p_fields->>'acceptanceType', '');
  v_acceptance_days smallint := nullif(p_fields->>'acceptanceIntervalDays', '')::smallint;
  v_acceptance_weekday smallint := nullif(p_fields->>'acceptanceWeekday', '')::smallint;
  v_acceptance_month_day smallint := nullif(p_fields->>'acceptanceMonthDay', '')::smallint;
  v_acceptance_time time := nullif(p_fields->>'acceptanceTime', '')::time;
  v_now timestamptz := now();
  v_first_release timestamptz;
  v_first_due timestamptz;
  v_next_release timestamptz;
  v_target_audiences text[] := coalesce(array(
    select value
    from jsonb_array_elements_text(coalesce(p_fields->'targetAudiences', '["staff","manager"]'::jsonb)) value
  ), array['staff', 'manager']::text[]);
  v_profile_audience text;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required';
  end if;

  select * into v_template
  from public.v2_task_templates
  where id = p_template_id and status = 'published';
  if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then
    raise exception 'published template required';
  end if;
  if v_publish_time is null or v_acceptance_time is null then
    raise exception '请设置发布和验收时间';
  end if;
  if coalesce(cardinality(v_target_audiences), 0) = 0
     or not v_target_audiences <@ array['staff', 'manager', 'part_time']::text[] then
    raise exception '请选择有效的任务接收范围';
  end if;
  if not (
    (v_release_type = 'interval_days' and v_interval between 1 and 31 and cardinality(v_weekdays) = 0 and v_month_day is null)
    or (v_release_type = 'weekly' and v_interval is null and cardinality(v_weekdays) between 1 and 7 and v_month_day is null
      and not exists(select 1 from unnest(v_weekdays) day where day not between 1 and 7))
    or (v_release_type = 'monthly' and v_interval is null and cardinality(v_weekdays) = 0 and v_month_day between 1 and 31)
  ) then
    raise exception '请完善发布周期';
  end if;
  if not (
    (v_acceptance_type = 'daily' and v_acceptance_days between 0 and 31 and v_acceptance_weekday is null and v_acceptance_month_day is null)
    or (v_acceptance_type = 'weekly' and v_acceptance_days is null and v_acceptance_weekday between 1 and 7 and v_acceptance_month_day is null)
    or (v_acceptance_type = 'monthly' and v_acceptance_days is null and v_acceptance_weekday is null and v_acceptance_month_day between 1 and 31)
  ) then
    raise exception '请完善验收周期';
  end if;

  select * into v_version
  from public.v2_task_template_versions
  where template_id = v_template.id and version_number = v_template.current_version;
  if v_version.id is null then
    raise exception 'task template version not found';
  end if;

  for v_profile in
    select distinct profile.*
    from public.profiles profile
    where coalesce(cardinality(p_profile_ids), 0) > 0 and profile.id = any(p_profile_ids)
  loop
    if not v_profile.is_active
       or v_profile.deleted_at is not null
       or v_profile.role not in ('staff', 'manager')
       or v_profile.store_id <> all(p_store_ids)
       or not public.has_store_access(v_profile.store_id)
       or not exists(
         select 1 from public.v2_task_template_stores
         where template_id = v_template.id and store_id = v_profile.store_id
       ) then
      raise exception 'task recipient access denied';
    end if;

    v_profile_audience := public.v2_task_audience_for_profile(v_profile.id);
    insert into public.v2_task_schedules(
      template_id, template_version_id, store_id, assigned_profile_id, target_audiences,
      schedule_type, interval_days, weekdays, month_day, publish_time, due_time,
      acceptance_type, acceptance_interval_days, acceptance_weekday, acceptance_month_day,
      next_due_at, last_published_at, created_by
    ) values (
      v_template.id, v_version.id, v_profile.store_id, v_profile.id, array[v_profile_audience],
      v_release_type, case when v_release_type = 'interval_days' then v_interval end,
      case when v_release_type = 'weekly' then v_weekdays else '{}' end,
      case when v_release_type = 'monthly' then v_month_day end,
      v_publish_time, v_acceptance_time, v_acceptance_type,
      case when v_acceptance_type = 'daily' then v_acceptance_days end,
      case when v_acceptance_type = 'weekly' then v_acceptance_weekday end,
      case when v_acceptance_type = 'monthly' then v_acceptance_month_day end,
      v_now, null, auth.uid()
    ) returning * into v_schedule;

    v_first_release := public.v2_task_schedule_first_release(v_schedule.id, v_now);
    v_first_due := public.v2_task_schedule_acceptance_due(v_schedule.id, v_first_release);
    v_next_release := public.v2_task_schedule_next_due(v_schedule.id, v_first_release);
    if v_first_due <= v_first_release then
      raise exception '验收时间必须晚于首次发布时间';
    end if;
    if v_first_due >= v_next_release then
      raise exception '验收截止时间必须早于下一次发布时间，请调整发布或验收周期';
    end if;

    update public.v2_task_schedules
    set next_due_at = v_first_release, last_published_at = null
    where id = v_schedule.id;
    insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
    values(v_schedule.store_id, auth.uid(), 'v2_task_schedule_created', 'v2_task_schedules', v_schedule.id,
      jsonb_build_object('first_publish_at', v_first_release, 'assigned_profile_id', v_profile.id, 'target_audiences', array[v_profile_audience]));
  end loop;

  if coalesce(cardinality(p_profile_ids), 0) > 0 then
    return;
  end if;

  foreach v_store in array p_store_ids loop
    if not public.has_store_access(v_store)
       or not exists(
         select 1 from public.v2_task_template_stores
         where template_id = v_template.id and store_id = v_store
       ) then
      raise exception 'template store access denied';
    end if;

    insert into public.v2_task_schedules(
      template_id, template_version_id, store_id, target_audiences,
      schedule_type, interval_days, weekdays, month_day, publish_time, due_time,
      acceptance_type, acceptance_interval_days, acceptance_weekday, acceptance_month_day,
      next_due_at, last_published_at, created_by
    ) values (
      v_template.id, v_version.id, v_store, v_target_audiences,
      v_release_type, case when v_release_type = 'interval_days' then v_interval end,
      case when v_release_type = 'weekly' then v_weekdays else '{}' end,
      case when v_release_type = 'monthly' then v_month_day end,
      v_publish_time, v_acceptance_time, v_acceptance_type,
      case when v_acceptance_type = 'daily' then v_acceptance_days end,
      case when v_acceptance_type = 'weekly' then v_acceptance_weekday end,
      case when v_acceptance_type = 'monthly' then v_acceptance_month_day end,
      v_now, null, auth.uid()
    ) returning * into v_schedule;

    v_first_release := public.v2_task_schedule_first_release(v_schedule.id, v_now);
    v_first_due := public.v2_task_schedule_acceptance_due(v_schedule.id, v_first_release);
    v_next_release := public.v2_task_schedule_next_due(v_schedule.id, v_first_release);
    if v_first_due <= v_first_release then
      raise exception '验收时间必须晚于首次发布时间';
    end if;
    if v_first_due >= v_next_release then
      raise exception '验收截止时间必须早于下一次发布时间，请调整发布或验收周期';
    end if;

    update public.v2_task_schedules
    set next_due_at = v_first_release, last_published_at = null
    where id = v_schedule.id;
    insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
    values(v_store, auth.uid(), 'v2_task_schedule_created', 'v2_task_schedules', v_schedule.id,
      jsonb_build_object('first_publish_at', v_first_release, 'target_audiences', v_target_audiences));
  end loop;

  -- The dispatcher creates the first task when next_due_at is reached.
  return;
end;
$$;

revoke all on function public.v2_task_schedule_first_release(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.create_v2_task_schedule_v2(uuid, uuid[], uuid[], jsonb) from public, anon;
grant execute on function public.create_v2_task_schedule_v2(uuid, uuid[], uuid[], jsonb) to authenticated;
