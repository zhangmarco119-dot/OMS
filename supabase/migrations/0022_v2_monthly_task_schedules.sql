alter table public.v2_task_schedules add column month_day smallint;
alter table public.v2_task_schedules drop constraint v2_task_schedules_schedule_type_check;
alter table public.v2_task_schedules drop constraint v2_task_schedules_check;
alter table public.v2_task_schedules add constraint v2_task_schedules_schedule_type_check check (schedule_type in ('interval_days', 'weekly', 'monthly'));
alter table public.v2_task_schedules add constraint v2_task_schedules_rule_check check (
  (schedule_type = 'interval_days' and interval_days between 1 and 31 and cardinality(weekdays) = 0 and month_day is null)
  or (schedule_type = 'weekly' and interval_days is null and cardinality(weekdays) between 1 and 7 and month_day is null)
  or (schedule_type = 'monthly' and interval_days is null and cardinality(weekdays) = 0 and month_day between 1 and 31)
);

create or replace function public.v2_task_schedule_next_due(p_schedule_id uuid, p_after_at timestamptz)
returns timestamptz language plpgsql security definer set search_path = public stable as $$
declare schedule public.v2_task_schedules%rowtype; local_after timestamp; candidate_date date; offset_days integer; last_day integer;
begin
  select * into schedule from public.v2_task_schedules where id = p_schedule_id;
  if schedule.id is null then raise exception 'task schedule not found' using errcode = 'P0002'; end if;
  if schedule.schedule_type = 'interval_days' then return p_after_at + make_interval(days => schedule.interval_days); end if;
  local_after := timezone('Asia/Shanghai', p_after_at);
  if schedule.schedule_type = 'monthly' then
    candidate_date := (date_trunc('month', local_after)::date + interval '1 month')::date;
    last_day := extract(day from (date_trunc('month', candidate_date)::date + interval '1 month - 1 day'))::integer;
    return (make_date(extract(year from candidate_date)::integer, extract(month from candidate_date)::integer, least(schedule.month_day, last_day)) + schedule.due_time) at time zone 'Asia/Shanghai';
  end if;
  for offset_days in 1..7 loop
    candidate_date := local_after::date + offset_days;
    if extract(isodow from candidate_date)::smallint = any(schedule.weekdays) then return (candidate_date + schedule.due_time) at time zone 'Asia/Shanghai'; end if;
  end loop;
  raise exception 'weekly task schedule has no valid weekdays' using errcode = '22023';
end;
$$;

drop function public.create_v2_task_schedule(uuid, uuid[], timestamptz, text, smallint, smallint[]);
create function public.create_v2_task_schedule(p_template_id uuid, p_store_ids uuid[], p_first_due_at timestamptz, p_schedule_type text, p_interval_days smallint, p_weekdays smallint[], p_month_day smallint)
returns setof public.v2_tasks language plpgsql security definer set search_path = public as $$
declare template public.v2_task_templates%rowtype; version_row public.v2_task_template_versions%rowtype; store_value uuid; schedule_row public.v2_task_schedules%rowtype; task_row public.v2_tasks%rowtype; local_first_due timestamp; last_day integer;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required' using errcode = '42501'; end if;
  select * into template from public.v2_task_templates where id = p_template_id and status = 'published';
  if template.id is null or not public.can_manage_v2_task_template(template.id) then raise exception 'published template required' using errcode = '42501'; end if;
  if p_first_due_at <= now() then raise exception 'first due time must be in the future' using errcode = '22023'; end if;
  local_first_due := timezone('Asia/Shanghai', p_first_due_at);
  if p_schedule_type = 'interval_days' and coalesce(p_interval_days, 0) between 1 and 31 and coalesce(cardinality(p_weekdays), 0) = 0 and p_month_day is null then null;
  elsif p_schedule_type = 'weekly' and p_interval_days is null and coalesce(cardinality(p_weekdays), 0) between 1 and 7 and p_month_day is null and not exists (select 1 from unnest(p_weekdays) weekday where weekday not between 1 and 7) then
    if extract(isodow from local_first_due)::smallint <> all(p_weekdays) then raise exception 'first due weekday must be selected' using errcode = '22023'; end if;
  elsif p_schedule_type = 'monthly' and p_interval_days is null and coalesce(cardinality(p_weekdays), 0) = 0 and p_month_day between 1 and 31 then
    last_day := extract(day from (date_trunc('month', local_first_due)::date + interval '1 month - 1 day'))::integer;
    if extract(day from local_first_due)::smallint <> least(p_month_day, last_day) then raise exception 'first due month day must match schedule' using errcode = '22023'; end if;
  else raise exception 'invalid recurring task schedule' using errcode = '22023'; end if;
  select * into version_row from public.v2_task_template_versions where template_id = template.id and version_number = template.current_version;
  foreach store_value in array p_store_ids loop
    if not public.has_store_access(store_value) or not exists (select 1 from public.v2_task_template_stores where template_id = template.id and store_id = store_value) then raise exception 'template store access denied' using errcode = '42501'; end if;
    insert into public.v2_task_schedules (template_id, template_version_id, store_id, schedule_type, interval_days, weekdays, month_day, due_time, next_due_at, created_by)
    values (template.id, version_row.id, store_value, p_schedule_type, case when p_schedule_type = 'interval_days' then p_interval_days else null end, case when p_schedule_type = 'weekly' then p_weekdays else '{}' end, case when p_schedule_type = 'monthly' then p_month_day else null end, timezone('Asia/Shanghai', p_first_due_at)::time, p_first_due_at, auth.uid()) returning * into schedule_row;
    select * into task_row from public.create_v2_task_from_schedule(schedule_row.id, p_first_due_at);
    insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata) values (store_value, auth.uid(), 'v2_task_schedule_created', 'v2_task_schedules', schedule_row.id, jsonb_build_object('schedule_type', p_schedule_type, 'first_due_at', p_first_due_at));
    return next task_row;
  end loop;
end;
$$;
revoke all on function public.create_v2_task_schedule(uuid, uuid[], timestamptz, text, smallint, smallint[], smallint) from public;
grant execute on function public.create_v2_task_schedule(uuid, uuid[], timestamptz, text, smallint, smallint[], smallint) to authenticated;
