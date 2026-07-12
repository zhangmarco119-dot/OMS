create extension if not exists pg_cron;

create table public.v2_task_schedules (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.v2_task_templates(id),
  template_version_id uuid not null references public.v2_task_template_versions(id),
  store_id uuid not null references public.stores(id),
  schedule_type text not null check (schedule_type in ('interval_days', 'weekly')),
  interval_days smallint,
  weekdays smallint[] not null default '{}',
  due_time time not null,
  next_due_at timestamptz not null,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  paused_at timestamptz,
  paused_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  check ((schedule_type = 'interval_days' and interval_days between 1 and 31 and cardinality(weekdays) = 0)
    or (schedule_type = 'weekly' and interval_days is null and cardinality(weekdays) between 1 and 7))
);
create index v2_task_schedules_due_idx on public.v2_task_schedules (is_active, next_due_at);
create trigger v2_task_schedules_touch_updated_at before update on public.v2_task_schedules for each row execute function public.touch_updated_at();

alter table public.v2_tasks add column schedule_id uuid references public.v2_task_schedules(id);
create index v2_tasks_schedule_due_idx on public.v2_tasks (schedule_id, due_at);

alter table public.v2_task_schedules enable row level security;
create policy v2_task_schedules_select_allowed on public.v2_task_schedules for select to authenticated using (
  public.current_user_role() = 'admin' and public.has_store_access(store_id)
);
revoke insert, update, delete on public.v2_task_schedules from authenticated;
grant select on public.v2_task_schedules to authenticated;

create or replace function public.v2_task_schedule_next_due(p_schedule_id uuid, p_after_at timestamptz)
returns timestamptz language plpgsql security definer set search_path = public stable as $$
declare schedule public.v2_task_schedules%rowtype; local_after timestamp; candidate_date date; offset_days integer;
begin
  select * into schedule from public.v2_task_schedules where id = p_schedule_id;
  if schedule.id is null then raise exception 'task schedule not found' using errcode = 'P0002'; end if;
  if schedule.schedule_type = 'interval_days' then return p_after_at + make_interval(days => schedule.interval_days); end if;
  local_after := timezone('Asia/Shanghai', p_after_at);
  for offset_days in 1..7 loop
    candidate_date := local_after::date + offset_days;
    if extract(isodow from candidate_date)::smallint = any(schedule.weekdays) then
      return (candidate_date + schedule.due_time) at time zone 'Asia/Shanghai';
    end if;
  end loop;
  raise exception 'weekly task schedule has no valid weekdays' using errcode = '22023';
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
  values (schedule.template_id, schedule.template_version_id, schedule.id, schedule.store_id,
    version_row.snapshot -> 'template' ->> 'name', version_row.snapshot -> 'template' ->> 'category', version_row.snapshot, p_due_at,
    coalesce((version_row.snapshot -> 'template' ->> 'allow_overdue')::boolean, false), coalesce((version_row.snapshot -> 'template' ->> 'requires_review')::boolean, true), schedule.created_by)
  returning * into task_row;
  for task_group in select value from jsonb_array_elements(version_row.snapshot -> 'groups') loop
    for task_item in select value from jsonb_array_elements(task_group -> 'items') loop
      insert into public.v2_task_answers (task_id, item_id, group_id, item_snapshot)
      values (task_row.id, (task_item ->> 'id')::uuid, (task_group ->> 'id')::uuid, task_item);
    end loop;
  end loop;
  insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata)
  values (schedule.store_id, schedule.created_by, 'v2_scheduled_task_published', 'v2_tasks', task_row.id, jsonb_build_object('schedule_id', schedule.id));
  return task_row;
end;
$$;

create or replace function public.create_v2_task_schedule(p_template_id uuid, p_store_ids uuid[], p_first_due_at timestamptz, p_schedule_type text, p_interval_days smallint, p_weekdays smallint[])
returns setof public.v2_tasks language plpgsql security definer set search_path = public as $$
declare template public.v2_task_templates%rowtype; version_row public.v2_task_template_versions%rowtype; store_value uuid; schedule_row public.v2_task_schedules%rowtype; task_row public.v2_tasks%rowtype; local_first_due timestamp;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required' using errcode = '42501'; end if;
  select * into template from public.v2_task_templates where id = p_template_id and status = 'published';
  if template.id is null or not public.can_manage_v2_task_template(template.id) then raise exception 'published template required' using errcode = '42501'; end if;
  if p_first_due_at <= now() then raise exception 'first due time must be in the future' using errcode = '22023'; end if;
  if p_schedule_type = 'interval_days' and coalesce(p_interval_days, 0) between 1 and 31 and coalesce(cardinality(p_weekdays), 0) = 0 then null;
  elsif p_schedule_type = 'weekly' and p_interval_days is null and coalesce(cardinality(p_weekdays), 0) between 1 and 7 and not exists (select 1 from unnest(p_weekdays) weekday where weekday not between 1 and 7) then
    local_first_due := timezone('Asia/Shanghai', p_first_due_at);
    if extract(isodow from local_first_due)::smallint <> all(p_weekdays) then raise exception 'first due weekday must be selected' using errcode = '22023'; end if;
  else raise exception 'invalid recurring task schedule' using errcode = '22023'; end if;
  select * into version_row from public.v2_task_template_versions where template_id = template.id and version_number = template.current_version;
  foreach store_value in array p_store_ids loop
    if not public.has_store_access(store_value) or not exists (select 1 from public.v2_task_template_stores where template_id = template.id and store_id = store_value) then raise exception 'template store access denied' using errcode = '42501'; end if;
    insert into public.v2_task_schedules (template_id, template_version_id, store_id, schedule_type, interval_days, weekdays, due_time, next_due_at, created_by)
    values (template.id, version_row.id, store_value, p_schedule_type, case when p_schedule_type = 'interval_days' then p_interval_days else null end, case when p_schedule_type = 'weekly' then p_weekdays else '{}' end, timezone('Asia/Shanghai', p_first_due_at)::time, p_first_due_at, auth.uid()) returning * into schedule_row;
    select * into task_row from public.create_v2_task_from_schedule(schedule_row.id, p_first_due_at);
    insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata)
    values (store_value, auth.uid(), 'v2_task_schedule_created', 'v2_task_schedules', schedule_row.id, jsonb_build_object('schedule_type', p_schedule_type, 'first_due_at', p_first_due_at));
    return next task_row;
  end loop;
end;
$$;

create or replace function public.dispatch_v2_task_schedules()
returns integer language plpgsql security definer set search_path = public as $$
declare schedule_row public.v2_task_schedules%rowtype; next_due timestamptz; created_count integer := 0;
begin
  for schedule_row in select * from public.v2_task_schedules where is_active and next_due_at <= now() for update skip locked loop
    next_due := public.v2_task_schedule_next_due(schedule_row.id, schedule_row.next_due_at);
    while next_due <= now() loop next_due := public.v2_task_schedule_next_due(schedule_row.id, next_due); end loop;
    perform public.create_v2_task_from_schedule(schedule_row.id, next_due);
    update public.v2_task_schedules set next_due_at = next_due where id = schedule_row.id;
    created_count := created_count + 1;
  end loop;
  return created_count;
end;
$$;

create or replace function public.pause_v2_task_schedule(p_schedule_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare schedule_row public.v2_task_schedules%rowtype;
begin
  select * into schedule_row from public.v2_task_schedules where id = p_schedule_id for update;
  if schedule_row.id is null or public.current_user_role() <> 'admin' or not public.has_store_access(schedule_row.store_id) then raise exception 'task schedule access denied' using errcode = '42501'; end if;
  update public.v2_task_schedules set is_active = false, paused_at = now(), paused_by = auth.uid() where id = schedule_row.id returning * into schedule_row;
  insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id) values (schedule_row.store_id, auth.uid(), 'v2_task_schedule_paused', 'v2_task_schedules', schedule_row.id);
  return to_jsonb(schedule_row);
end;
$$;

revoke all on function public.v2_task_schedule_next_due(uuid, timestamptz) from public;
revoke all on function public.create_v2_task_from_schedule(uuid, timestamptz) from public;
revoke all on function public.dispatch_v2_task_schedules() from public;
revoke all on function public.create_v2_task_schedule(uuid, uuid[], timestamptz, text, smallint, smallint[]) from public;
revoke all on function public.pause_v2_task_schedule(uuid) from public;
grant execute on function public.create_v2_task_schedule(uuid, uuid[], timestamptz, text, smallint, smallint[]) to authenticated;
grant execute on function public.pause_v2_task_schedule(uuid) to authenticated;

do $$
declare job_id bigint;
begin
  for job_id in select jobid from cron.job where jobname = 'storehub-v2-task-schedule-dispatch' loop
    perform cron.unschedule(job_id);
  end loop;
  perform cron.schedule('storehub-v2-task-schedule-dispatch', '*/5 * * * *', 'select public.dispatch_v2_task_schedules()');
end;
$$;
