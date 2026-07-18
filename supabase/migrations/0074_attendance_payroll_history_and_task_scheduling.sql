-- Count attendance only after both required punches are complete, add employee
-- payroll-history visibility settings, dynamic task categories, and independent
-- recurring-task publication / acceptance rules.

create or replace function public.enforce_complete_attendance_day()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.is_attended := new.actual_on_at is not null
    and new.actual_off_at is not null
    and new.missing_punch = 'none'
    and new.daily_status not in ('rest','leave','business_trip','pending','missing');
  return new;
end;
$$;

drop trigger if exists attendance_daily_records_enforce_complete_day on public.attendance_daily_records;
create trigger attendance_daily_records_enforce_complete_day
before insert or update of actual_on_at, actual_off_at, missing_punch, daily_status
on public.attendance_daily_records
for each row execute function public.enforce_complete_attendance_day();

update public.attendance_daily_records
set is_attended = actual_on_at is not null
  and actual_off_at is not null
  and missing_punch = 'none'
  and daily_status not in ('rest','leave','business_trip','pending','missing')
where is_attended is distinct from (
  actual_on_at is not null
  and actual_off_at is not null
  and missing_punch = 'none'
  and daily_status not in ('rest','leave','business_trip','pending','missing')
);

revoke all on function public.enforce_complete_attendance_day() from public, anon, authenticated;

create table public.payroll_visibility_settings (
  id boolean primary key default true check (id),
  history_months smallint not null default 3 check (history_months between 0 and 24),
  history_available_until_day smallint not null default 31 check (history_available_until_day between 1 and 31),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.payroll_visibility_settings(id) values (true) on conflict (id) do nothing;
alter table public.payroll_visibility_settings enable row level security;
revoke all on public.payroll_visibility_settings from anon, authenticated;

create function public.get_payroll_visibility_settings()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'historyMonths', settings.history_months,
    'historyAvailableUntilDay', settings.history_available_until_day,
    'historyOpenNow', extract(day from now() at time zone 'Asia/Shanghai')::integer <= settings.history_available_until_day
  )
  from public.payroll_visibility_settings settings
  where settings.id
$$;

create function public.admin_save_payroll_visibility_settings(
  p_history_months smallint,
  p_history_available_until_day smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.payroll_visibility_settings;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator permission required'; end if;
  if p_history_months not between 0 and 24 then raise exception '历史月份必须在 0 到 24 个月之间'; end if;
  if p_history_available_until_day not between 1 and 31 then raise exception '每月开放截止日必须在 1 到 31 日之间'; end if;
  update public.payroll_visibility_settings
  set history_months = p_history_months,
    history_available_until_day = p_history_available_until_day,
    updated_by = auth.uid(),
    updated_at = now()
  where id
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

alter function public.get_payroll_estimate(uuid,date)
  rename to calculate_payroll_estimate_before_history_policy;

create function public.get_payroll_estimate(
  p_profile_id uuid,
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date)
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_requested_month date := date_trunc('month', p_as_of)::date;
  v_current_month date := date_trunc('month', now() at time zone 'Asia/Shanghai')::date;
  v_settings public.payroll_visibility_settings;
begin
  if v_role in ('staff','manager') and p_profile_id = auth.uid() and v_requested_month < v_current_month then
    select * into v_settings from public.payroll_visibility_settings where id;
    if extract(day from v_today)::integer > v_settings.history_available_until_day then
      raise exception '本月历史工资查看期限已结束';
    end if;
    if v_requested_month < (v_current_month - make_interval(months => v_settings.history_months))::date then
      raise exception '所选月份超出管理员开放的历史工资范围';
    end if;
  end if;
  return public.calculate_payroll_estimate_before_history_policy(p_profile_id, p_as_of);
end;
$$;

revoke all on function public.calculate_payroll_estimate_before_history_policy(uuid,date) from public, anon, authenticated;
revoke all on function public.get_payroll_visibility_settings(), public.admin_save_payroll_visibility_settings(smallint,smallint), public.get_payroll_estimate(uuid,date) from public, anon;
grant execute on function public.get_payroll_visibility_settings(), public.get_payroll_estimate(uuid,date) to authenticated;
grant execute on function public.admin_save_payroll_visibility_settings(smallint,smallint) to authenticated;

create table public.v2_task_categories (
  code text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  label text not null unique check (nullif(btrim(label), '') is not null),
  is_system boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

insert into public.v2_task_categories(code,label,is_system) values
  ('weekly_clean','周清',true),
  ('monthly_clean','月清',true),
  ('inspection','巡店',true),
  ('temporary','临时任务',true)
on conflict (code) do update set label = excluded.label, is_system = true;

alter table public.v2_task_templates drop constraint if exists v2_task_templates_category_check;
alter table public.v2_task_categories enable row level security;
create policy v2_task_categories_select on public.v2_task_categories for select to authenticated using (true);
grant select on public.v2_task_categories to authenticated;

create function public.create_v2_task_category(p_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_label text := btrim(coalesce(p_label,'')); v_code text; v_row public.v2_task_categories;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required'; end if;
  if v_label = '' then raise exception '请填写任务分类名称'; end if;
  if char_length(v_label) > 30 then raise exception '任务分类名称不能超过 30 个字'; end if;
  v_code := 'custom_' || substr(replace(gen_random_uuid()::text,'-',''),1,16);
  insert into public.v2_task_categories(code,label,created_by) values(v_code,v_label,auth.uid()) returning * into v_row;
  return to_jsonb(v_row);
exception when unique_violation then raise exception '该任务分类名称已经存在';
end;
$$;

create function public.delete_v2_task_category(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.v2_task_categories;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required'; end if;
  select * into v_row from public.v2_task_categories where code=p_code for update;
  if v_row.code is null then raise exception '任务分类不存在'; end if;
  if v_row.is_system then raise exception '系统内置分类不能删除'; end if;
  if exists(select 1 from public.v2_task_templates where category=p_code) then raise exception '该分类仍被任务模板使用，暂时不能删除'; end if;
  delete from public.v2_task_categories where code=p_code;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.create_v2_task_category(text), public.delete_v2_task_category(text) from public, anon;
grant execute on function public.create_v2_task_category(text), public.delete_v2_task_category(text) to authenticated;

alter table public.v2_task_schedules
  add column publish_time time not null default '09:00',
  add column acceptance_type text not null default 'daily',
  add column acceptance_interval_days smallint default 1,
  add column acceptance_weekday smallint,
  add column acceptance_month_day smallint,
  add column last_published_at timestamptz;

update public.v2_task_schedules
set publish_time = due_time,
  acceptance_type = 'daily',
  acceptance_interval_days = 1,
  acceptance_weekday = null,
  acceptance_month_day = null
where last_published_at is null;

alter table public.v2_task_schedules add constraint v2_task_schedules_acceptance_rule_check check (
  (acceptance_type='daily' and acceptance_interval_days between 1 and 31 and acceptance_weekday is null and acceptance_month_day is null)
  or (acceptance_type='weekly' and acceptance_interval_days is null and acceptance_weekday between 1 and 7 and acceptance_month_day is null)
  or (acceptance_type='monthly' and acceptance_interval_days is null and acceptance_weekday is null and acceptance_month_day between 1 and 31)
);

create or replace function public.v2_task_schedule_next_due(p_schedule_id uuid, p_after_at timestamptz)
returns timestamptz language plpgsql security definer set search_path=public stable as $$
declare s public.v2_task_schedules%rowtype; local_after timestamp; candidate timestamp; offset_days integer; target_date date; last_day integer;
begin
  select * into s from public.v2_task_schedules where id=p_schedule_id;
  if s.id is null then raise exception 'task schedule not found'; end if;
  local_after := timezone('Asia/Shanghai',p_after_at);
  if s.schedule_type='interval_days' then
    candidate := (local_after::date + s.interval_days) + s.publish_time;
    return candidate at time zone 'Asia/Shanghai';
  elsif s.schedule_type='weekly' then
    for offset_days in 0..7 loop
      target_date := local_after::date + offset_days;
      candidate := target_date + s.publish_time;
      if extract(isodow from target_date)::smallint=any(s.weekdays) and candidate>local_after then return candidate at time zone 'Asia/Shanghai'; end if;
    end loop;
  else
    target_date := date_trunc('month',local_after)::date;
    last_day := extract(day from (target_date+interval '1 month - 1 day'))::integer;
    candidate := make_date(extract(year from target_date)::integer,extract(month from target_date)::integer,least(s.month_day,last_day))+s.publish_time;
    if candidate<=local_after then
      target_date := (target_date+interval '1 month')::date;
      last_day := extract(day from (target_date+interval '1 month - 1 day'))::integer;
      candidate := make_date(extract(year from target_date)::integer,extract(month from target_date)::integer,least(s.month_day,last_day))+s.publish_time;
    end if;
    return candidate at time zone 'Asia/Shanghai';
  end if;
  raise exception '周期发布规则无有效时间';
end;
$$;

create function public.v2_task_schedule_acceptance_due(p_schedule_id uuid,p_release_at timestamptz)
returns timestamptz language plpgsql security definer set search_path=public stable as $$
declare s public.v2_task_schedules%rowtype; local_release timestamp; candidate timestamp; offset_days integer; target_date date; last_day integer;
begin
  select * into s from public.v2_task_schedules where id=p_schedule_id;
  if s.id is null then raise exception 'task schedule not found'; end if;
  local_release:=timezone('Asia/Shanghai',p_release_at);
  if s.acceptance_type='daily' then
    candidate:=(local_release::date+coalesce(s.acceptance_interval_days,0))+s.due_time;
  elsif s.acceptance_type='weekly' then
    for offset_days in 0..7 loop
      target_date:=local_release::date+offset_days; candidate:=target_date+s.due_time;
      if extract(isodow from target_date)::smallint=s.acceptance_weekday and candidate>local_release then exit; end if;
    end loop;
  else
    target_date:=date_trunc('month',local_release)::date;
    last_day:=extract(day from (target_date+interval '1 month - 1 day'))::integer;
    candidate:=make_date(extract(year from target_date)::integer,extract(month from target_date)::integer,least(s.acceptance_month_day,last_day))+s.due_time;
    if candidate<=local_release then
      target_date:=(target_date+interval '1 month')::date;
      last_day:=extract(day from (target_date+interval '1 month - 1 day'))::integer;
      candidate:=make_date(extract(year from target_date)::integer,extract(month from target_date)::integer,least(s.acceptance_month_day,last_day))+s.due_time;
    end if;
  end if;
  return candidate at time zone 'Asia/Shanghai';
end;
$$;

create or replace function public.save_v2_task_template(p_template_id uuid,p_fields jsonb,p_store_ids uuid[],p_groups jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_template public.v2_task_templates%rowtype; v_store_id uuid; v_group jsonb; v_item jsonb; v_group_id uuid; v_item_id uuid;
  v_reference_image_path text; v_reference_image_paths text[];
  v_name text:=btrim(coalesce(p_fields->>'name','')); v_category text:=coalesce(p_fields->>'category','');
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator role required'; end if;
  if v_name='' then raise exception 'template name is required'; end if;
  if not exists(select 1 from public.v2_task_categories where code=v_category) then raise exception '请选择有效的任务分类'; end if;
  if coalesce(array_length(p_store_ids,1),0)=0 then raise exception 'at least one store is required'; end if;
  if jsonb_typeof(coalesce(p_groups,'[]'::jsonb))<>'array' then raise exception 'template groups must be an array'; end if;
  foreach v_store_id in array p_store_ids loop
    if not public.has_store_access(v_store_id) or not exists(select 1 from public.stores where id=v_store_id and is_active) then raise exception 'administrator store access required'; end if;
  end loop;
  if p_template_id is null then
    insert into public.v2_task_templates(name,category,description,requires_review,allow_overdue,recurrence,recurrence_day,due_time,status,created_by)
    values(v_name,v_category,coalesce(p_fields->>'description',''),coalesce((p_fields->>'requires_review')::boolean,true),coalesce((p_fields->>'allow_overdue')::boolean,false),'none',null,null,'draft',auth.uid()) returning * into v_template;
  else
    select * into v_template from public.v2_task_templates where id=p_template_id for update;
    if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then raise exception 'task template not found or access denied'; end if;
    if v_template.status='archived' then raise exception 'archived task template cannot be edited'; end if;
    update public.v2_task_templates set name=v_name,category=v_category,description=coalesce(p_fields->>'description',''),requires_review=coalesce((p_fields->>'requires_review')::boolean,true),allow_overdue=coalesce((p_fields->>'allow_overdue')::boolean,false),recurrence='none',recurrence_day=null,due_time=null,status='draft' where id=v_template.id returning * into v_template;
    delete from public.v2_task_template_stores where template_id=v_template.id;
    delete from public.v2_task_template_groups where template_id=v_template.id;
  end if;
  insert into public.v2_task_template_stores(template_id,store_id) select v_template.id,store_id from unnest(p_store_ids) store_id group by store_id;
  for v_group in select value from jsonb_array_elements(coalesce(p_groups,'[]'::jsonb)) loop
    if btrim(coalesce(v_group->>'title',''))='' then raise exception 'template group title is required'; end if;
    v_group_id:=coalesce(nullif(v_group->>'id','')::uuid,gen_random_uuid());
    insert into public.v2_task_template_groups(id,template_id,title,description,sort_order) values(v_group_id,v_template.id,btrim(v_group->>'title'),coalesce(v_group->>'description',''),coalesce((v_group->>'sort_order')::integer,0));
    for v_item in select value from jsonb_array_elements(coalesce(v_group->'items','[]'::jsonb)) loop
      if btrim(coalesce(v_item->>'label',''))='' then raise exception 'template item label is required'; end if;
      if coalesce(v_item->>'field_type','') not in ('instruction','short_text','long_text','integer','decimal','boolean','single_choice','multi_choice','image','multi_image','confirmation','rating') then raise exception 'invalid template item field type'; end if;
      if coalesce(v_item->>'image_requirement','none') not in ('none','single','multiple') then raise exception 'invalid image requirement'; end if;
      v_item_id:=coalesce(nullif(v_item->>'id','')::uuid,gen_random_uuid());
      v_reference_image_paths:=array(select distinct value from jsonb_array_elements_text(coalesce(v_item->'reference_image_paths','[]'::jsonb)) value order by value);
      v_reference_image_path:=nullif(v_item->>'reference_image_path','');
      if coalesce(array_length(v_reference_image_paths,1),0)=0 and v_reference_image_path is not null then v_reference_image_paths:=array[v_reference_image_path]; end if;
      if exists(select 1 from unnest(v_reference_image_paths) path where path !~ ('^'||v_template.id::text||'/'||v_item_id::text||'/')) then raise exception 'invalid reference image path'; end if;
      v_reference_image_path:=v_reference_image_paths[1];
      insert into public.v2_task_template_items(id,template_id,group_id,label,guidance,field_type,is_required,image_requirement,options,reference_image_path,reference_image_paths,sort_order)
      values(v_item_id,v_template.id,v_group_id,btrim(v_item->>'label'),coalesce(v_item->>'guidance',''),v_item->>'field_type',coalesce((v_item->>'is_required')::boolean,true),coalesce(v_item->>'image_requirement','none'),coalesce(v_item->'options','[]'::jsonb),v_reference_image_path,v_reference_image_paths,coalesce((v_item->>'sort_order')::integer,0));
    end loop;
  end loop;
  foreach v_store_id in array p_store_ids loop
    insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(v_store_id,auth.uid(),'v2_task_template_saved','v2_task_templates',v_template.id,jsonb_build_object('name',v_template.name,'category',v_template.category));
  end loop;
  return to_jsonb(v_template);
end;
$$;

create function public.create_v2_task_schedule_v2(
  p_template_id uuid,
  p_store_ids uuid[],
  p_profile_ids uuid[],
  p_fields jsonb
)
returns setof public.v2_tasks language plpgsql security definer set search_path=public as $$
declare
  v_template public.v2_task_templates%rowtype; v_version public.v2_task_template_versions%rowtype; v_profile public.profiles%rowtype;
  v_store uuid; v_schedule public.v2_task_schedules%rowtype; v_task public.v2_tasks%rowtype;
  v_release_type text:=coalesce(p_fields->>'scheduleType',''); v_interval smallint:=nullif(p_fields->>'intervalDays','')::smallint;
  v_weekdays smallint[]:=coalesce(array(select value::smallint from jsonb_array_elements_text(coalesce(p_fields->'weekdays','[]'::jsonb)) value),'{}');
  v_month_day smallint:=nullif(p_fields->>'monthDay','')::smallint; v_publish_time time:=nullif(p_fields->>'publishTime','')::time;
  v_acceptance_type text:=coalesce(p_fields->>'acceptanceType',''); v_acceptance_days smallint:=nullif(p_fields->>'acceptanceIntervalDays','')::smallint;
  v_acceptance_weekday smallint:=nullif(p_fields->>'acceptanceWeekday','')::smallint; v_acceptance_month_day smallint:=nullif(p_fields->>'acceptanceMonthDay','')::smallint;
  v_acceptance_time time:=nullif(p_fields->>'acceptanceTime','')::time; v_now timestamptz:=now(); v_first_due timestamptz; v_next_release timestamptz;
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator role required'; end if;
  select * into v_template from public.v2_task_templates where id=p_template_id and status='published';
  if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then raise exception 'published template required'; end if;
  if v_publish_time is null or v_acceptance_time is null then raise exception '请设置发布和验收时间'; end if;
  if not ((v_release_type='interval_days' and v_interval between 1 and 31 and cardinality(v_weekdays)=0 and v_month_day is null)
    or (v_release_type='weekly' and v_interval is null and cardinality(v_weekdays) between 1 and 7 and v_month_day is null and not exists(select 1 from unnest(v_weekdays) day where day not between 1 and 7))
    or (v_release_type='monthly' and v_interval is null and cardinality(v_weekdays)=0 and v_month_day between 1 and 31)) then raise exception '请完善发布周期'; end if;
  if not ((v_acceptance_type='daily' and v_acceptance_days between 1 and 31 and v_acceptance_weekday is null and v_acceptance_month_day is null)
    or (v_acceptance_type='weekly' and v_acceptance_days is null and v_acceptance_weekday between 1 and 7 and v_acceptance_month_day is null)
    or (v_acceptance_type='monthly' and v_acceptance_days is null and v_acceptance_weekday is null and v_acceptance_month_day between 1 and 31)) then raise exception '请完善验收周期'; end if;
  select * into v_version from public.v2_task_template_versions where template_id=v_template.id and version_number=v_template.current_version;

  for v_profile in select distinct profile.* from public.profiles profile where coalesce(cardinality(p_profile_ids),0)>0 and profile.id=any(p_profile_ids) loop
    if not v_profile.is_active or v_profile.deleted_at is not null or v_profile.role not in ('staff','manager') or v_profile.store_id<>all(p_store_ids) or not public.has_store_access(v_profile.store_id) or not exists(select 1 from public.v2_task_template_stores where template_id=v_template.id and store_id=v_profile.store_id) then raise exception 'task recipient access denied'; end if;
    insert into public.v2_task_schedules(template_id,template_version_id,store_id,assigned_profile_id,schedule_type,interval_days,weekdays,month_day,publish_time,due_time,acceptance_type,acceptance_interval_days,acceptance_weekday,acceptance_month_day,next_due_at,last_published_at,created_by)
    values(v_template.id,v_version.id,v_profile.store_id,v_profile.id,v_release_type,case when v_release_type='interval_days' then v_interval end,case when v_release_type='weekly' then v_weekdays else '{}' end,case when v_release_type='monthly' then v_month_day end,v_publish_time,v_acceptance_time,v_acceptance_type,case when v_acceptance_type='daily' then v_acceptance_days end,case when v_acceptance_type='weekly' then v_acceptance_weekday end,case when v_acceptance_type='monthly' then v_acceptance_month_day end,v_now,v_now,auth.uid()) returning * into v_schedule;
    v_first_due:=public.v2_task_schedule_acceptance_due(v_schedule.id,v_now); v_next_release:=public.v2_task_schedule_next_due(v_schedule.id,v_now);
    if v_first_due<=v_now then raise exception '验收时间必须晚于立即发布时间'; end if;
    if v_first_due>=v_next_release then raise exception '验收截止时间必须早于下一次发布时间，请调整发布或验收周期'; end if;
    update public.v2_task_schedules set next_due_at=v_next_release where id=v_schedule.id;
    select * into v_task from public.create_v2_task_from_schedule(v_schedule.id,v_first_due); return next v_task;
  end loop;
  if coalesce(cardinality(p_profile_ids),0)>0 then return; end if;

  foreach v_store in array p_store_ids loop
    if not public.has_store_access(v_store) or not exists(select 1 from public.v2_task_template_stores where template_id=v_template.id and store_id=v_store) then raise exception 'template store access denied'; end if;
    insert into public.v2_task_schedules(template_id,template_version_id,store_id,schedule_type,interval_days,weekdays,month_day,publish_time,due_time,acceptance_type,acceptance_interval_days,acceptance_weekday,acceptance_month_day,next_due_at,last_published_at,created_by)
    values(v_template.id,v_version.id,v_store,v_release_type,case when v_release_type='interval_days' then v_interval end,case when v_release_type='weekly' then v_weekdays else '{}' end,case when v_release_type='monthly' then v_month_day end,v_publish_time,v_acceptance_time,v_acceptance_type,case when v_acceptance_type='daily' then v_acceptance_days end,case when v_acceptance_type='weekly' then v_acceptance_weekday end,case when v_acceptance_type='monthly' then v_acceptance_month_day end,v_now,v_now,auth.uid()) returning * into v_schedule;
    v_first_due:=public.v2_task_schedule_acceptance_due(v_schedule.id,v_now); v_next_release:=public.v2_task_schedule_next_due(v_schedule.id,v_now);
    if v_first_due<=v_now then raise exception '验收时间必须晚于立即发布时间'; end if;
    if v_first_due>=v_next_release then raise exception '验收截止时间必须早于下一次发布时间，请调整发布或验收周期'; end if;
    update public.v2_task_schedules set next_due_at=v_next_release where id=v_schedule.id;
    select * into v_task from public.create_v2_task_from_schedule(v_schedule.id,v_first_due); return next v_task;
  end loop;
end;
$$;

create function public.update_v2_task_schedule_v2(p_schedule_id uuid,p_fields jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  s public.v2_task_schedules%rowtype; v_now timestamptz:=now(); v_due timestamptz; v_next timestamptz; v_following timestamptz;
  v_release_type text:=coalesce(p_fields->>'scheduleType',''); v_interval smallint:=nullif(p_fields->>'intervalDays','')::smallint;
  v_weekdays smallint[]:=coalesce(array(select value::smallint from jsonb_array_elements_text(coalesce(p_fields->'weekdays','[]'::jsonb)) value),'{}');
  v_month_day smallint:=nullif(p_fields->>'monthDay','')::smallint; v_publish_time time:=nullif(p_fields->>'publishTime','')::time;
  v_acceptance_type text:=coalesce(p_fields->>'acceptanceType',''); v_acceptance_days smallint:=nullif(p_fields->>'acceptanceIntervalDays','')::smallint;
  v_acceptance_weekday smallint:=nullif(p_fields->>'acceptanceWeekday','')::smallint; v_acceptance_month_day smallint:=nullif(p_fields->>'acceptanceMonthDay','')::smallint;
  v_acceptance_time time:=nullif(p_fields->>'acceptanceTime','')::time;
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator role required'; end if;
  select * into s from public.v2_task_schedules where id=p_schedule_id for update;
  if s.id is null or not public.has_store_access(s.store_id) then raise exception 'schedule access denied'; end if;
  if v_publish_time is null or v_acceptance_time is null then raise exception '请设置发布和验收时间'; end if;
  if not ((v_release_type='interval_days' and v_interval between 1 and 31 and cardinality(v_weekdays)=0 and v_month_day is null)
    or (v_release_type='weekly' and v_interval is null and cardinality(v_weekdays) between 1 and 7 and v_month_day is null)
    or (v_release_type='monthly' and v_interval is null and cardinality(v_weekdays)=0 and v_month_day between 1 and 31)) then raise exception '请完善发布周期'; end if;
  if not ((v_acceptance_type='daily' and v_acceptance_days between 1 and 31 and v_acceptance_weekday is null and v_acceptance_month_day is null)
    or (v_acceptance_type='weekly' and v_acceptance_days is null and v_acceptance_weekday between 1 and 7 and v_acceptance_month_day is null)
    or (v_acceptance_type='monthly' and v_acceptance_days is null and v_acceptance_weekday is null and v_acceptance_month_day between 1 and 31)) then raise exception '请完善验收周期'; end if;
  update public.v2_task_schedules set schedule_type=v_release_type,interval_days=case when v_release_type='interval_days' then v_interval end,weekdays=case when v_release_type='weekly' then v_weekdays else '{}' end,month_day=case when v_release_type='monthly' then v_month_day end,publish_time=v_publish_time,due_time=v_acceptance_time,acceptance_type=v_acceptance_type,acceptance_interval_days=case when v_acceptance_type='daily' then v_acceptance_days end,acceptance_weekday=case when v_acceptance_type='weekly' then v_acceptance_weekday end,acceptance_month_day=case when v_acceptance_type='monthly' then v_acceptance_month_day end where id=s.id returning * into s;
  v_due:=public.v2_task_schedule_acceptance_due(s.id,v_now); v_next:=public.v2_task_schedule_next_due(s.id,v_now); v_following:=public.v2_task_schedule_next_due(s.id,v_next);
  if v_due<=v_now then raise exception '验收时间必须晚于当前时间'; end if;
  if v_due>=v_next then raise exception '验收截止时间必须早于下一次发布时间，请调整发布或验收周期'; end if;
  if public.v2_task_schedule_acceptance_due(s.id,v_next)>=v_following then raise exception '后续验收截止时间会晚于下一次发布时间，请调整周期'; end if;
  update public.v2_task_schedules set next_due_at=v_next where id=s.id returning * into s;
  update public.v2_tasks set due_at=v_due,version=version+1 where schedule_id=s.id and status in ('pending','in_progress','rejected','overdue');
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(s.store_id,auth.uid(),'v2_task_schedule_updated','v2_task_schedules',s.id,p_fields);
  return to_jsonb(s);
end;
$$;

create function public.withdraw_v2_task_schedule_current(p_schedule_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.v2_task_schedules%rowtype; v_count integer;
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator role required'; end if;
  select * into s from public.v2_task_schedules where id=p_schedule_id for update;
  if s.id is null or not public.has_store_access(s.store_id) then raise exception 'schedule access denied'; end if;
  update public.v2_tasks set status='cancelled',version=version+1 where schedule_id=s.id and status in ('pending','in_progress','rejected','overdue');
  get diagnostics v_count=row_count;
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(s.store_id,auth.uid(),'v2_task_schedule_current_withdrawn','v2_task_schedules',s.id,jsonb_build_object('cancelled_tasks',v_count));
  return jsonb_build_object('cancelledTasks',v_count,'scheduleId',s.id);
end;
$$;

create or replace function public.dispatch_v2_task_schedules()
returns integer language plpgsql security definer set search_path=public as $$
declare s public.v2_task_schedules%rowtype; v_release timestamptz; v_due timestamptz; v_next timestamptz; v_created integer:=0;
begin
  for s in select * from public.v2_task_schedules where is_active and next_due_at<=now() for update skip locked loop
    v_release:=s.next_due_at; v_due:=public.v2_task_schedule_acceptance_due(s.id,v_release);
    while v_due<=now() loop v_release:=public.v2_task_schedule_next_due(s.id,v_release); v_due:=public.v2_task_schedule_acceptance_due(s.id,v_release); end loop;
    v_next:=public.v2_task_schedule_next_due(s.id,v_release);
    if v_due>=v_next then
      update public.v2_task_schedules set is_active=false,paused_at=now() where id=s.id;
      continue;
    end if;
    perform public.create_v2_task_from_schedule(s.id,v_due);
    update public.v2_task_schedules set next_due_at=v_next,last_published_at=v_release where id=s.id;
    v_created:=v_created+1;
  end loop;
  return v_created;
end;
$$;

create or replace function public.resume_v2_task_schedule(p_schedule_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.v2_task_schedules%rowtype; v_now timestamptz:=now(); v_due timestamptz; v_next timestamptz; v_task public.v2_tasks%rowtype;
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator role required'; end if;
  select * into s from public.v2_task_schedules where id=p_schedule_id for update;
  if s.id is null or not public.has_store_access(s.store_id) then raise exception 'schedule access denied'; end if;
  if s.is_active then return to_jsonb(s); end if;
  v_due:=public.v2_task_schedule_acceptance_due(s.id,v_now); v_next:=public.v2_task_schedule_next_due(s.id,v_now);
  if v_due<=v_now or v_due>=v_next then raise exception '当前周期设置无法生成有效验收时间，请先编辑周期'; end if;
  update public.v2_task_schedules set is_active=true,paused_at=null,paused_by=null,next_due_at=v_next,last_published_at=v_now where id=s.id returning * into s;
  select * into v_task from public.create_v2_task_from_schedule(s.id,v_due);
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(s.store_id,auth.uid(),'v2_task_schedule_resumed','v2_task_schedules',s.id,jsonb_build_object('replacement_task_id',v_task.id,'next_publish_at',v_next));
  return to_jsonb(s);
end;
$$;

revoke all on function public.v2_task_schedule_next_due(uuid,timestamptz), public.v2_task_schedule_acceptance_due(uuid,timestamptz), public.create_v2_task_schedule_v2(uuid,uuid[],uuid[],jsonb), public.update_v2_task_schedule_v2(uuid,jsonb), public.withdraw_v2_task_schedule_current(uuid), public.dispatch_v2_task_schedules(), public.resume_v2_task_schedule(uuid) from public, anon;
grant execute on function public.create_v2_task_schedule_v2(uuid,uuid[],uuid[],jsonb), public.update_v2_task_schedule_v2(uuid,jsonb), public.withdraw_v2_task_schedule_current(uuid), public.resume_v2_task_schedule(uuid) to authenticated;
