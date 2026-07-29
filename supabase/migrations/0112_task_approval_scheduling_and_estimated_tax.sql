-- Task approval routing, scheduled publication and estimated individual income tax.

alter table public.v2_tasks
  add column manager_review_enabled boolean not null default false,
  add column submitted_by_role text check (submitted_by_role in ('staff', 'manager', 'admin')),
  add column publish_at timestamptz not null default now(),
  add column publish_notified_at timestamptz;

alter table public.v2_task_schedules
  add column manager_review_enabled boolean not null default false;

update public.v2_tasks
set publish_at = created_at,
    publish_notified_at = created_at
where publish_notified_at is null;

create index v2_tasks_pending_publication_idx
  on public.v2_tasks(publish_at)
  where publish_notified_at is null and status <> 'cancelled';

create table public.payroll_individual_tax_overrides (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  payroll_month date not null check (payroll_month = date_trunc('month', payroll_month)::date),
  amount numeric(12,2) not null check (amount >= 0),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(profile_id, payroll_month)
);

create trigger payroll_individual_tax_overrides_touch_updated_at
before update on public.payroll_individual_tax_overrides
for each row execute function public.touch_updated_at();

alter table public.payroll_individual_tax_overrides enable row level security;
create policy payroll_individual_tax_overrides_admin_select
on public.payroll_individual_tax_overrides for select to authenticated
using(public.current_user_role() = 'admin' and public.can_admin_manage_attendance_profile(profile_id));
grant select on public.payroll_individual_tax_overrides to authenticated;

create or replace function public.can_review_v2_task(p_task_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists(
    select 1
    from public.v2_tasks task
    left join public.profiles submitter on submitter.id = task.submitted_by
    where task.id = p_task_id
      and task.status in ('submitted', 'resubmitted')
      and public.has_store_access(task.store_id)
      and (
        public.current_user_role() = 'admin'
        or (
          public.current_user_role() = 'manager'
          and task.manager_review_enabled
          and task.store_id = public.current_user_store_id()
          and coalesce(task.submitted_by_role, submitter.role) = 'staff'
        )
      )
  )
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
          task.publish_at <= now()
          and public.current_user_role() in ('staff', 'manager')
          and task.store_id = public.current_user_store_id()
          and (
            task.assigned_profile_id = auth.uid()
            or (
              task.assigned_profile_id is null
              and public.v2_task_audience_for_profile(auth.uid()) = any(task.target_audiences)
            )
            or public.can_review_v2_task(task.id)
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
      and task.publish_at <= now()
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

create or replace function public.notify_v2_task_publication(p_task_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_task public.v2_tasks%rowtype;
begin
  select * into v_task from public.v2_tasks where id = p_task_id for update;
  if v_task.id is null or v_task.status = 'cancelled' or v_task.publish_at > now() or v_task.publish_notified_at is not null then
    return false;
  end if;

  insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  select profile.id, v_task.store_id, 'v2_task_published',
    case when v_task.schedule_id is null then '新任务：' else '新周期任务：' end || v_task.name,
    '截止时间：' || to_char(v_task.due_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI'),
    'v2_task', v_task.id, 'v2-task-published:' || v_task.id || ':' || profile.id
  from public.profiles profile
  where profile.is_active and profile.deleted_at is null and profile.role in ('staff', 'manager')
    and profile.store_id = v_task.store_id
    and (
      v_task.assigned_profile_id = profile.id
      or (v_task.assigned_profile_id is null and public.v2_task_audience_for_profile(profile.id) = any(v_task.target_audiences))
    )
  on conflict(dedupe_key) do nothing;

  update public.v2_tasks set publish_notified_at = now() where id = v_task.id;
  return true;
end;
$$;

create or replace function public.dispatch_scheduled_v2_task_publications()
returns integer language plpgsql security definer set search_path = public as $$
declare v_task record; v_count integer := 0;
begin
  for v_task in
    select id from public.v2_tasks
    where publish_notified_at is null and publish_at <= now() and status <> 'cancelled'
    order by publish_at
    for update skip locked
  loop
    if public.notify_v2_task_publication(v_task.id) then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end;
$$;

create function public.publish_v2_tasks_v2(
  p_template_id uuid,
  p_store_ids uuid[],
  p_due_at timestamptz,
  p_publish_at timestamptz default now(),
  p_profile_ids uuid[] default '{}',
  p_target_audiences text[] default array['staff', 'manager']::text[],
  p_manager_review_enabled boolean default false
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
  v_publish_at timestamptz := coalesce(p_publish_at, now());
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required' using errcode = '42501'; end if;
  select * into v_template from public.v2_task_templates where id = p_template_id and status = 'published';
  if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then raise exception 'published template required' using errcode = '42501'; end if;
  select * into v_version from public.v2_task_template_versions where template_id = v_template.id and version_number = v_template.current_version;
  if v_publish_at < now() - interval '1 minute' then raise exception '发布时间不能早于当前时间' using errcode = '22023'; end if;
  if p_due_at <= v_publish_at then raise exception '验收截止时间必须晚于发布时间' using errcode = '22023'; end if;
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
      insert into public.v2_tasks(template_id, template_version_id, store_id, assigned_profile_id, target_audiences, name, category, snapshot, due_at, publish_at, allow_overdue, requires_review, manager_review_enabled, created_by)
      values(v_template.id, v_version.id, v_profile.store_id, v_profile.id, array[v_profile_audience], v_template.name, v_template.category, v_version.snapshot, p_due_at, v_publish_at, v_template.allow_overdue, v_template.requires_review, p_manager_review_enabled, auth.uid()) returning * into v_task;
      for v_group in select value from jsonb_array_elements(v_version.snapshot->'groups') loop
        for v_item in select value from jsonb_array_elements(v_group->'items') loop
          insert into public.v2_task_answers(task_id, item_id, group_id, item_snapshot) values(v_task.id, (v_item->>'id')::uuid, (v_group->>'id')::uuid, v_item);
        end loop;
      end loop;
      perform public.notify_v2_task_publication(v_task.id);
      insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
      values(v_profile.store_id, auth.uid(), 'v2_task_published', 'v2_tasks', v_task.id, jsonb_build_object('template', v_template.name, 'assigned_profile_id', v_profile.id, 'publish_at', v_publish_at, 'manager_review_enabled', p_manager_review_enabled));
      return next v_task;
    end loop;
    if not found then raise exception 'task recipient required' using errcode = '22023'; end if;
    return;
  end if;

  foreach v_store in array p_store_ids loop
    if not public.has_store_access(v_store) or not exists(select 1 from public.v2_task_template_stores where template_id = v_template.id and store_id = v_store) then raise exception 'template store access denied' using errcode = '42501'; end if;
    insert into public.v2_tasks(template_id, template_version_id, store_id, target_audiences, name, category, snapshot, due_at, publish_at, allow_overdue, requires_review, manager_review_enabled, created_by)
    values(v_template.id, v_version.id, v_store, p_target_audiences, v_template.name, v_template.category, v_version.snapshot, p_due_at, v_publish_at, v_template.allow_overdue, v_template.requires_review, p_manager_review_enabled, auth.uid()) returning * into v_task;
    for v_group in select value from jsonb_array_elements(v_version.snapshot->'groups') loop
      for v_item in select value from jsonb_array_elements(v_group->'items') loop
        insert into public.v2_task_answers(task_id, item_id, group_id, item_snapshot) values(v_task.id, (v_item->>'id')::uuid, (v_group->>'id')::uuid, v_item);
      end loop;
    end loop;
    perform public.notify_v2_task_publication(v_task.id);
    insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
    values(v_store, auth.uid(), 'v2_task_published', 'v2_tasks', v_task.id, jsonb_build_object('template', v_template.name, 'target_audiences', p_target_audiences, 'publish_at', v_publish_at, 'manager_review_enabled', p_manager_review_enabled));
    return next v_task;
  end loop;
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
  insert into public.v2_tasks(template_id, template_version_id, schedule_id, store_id, assigned_profile_id, target_audiences, name, category, snapshot, due_at, publish_at, allow_overdue, requires_review, manager_review_enabled, created_by)
  values(v_schedule.template_id, v_schedule.template_version_id, v_schedule.id, v_schedule.store_id, v_schedule.assigned_profile_id, v_schedule.target_audiences, v_name, v_snapshot->'template'->>'category', v_snapshot, p_due_at, now(), coalesce((v_snapshot->'template'->>'allow_overdue')::boolean, false), coalesce((v_snapshot->'template'->>'requires_review')::boolean, true), v_schedule.manager_review_enabled, v_schedule.created_by)
  returning * into v_task;
  for v_group in select value from jsonb_array_elements(v_snapshot->'groups') loop
    for v_item in select value from jsonb_array_elements(v_group->'items') loop
      insert into public.v2_task_answers(task_id, item_id, group_id, item_snapshot) values(v_task.id, (v_item->>'id')::uuid, (v_group->>'id')::uuid, v_item);
    end loop;
  end loop;
  perform public.notify_v2_task_publication(v_task.id);
  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values(v_schedule.store_id, v_schedule.created_by, 'v2_scheduled_task_published', 'v2_tasks', v_task.id, jsonb_build_object('schedule_id', v_schedule.id, 'assigned_profile_id', v_schedule.assigned_profile_id, 'target_audiences', v_schedule.target_audiences, 'manager_review_enabled', v_schedule.manager_review_enabled));
  return v_task;
end;
$$;

create or replace function public.create_v2_task_schedule_v2(
  p_template_id uuid,
  p_store_ids uuid[],
  p_profile_ids uuid[],
  p_fields jsonb
)
returns setof public.v2_tasks language plpgsql security definer set search_path = public as $$
declare
  v_template public.v2_task_templates%rowtype; v_version public.v2_task_template_versions%rowtype; v_profile public.profiles%rowtype;
  v_store uuid; v_schedule public.v2_task_schedules%rowtype; v_task public.v2_tasks%rowtype;
  v_release_type text := coalesce(p_fields->>'scheduleType', ''); v_interval smallint := nullif(p_fields->>'intervalDays', '')::smallint;
  v_weekdays smallint[] := coalesce(array(select value::smallint from jsonb_array_elements_text(coalesce(p_fields->'weekdays', '[]'::jsonb)) value), '{}');
  v_month_day smallint := nullif(p_fields->>'monthDay', '')::smallint; v_publish_time time := nullif(p_fields->>'publishTime', '')::time;
  v_acceptance_type text := coalesce(p_fields->>'acceptanceType', ''); v_acceptance_days smallint := nullif(p_fields->>'acceptanceIntervalDays', '')::smallint;
  v_acceptance_weekday smallint := nullif(p_fields->>'acceptanceWeekday', '')::smallint; v_acceptance_month_day smallint := nullif(p_fields->>'acceptanceMonthDay', '')::smallint;
  v_acceptance_time time := nullif(p_fields->>'acceptanceTime', '')::time; v_now timestamptz := now();
  v_requested_first timestamptz := nullif(p_fields->>'nextPublishAt', '')::timestamptz;
  v_publish_immediately boolean := coalesce((p_fields->>'publishImmediately')::boolean, false);
  v_manager_review_enabled boolean := coalesce((p_fields->>'managerReviewEnabled')::boolean, false);
  v_first_release timestamptz; v_first_due timestamptz; v_next_release timestamptz; v_immediate_due timestamptz;
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
  if v_version.id is null then raise exception 'task template version not found'; end if;

  for v_profile in select distinct profile.* from public.profiles profile where coalesce(cardinality(p_profile_ids), 0) > 0 and profile.id = any(p_profile_ids) loop
    if not v_profile.is_active or v_profile.deleted_at is not null or v_profile.role not in ('staff', 'manager') or v_profile.store_id <> all(p_store_ids)
      or not public.has_store_access(v_profile.store_id) or not exists(select 1 from public.v2_task_template_stores where template_id = v_template.id and store_id = v_profile.store_id) then raise exception 'task recipient access denied'; end if;
    v_profile_audience := public.v2_task_audience_for_profile(v_profile.id);
    insert into public.v2_task_schedules(template_id, template_version_id, store_id, assigned_profile_id, target_audiences, schedule_type, interval_days, weekdays, month_day, publish_time, due_time, acceptance_type, acceptance_interval_days, acceptance_weekday, acceptance_month_day, next_due_at, last_published_at, manager_review_enabled, created_by)
    values(v_template.id, v_version.id, v_profile.store_id, v_profile.id, array[v_profile_audience], v_release_type, case when v_release_type = 'interval_days' then v_interval end, case when v_release_type = 'weekly' then v_weekdays else '{}' end, case when v_release_type = 'monthly' then v_month_day end, v_publish_time, v_acceptance_time, v_acceptance_type, case when v_acceptance_type = 'daily' then v_acceptance_days end, case when v_acceptance_type = 'weekly' then v_acceptance_weekday end, case when v_acceptance_type = 'monthly' then v_acceptance_month_day end, v_now, null, v_manager_review_enabled, auth.uid()) returning * into v_schedule;
    v_first_release := coalesce(v_requested_first, public.v2_task_schedule_first_release(v_schedule.id, v_now));
    if v_first_release < v_now - interval '1 minute' then raise exception '首次发布时间不能早于当前时间'; end if;
    v_first_due := public.v2_task_schedule_acceptance_due(v_schedule.id, v_first_release); v_next_release := public.v2_task_schedule_next_due(v_schedule.id, v_first_release);
    if v_first_due <= v_first_release then raise exception '验收时间必须晚于首次发布时间'; end if;
    if v_first_due >= v_next_release then raise exception '验收截止时间必须早于下一次发布时间，请调整发布或验收周期'; end if;
    update public.v2_task_schedules set next_due_at = v_first_release where id = v_schedule.id;
    if v_publish_immediately then
      v_immediate_due := public.v2_task_schedule_acceptance_due(v_schedule.id, v_now);
      if v_immediate_due <= v_now then raise exception '立即发布任务的验收时间必须晚于当前时间'; end if;
      if v_immediate_due >= v_first_release then raise exception '立即发布任务的验收截止时间必须早于首次定时发布时间'; end if;
      select * into v_task from public.create_v2_task_from_schedule(v_schedule.id, v_immediate_due);
      update public.v2_task_schedules set last_published_at = v_now where id = v_schedule.id;
      return next v_task;
    end if;
    insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata) values(v_schedule.store_id, auth.uid(), 'v2_task_schedule_created', 'v2_task_schedules', v_schedule.id, jsonb_build_object('first_publish_at', v_first_release, 'assigned_profile_id', v_profile.id, 'manager_review_enabled', v_manager_review_enabled));
  end loop;
  if coalesce(cardinality(p_profile_ids), 0) > 0 then return; end if;

  foreach v_store in array p_store_ids loop
    if not public.has_store_access(v_store) or not exists(select 1 from public.v2_task_template_stores where template_id = v_template.id and store_id = v_store) then raise exception 'template store access denied'; end if;
    insert into public.v2_task_schedules(template_id, template_version_id, store_id, target_audiences, schedule_type, interval_days, weekdays, month_day, publish_time, due_time, acceptance_type, acceptance_interval_days, acceptance_weekday, acceptance_month_day, next_due_at, last_published_at, manager_review_enabled, created_by)
    values(v_template.id, v_version.id, v_store, v_target_audiences, v_release_type, case when v_release_type = 'interval_days' then v_interval end, case when v_release_type = 'weekly' then v_weekdays else '{}' end, case when v_release_type = 'monthly' then v_month_day end, v_publish_time, v_acceptance_time, v_acceptance_type, case when v_acceptance_type = 'daily' then v_acceptance_days end, case when v_acceptance_type = 'weekly' then v_acceptance_weekday end, case when v_acceptance_type = 'monthly' then v_acceptance_month_day end, v_now, null, v_manager_review_enabled, auth.uid()) returning * into v_schedule;
    v_first_release := coalesce(v_requested_first, public.v2_task_schedule_first_release(v_schedule.id, v_now));
    if v_first_release < v_now - interval '1 minute' then raise exception '首次发布时间不能早于当前时间'; end if;
    v_first_due := public.v2_task_schedule_acceptance_due(v_schedule.id, v_first_release); v_next_release := public.v2_task_schedule_next_due(v_schedule.id, v_first_release);
    if v_first_due <= v_first_release then raise exception '验收时间必须晚于首次发布时间'; end if;
    if v_first_due >= v_next_release then raise exception '验收截止时间必须早于下一次发布时间，请调整发布或验收周期'; end if;
    update public.v2_task_schedules set next_due_at = v_first_release where id = v_schedule.id;
    if v_publish_immediately then
      v_immediate_due := public.v2_task_schedule_acceptance_due(v_schedule.id, v_now);
      if v_immediate_due <= v_now then raise exception '立即发布任务的验收时间必须晚于当前时间'; end if;
      if v_immediate_due >= v_first_release then raise exception '立即发布任务的验收截止时间必须早于首次定时发布时间'; end if;
      select * into v_task from public.create_v2_task_from_schedule(v_schedule.id, v_immediate_due);
      update public.v2_task_schedules set last_published_at = v_now where id = v_schedule.id;
      return next v_task;
    end if;
    insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata) values(v_store, auth.uid(), 'v2_task_schedule_created', 'v2_task_schedules', v_schedule.id, jsonb_build_object('first_publish_at', v_first_release, 'target_audiences', v_target_audiences, 'manager_review_enabled', v_manager_review_enabled));
  end loop;
  return;
end;
$$;

create or replace function public.update_v2_task_schedule_v2(p_schedule_id uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.v2_task_schedules%rowtype; v_now timestamptz := now(); v_due timestamptz; v_next timestamptz; v_following timestamptz; v_current_due timestamptz;
  v_release_type text := coalesce(p_fields->>'scheduleType', ''); v_interval smallint := nullif(p_fields->>'intervalDays', '')::smallint;
  v_weekdays smallint[] := coalesce(array(select value::smallint from jsonb_array_elements_text(coalesce(p_fields->'weekdays', '[]'::jsonb)) value), '{}');
  v_month_day smallint := nullif(p_fields->>'monthDay', '')::smallint; v_publish_time time := nullif(p_fields->>'publishTime', '')::time;
  v_acceptance_type text := coalesce(p_fields->>'acceptanceType', ''); v_acceptance_days smallint := nullif(p_fields->>'acceptanceIntervalDays', '')::smallint;
  v_acceptance_weekday smallint := nullif(p_fields->>'acceptanceWeekday', '')::smallint; v_acceptance_month_day smallint := nullif(p_fields->>'acceptanceMonthDay', '')::smallint;
  v_acceptance_time time := nullif(p_fields->>'acceptanceTime', '')::time;
  v_requested_next timestamptz := nullif(p_fields->>'nextPublishAt', '')::timestamptz;
  v_manager_review_enabled boolean := coalesce((p_fields->>'managerReviewEnabled')::boolean, false);
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required'; end if;
  select * into s from public.v2_task_schedules where id = p_schedule_id for update;
  if s.id is null or not public.has_store_access(s.store_id) then raise exception 'schedule access denied'; end if;
  if v_publish_time is null or v_acceptance_time is null then raise exception '请设置发布和验收时间'; end if;
  if not ((v_release_type = 'interval_days' and v_interval between 1 and 31 and cardinality(v_weekdays) = 0 and v_month_day is null)
    or (v_release_type = 'weekly' and v_interval is null and cardinality(v_weekdays) between 1 and 7 and v_month_day is null)
    or (v_release_type = 'monthly' and v_interval is null and cardinality(v_weekdays) = 0 and v_month_day between 1 and 31)) then raise exception '请完善发布周期'; end if;
  if not ((v_acceptance_type = 'daily' and v_acceptance_days between 0 and 31 and v_acceptance_weekday is null and v_acceptance_month_day is null)
    or (v_acceptance_type = 'weekly' and v_acceptance_days is null and v_acceptance_weekday between 1 and 7 and v_acceptance_month_day is null)
    or (v_acceptance_type = 'monthly' and v_acceptance_days is null and v_acceptance_weekday is null and v_acceptance_month_day between 1 and 31)) then raise exception '请完善验收周期'; end if;
  update public.v2_task_schedules set schedule_type = v_release_type, interval_days = case when v_release_type = 'interval_days' then v_interval end, weekdays = case when v_release_type = 'weekly' then v_weekdays else '{}' end, month_day = case when v_release_type = 'monthly' then v_month_day end, publish_time = v_publish_time, due_time = v_acceptance_time, acceptance_type = v_acceptance_type, acceptance_interval_days = case when v_acceptance_type = 'daily' then v_acceptance_days end, acceptance_weekday = case when v_acceptance_type = 'weekly' then v_acceptance_weekday end, acceptance_month_day = case when v_acceptance_type = 'monthly' then v_acceptance_month_day end, manager_review_enabled = v_manager_review_enabled where id = s.id returning * into s;
  v_next := coalesce(v_requested_next, public.v2_task_schedule_first_release(s.id, v_now));
  if v_next < v_now - interval '1 minute' then raise exception '下次发布时间不能早于当前时间'; end if;
  v_due := public.v2_task_schedule_acceptance_due(s.id, v_next); v_following := public.v2_task_schedule_next_due(s.id, v_next);
  if v_due <= v_next then raise exception '验收时间必须晚于下次发布时间'; end if;
  if v_due >= v_following then raise exception '验收截止时间必须早于后续发布时间，请调整周期'; end if;
  update public.v2_task_schedules set next_due_at = v_next where id = s.id returning * into s;
  v_current_due := public.v2_task_schedule_acceptance_due(s.id, v_now);
  update public.v2_tasks set due_at = case when v_current_due > v_now then v_current_due else due_at end, manager_review_enabled = v_manager_review_enabled, version = version + 1 where schedule_id = s.id and status in ('pending', 'in_progress', 'rejected', 'overdue');
  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata) values(s.store_id, auth.uid(), 'v2_task_schedule_updated', 'v2_task_schedules', s.id, p_fields);
  return to_jsonb(s);
end;
$$;

create or replace function public.submit_v2_task(p_task_id uuid, p_expected_version integer, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_task public.v2_tasks%rowtype; v_missing integer; v_is_resubmission boolean; v_submitter_role text;
begin
  select * into v_task from public.v2_tasks where id = p_task_id for update;
  if not public.can_edit_v2_task(p_task_id) then raise exception 'task submit denied' using errcode = '42501'; end if;
  if v_task.version <> p_expected_version then raise exception 'task version conflict' using errcode = '40001'; end if;
  select role into v_submitter_role from public.profiles where id = auth.uid();

  select count(*) into v_missing from public.v2_task_answers answer
  where answer.task_id = p_task_id and coalesce((answer.item_snapshot->>'is_required')::boolean, true) and (
    ((coalesce(answer.item_snapshot->>'field_type', '') in ('image', 'multi_image') or coalesce(answer.item_snapshot->>'image_requirement', 'none') in ('single', 'multiple'))
      and (select count(*) from public.v2_task_images image where image.task_id = answer.task_id and image.item_id = answer.item_id)
        < case when coalesce(answer.item_snapshot->>'image_requirement', 'none') = 'multiple' then case when answer.item_snapshot ? 'minimum_image_count' then greatest(2, least(20, coalesce(nullif(answer.item_snapshot->>'minimum_image_count', '')::integer, 2))) else 1 end else 1 end)
    or case coalesce(answer.item_snapshot->>'field_type', '') when 'instruction' then false when 'image' then false when 'multi_image' then false when 'confirmation' then answer.answer is distinct from 'true'::jsonb when 'multi_choice' then answer.answer is null or answer.answer = 'null'::jsonb or (jsonb_typeof(answer.answer) = 'array' and jsonb_array_length(answer.answer) = 0) else answer.answer is null or answer.answer = 'null'::jsonb or answer.answer = '""'::jsonb end
  );
  if v_missing > 0 then raise exception 'required task answers or images are missing' using errcode = '23514'; end if;

  v_is_resubmission := v_task.status = 'rejected';
  if v_is_resubmission then
    update public.v2_task_answers set review_status = 'resubmitted', submission_round = greatest(submission_round + 1, 2), last_reviewed_by = null, last_reviewed_at = null where task_id = p_task_id and item_id = any(v_task.correction_item_ids) and review_status = 'rejected';
  elsif v_task.requires_review then
    update public.v2_task_answers set review_status = 'pending', submission_round = greatest(submission_round, 1), last_reviewed_by = null, last_reviewed_at = null where task_id = p_task_id;
  else
    update public.v2_task_answers set review_status = 'approved', submission_round = greatest(submission_round, 1), last_reviewed_by = auth.uid(), last_reviewed_at = now() where task_id = p_task_id;
  end if;

  update public.v2_tasks set status = case when v_is_resubmission then 'resubmitted' when requires_review then 'submitted' else 'approved' end, submission_key = p_key, submitted_by = auth.uid(), submitted_by_role = v_submitter_role, submitted_at = now(), correction_item_ids = case when v_is_resubmission then correction_item_ids else '{}'::uuid[] end, version = version + 1 where id = p_task_id returning * into v_task;
  insert into public.v2_task_reviews(task_id, action, actor_id) values(p_task_id, case when v_is_resubmission then 'resubmitted' else 'submitted' end, auth.uid());
  if v_task.requires_review then
    insert into public.notifications(recipient_role, store_id, type, title, body, entity_type, entity_id, dedupe_key)
    values('admin', v_task.store_id, 'v2_task_submitted', case when v_is_resubmission then '整改任务已重新提交' else '任务待审核' end, v_task.name, 'v2_task', v_task.id, 'v2-task-submitted:' || v_task.id || ':' || v_task.version || ':admin') on conflict(dedupe_key) do nothing;
    if v_task.manager_review_enabled and v_submitter_role = 'staff' then
      insert into public.notifications(recipient_role, store_id, type, title, body, entity_type, entity_id, dedupe_key)
      values('manager', v_task.store_id, 'v2_task_submitted', case when v_is_resubmission then '整改任务已重新提交' else '员工任务待审核' end, v_task.name, 'v2_task', v_task.id, 'v2-task-submitted:' || v_task.id || ':' || v_task.version || ':manager') on conflict(dedupe_key) do nothing;
    end if;
  end if;
  return to_jsonb(v_task);
end;
$$;

create or replace function public.review_v2_task_items(p_task_id uuid, p_decisions jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_task public.v2_tasks%rowtype; v_expected_status text; v_eligible_count integer; v_processed_count integer := 0; v_rejected_ids uuid[] := '{}'::uuid[];
  v_decision jsonb; v_item_id uuid; v_value text; v_round integer; v_action text;
begin
  select * into v_task from public.v2_tasks where id = p_task_id for update;
  if v_task.id is null or not public.can_review_v2_task(p_task_id) then raise exception 'review denied' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_decisions, 'null'::jsonb)) <> 'array' then raise exception 'review decisions must be an array' using errcode = '22023'; end if;
  v_expected_status := case when v_task.status = 'resubmitted' then 'resubmitted' else 'pending' end;
  select count(*) into v_eligible_count from public.v2_task_answers where task_id = p_task_id and review_status = v_expected_status;
  if v_eligible_count = 0 then raise exception 'no task items require review' using errcode = '55000'; end if;
  for v_decision in select value from jsonb_array_elements(p_decisions) loop
    v_item_id := (v_decision->>'item_id')::uuid; v_value := v_decision->>'decision';
    if v_value not in ('approved', 'rejected') then raise exception 'invalid item review decision' using errcode = '22023'; end if;
    select submission_round into v_round from public.v2_task_answers where task_id = p_task_id and item_id = v_item_id and review_status = v_expected_status for update;
    if not found then raise exception 'task item is not reviewable' using errcode = '55000'; end if;
    update public.v2_task_answers set review_status = v_value, last_reviewed_by = auth.uid(), last_reviewed_at = now() where task_id = p_task_id and item_id = v_item_id;
    insert into public.v2_task_item_reviews(task_id, item_id, submission_round, decision, actor_id, note) values(p_task_id, v_item_id, v_round, v_value, auth.uid(), coalesce(p_note, ''));
    if v_value = 'rejected' then v_rejected_ids := array_append(v_rejected_ids, v_item_id); end if;
    v_processed_count := v_processed_count + 1;
  end loop;
  if v_processed_count <> v_eligible_count then raise exception 'every reviewable task item needs a decision' using errcode = '22023'; end if;
  if coalesce(array_length(v_rejected_ids, 1), 0) > 0 and btrim(coalesce(p_note, '')) = '' then raise exception 'rejection reason required' using errcode = '23514'; end if;
  v_action := case when coalesce(array_length(v_rejected_ids, 1), 0) > 0 then 'rejected' else 'approved' end;
  update public.v2_tasks set status = v_action, reviewed_by = auth.uid(), reviewed_at = now(), review_note = coalesce(p_note, ''), correction_item_ids = case when v_action = 'rejected' then v_rejected_ids else '{}'::uuid[] end, version = version + 1 where id = p_task_id returning * into v_task;
  insert into public.v2_task_reviews(task_id, action, actor_id, note, correction_item_ids) values(p_task_id, v_action, auth.uid(), coalesce(p_note, ''), v_rejected_ids);
  insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  values(coalesce(v_task.submitted_by, v_task.started_by), v_task.store_id, 'v2_task_' || v_action, case when v_action = 'approved' then '任务审核通过' else '任务需要整改' end, case when v_action = 'approved' then v_task.name else left(p_note, 180) end, 'v2_task', v_task.id, 'v2-task-review:' || v_task.id || ':' || v_task.version) on conflict(dedupe_key) do nothing;
  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata) values(v_task.store_id, auth.uid(), 'v2_task_' || v_action, 'v2_tasks', v_task.id, jsonb_build_object('note', p_note, 'item_decisions', p_decisions, 'reviewer_role', public.current_user_role()));
  return to_jsonb(v_task);
end;
$$;

create or replace function public.dispatch_v2_task_schedules()
returns integer language plpgsql security definer set search_path = public as $$
declare s public.v2_task_schedules%rowtype; v_release timestamptz; v_due timestamptz; v_next timestamptz; v_created integer := 0;
begin
  perform public.dispatch_scheduled_v2_task_publications();
  for s in select * from public.v2_task_schedules where is_active and next_due_at <= now() for update skip locked loop
    v_release := s.next_due_at; v_due := public.v2_task_schedule_acceptance_due(s.id, v_release);
    while v_due <= now() loop v_release := public.v2_task_schedule_next_due(s.id, v_release); v_due := public.v2_task_schedule_acceptance_due(s.id, v_release); end loop;
    v_next := public.v2_task_schedule_next_due(s.id, v_release);
    if v_due >= v_next then update public.v2_task_schedules set is_active = false, paused_at = now() where id = s.id; continue; end if;
    perform public.create_v2_task_from_schedule(s.id, v_due);
    update public.v2_task_schedules set next_due_at = v_next, last_published_at = v_release where id = s.id;
    v_created := v_created + 1;
  end loop;
  return v_created;
end;
$$;

create function public.admin_get_payroll_individual_tax_override(p_profile_id uuid, p_payroll_month date)
returns numeric language plpgsql security definer set search_path = public stable as $$
declare v_amount numeric;
begin
  if public.current_user_role() <> 'admin' or not public.can_admin_manage_attendance_profile(p_profile_id) then raise exception 'payroll tax access denied'; end if;
  select amount into v_amount from public.payroll_individual_tax_overrides where profile_id = p_profile_id and payroll_month = date_trunc('month', p_payroll_month)::date;
  return v_amount;
end;
$$;

create function public.admin_save_payroll_individual_tax_override(p_profile_id uuid, p_payroll_month date, p_amount numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', p_payroll_month)::date;
begin
  if public.current_user_role() <> 'admin' or not public.can_admin_manage_attendance_profile(p_profile_id) then raise exception 'payroll tax access denied'; end if;
  if p_amount is null then
    delete from public.payroll_individual_tax_overrides where profile_id = p_profile_id and payroll_month = v_month;
    return jsonb_build_object('mode', 'automatic', 'amount', null);
  end if;
  if p_amount < 0 then raise exception 'individual income tax must not be negative'; end if;
  insert into public.payroll_individual_tax_overrides(profile_id, payroll_month, amount, updated_by)
  values(p_profile_id, v_month, round(p_amount, 2), auth.uid())
  on conflict(profile_id, payroll_month) do update set amount = excluded.amount, updated_by = auth.uid(), updated_at = now();
  return jsonb_build_object('mode', 'override', 'amount', round(p_amount, 2));
end;
$$;

create function public.payroll_cumulative_tax_liability(p_taxable_income numeric)
returns numeric language sql immutable as $$
  select round(case
    when greatest(coalesce(p_taxable_income, 0), 0) <= 36000 then greatest(coalesce(p_taxable_income, 0), 0) * 0.03
    when p_taxable_income <= 144000 then p_taxable_income * 0.10 - 2520
    when p_taxable_income <= 300000 then p_taxable_income * 0.20 - 16920
    when p_taxable_income <= 420000 then p_taxable_income * 0.25 - 31920
    when p_taxable_income <= 660000 then p_taxable_income * 0.30 - 52920
    when p_taxable_income <= 960000 then p_taxable_income * 0.35 - 85920
    else p_taxable_income * 0.45 - 181920 end, 2)
$$;

alter function public.get_payroll_estimate(uuid, date)
  rename to calculate_payroll_estimate_before_estimated_individual_tax;

create function public.get_payroll_estimate(p_profile_id uuid, p_as_of date default ((now() at time zone 'Asia/Shanghai')::date))
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb; v_month date := date_trunc('month', p_as_of)::date; v_current_income numeric := 0;
  v_prior_income numeric := 0; v_prior_tax numeric := 0; v_prior_months integer := 0; v_taxable numeric := 0;
  v_auto_tax numeric := 0; v_override numeric := null; v_tax numeric := 0; v_mode text := 'automatic'; v_basis text := 'current_month';
  v_known numeric := 0; v_complete numeric := null;
begin
  v_result := public.calculate_payroll_estimate_before_estimated_individual_tax(p_profile_id, p_as_of);
  v_current_income := greatest(coalesce(nullif(v_result->>'incomeSubtotalKnown', '')::numeric, 0), 0);

  select coalesce(sum((estimate_snapshot->>'incomeSubtotalKnown')::numeric), 0),
         coalesce(sum((estimate_snapshot->>'individualIncomeTax')::numeric), 0), count(*)
  into v_prior_income, v_prior_tax, v_prior_months
  from public.payroll_payslips
  where profile_id = p_profile_id and payroll_month >= make_date(extract(year from v_month)::integer, 1, 1)
    and payroll_month < v_month and status <> 'withdrawn';

  if v_prior_months > 0 then
    v_taxable := greatest(v_prior_income + v_current_income - 5000 * (v_prior_months + 1), 0);
    v_auto_tax := greatest(public.payroll_cumulative_tax_liability(v_taxable) - v_prior_tax, 0);
    v_basis := 'year_to_date';
  else
    v_taxable := greatest(v_current_income - 5000, 0);
    v_auto_tax := public.payroll_cumulative_tax_liability(v_taxable);
  end if;

  select amount into v_override from public.payroll_individual_tax_overrides where profile_id = p_profile_id and payroll_month = v_month;
  if v_override is not null then v_tax := v_override; v_mode := 'override'; else v_tax := v_auto_tax; end if;
  v_known := greatest(coalesce((v_result->>'knownEstimatedPayable')::numeric, 0) - v_tax, 0);
  if v_result->>'estimatedPayable' is not null then v_complete := greatest((v_result->>'estimatedPayable')::numeric - v_tax, 0); end if;

  return v_result || jsonb_build_object(
    'estimatedIndividualIncomeTax', round(v_tax, 2),
    'individualIncomeTaxEstimateMode', v_mode,
    'individualIncomeTaxEstimateBasis', v_basis,
    'knownEstimatedNetPayable', round(v_known, 2),
    'estimatedNetPayable', case when v_complete is null then null else round(v_complete, 2) end
  );
end;
$$;

revoke all on function public.can_review_v2_task(uuid), public.notify_v2_task_publication(uuid), public.dispatch_scheduled_v2_task_publications(), public.publish_v2_tasks_v2(uuid,uuid[],timestamptz,timestamptz,uuid[],text[],boolean), public.admin_get_payroll_individual_tax_override(uuid,date), public.admin_save_payroll_individual_tax_override(uuid,date,numeric), public.payroll_cumulative_tax_liability(numeric), public.calculate_payroll_estimate_before_estimated_individual_tax(uuid,date) from public, anon, authenticated;
grant execute on function public.can_review_v2_task(uuid), public.publish_v2_tasks_v2(uuid,uuid[],timestamptz,timestamptz,uuid[],text[],boolean), public.admin_get_payroll_individual_tax_override(uuid,date), public.admin_save_payroll_individual_tax_override(uuid,date,numeric), public.get_payroll_estimate(uuid,date) to authenticated;
grant execute on function public.submit_v2_task(uuid,integer,text), public.review_v2_task_items(uuid,jsonb,text), public.create_v2_task_schedule_v2(uuid,uuid[],uuid[],jsonb), public.update_v2_task_schedule_v2(uuid,jsonb) to authenticated;

do $$
declare job_id bigint;
begin
  for job_id in select jobid from cron.job where jobname = 'storehub-v2-task-schedule-dispatch' loop perform cron.unschedule(job_id); end loop;
  perform cron.schedule('storehub-v2-task-schedule-dispatch', '* * * * *', 'select public.dispatch_v2_task_schedules()');
end;
$$;
