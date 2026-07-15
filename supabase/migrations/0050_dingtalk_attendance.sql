-- StoreHub DingTalk attendance integration. Third-party credentials remain in
-- Edge Function secrets; Postgres stores only directory snapshots, confirmed
-- bindings and normalized attendance facts.

create table public.dingtalk_employee_directory (
  id uuid primary key default gen_random_uuid(),
  corp_id text not null,
  dingtalk_user_id text not null,
  union_id text,
  display_name text not null,
  mobile_masked text,
  job_number text,
  department_ids text[] not null default '{}',
  is_active boolean not null default true,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (corp_id, dingtalk_user_id),
  check (length(trim(corp_id)) > 0 and length(trim(dingtalk_user_id)) > 0 and length(trim(display_name)) > 0)
);

create table public.dingtalk_employee_bindings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  directory_user_id uuid not null references public.dingtalk_employee_directory(id) on delete restrict,
  corp_id text not null,
  dingtalk_user_id text not null,
  union_id text,
  binding_status text not null default 'active' check (binding_status in ('active', 'inactive', 'error')),
  match_source text not null default 'manual' check (match_source in ('manual', 'name_suggestion', 'imported')),
  last_verified_at timestamptz,
  error_message text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(corp_id)) > 0 and length(trim(dingtalk_user_id)) > 0)
);

create unique index dingtalk_employee_bindings_active_profile_idx
on public.dingtalk_employee_bindings (profile_id)
where binding_status = 'active';

create unique index dingtalk_employee_bindings_active_user_idx
on public.dingtalk_employee_bindings (corp_id, dingtalk_user_id)
where binding_status = 'active';

create index dingtalk_employee_bindings_directory_idx
on public.dingtalk_employee_bindings (directory_user_id, binding_status);

create table public.attendance_daily_records (
  id uuid primary key default gen_random_uuid(),
  corp_id text not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  attendance_date date not null,
  enterprise_timezone text not null default 'Asia/Shanghai',
  shift_id text,
  shift_name text,
  planned_on_at timestamptz,
  planned_off_at timestamptz,
  actual_on_at timestamptz,
  actual_off_at timestamptz,
  on_duty_result text not null default 'unknown' check (on_duty_result in ('normal', 'late', 'early', 'missing', 'rest', 'leave', 'business_trip', 'fieldwork', 'abnormal', 'unknown')),
  off_duty_result text not null default 'unknown' check (off_duty_result in ('normal', 'late', 'early', 'missing', 'rest', 'leave', 'business_trip', 'fieldwork', 'abnormal', 'unknown')),
  daily_status text not null default 'abnormal' check (daily_status in ('normal', 'late', 'early', 'missing', 'rest', 'leave', 'business_trip', 'fieldwork', 'abnormal')),
  is_attended boolean not null default false,
  late_minutes integer not null default 0 check (late_minutes >= 0),
  early_minutes integer not null default 0 check (early_minutes >= 0),
  missing_punch text not null default 'none' check (missing_punch in ('none', 'on', 'off', 'both')),
  exception_note text,
  dingtalk_result_ids text[] not null default '{}',
  data_source text not null default 'dingtalk' check (data_source = 'dingtalk'),
  source_updated_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (corp_id, profile_id, attendance_date),
  check (length(trim(corp_id)) > 0 and length(trim(enterprise_timezone)) > 0)
);

create index attendance_daily_records_store_month_idx
on public.attendance_daily_records (store_id, attendance_date desc, profile_id);

create index attendance_daily_records_profile_month_idx
on public.attendance_daily_records (profile_id, attendance_date desc);

create index attendance_daily_records_status_idx
on public.attendance_daily_records (store_id, daily_status, attendance_date desc);

create table public.attendance_punch_records (
  id uuid primary key default gen_random_uuid(),
  daily_record_id uuid not null references public.attendance_daily_records(id) on delete cascade,
  corp_id text not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  dingtalk_record_id text not null,
  punch_time timestamptz not null,
  check_type text not null default 'unknown' check (check_type in ('on_duty', 'off_duty', 'unknown')),
  source_type text,
  time_result text,
  location_result text,
  location_name text,
  is_approved_correction boolean not null default false,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (corp_id, dingtalk_record_id),
  check (length(trim(corp_id)) > 0 and length(trim(dingtalk_record_id)) > 0)
);

create index attendance_punch_records_daily_idx
on public.attendance_punch_records (daily_record_id, punch_time);

create table public.attendance_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  corp_id text not null,
  sync_type text not null check (sync_type in ('directory', 'current_month', 'month', 'date_range', 'employee')),
  scope_type text not null check (scope_type in ('organization', 'store', 'employee')),
  month_start date,
  range_start date,
  range_end date,
  store_id uuid references public.stores(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  trigger_type text not null check (trigger_type in ('manual', 'scheduled', 'retry')),
  initiated_by uuid references public.profiles(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'partial', 'failed')),
  progress_cursor jsonb not null default '{}'::jsonb,
  success_count integer not null default 0 check (success_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  error_summary text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (range_start is null or range_end is null or range_start <= range_end),
  check (length(trim(corp_id)) > 0)
);

create index attendance_sync_jobs_status_idx
on public.attendance_sync_jobs (status, created_at desc);

create index attendance_sync_jobs_scope_idx
on public.attendance_sync_jobs (store_id, profile_id, created_at desc);

create table public.attendance_sync_failures (
  id uuid primary key default gen_random_uuid(),
  sync_job_id uuid not null references public.attendance_sync_jobs(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  dingtalk_user_id text,
  stage text not null check (stage in ('directory', 'schedule', 'result', 'punch', 'normalize', 'persist')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  error_code text,
  error_message text not null,
  retryable boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index attendance_sync_failures_job_idx
on public.attendance_sync_failures (sync_job_id, resolved_at, created_at);

create table public.attendance_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('binding_created', 'binding_removed', 'binding_replaced', 'sync_requested', 'sync_retried')),
  entity_type text not null check (entity_type in ('binding', 'sync_job')),
  entity_id uuid not null,
  store_id uuid references public.stores(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index attendance_audit_logs_store_idx
on public.attendance_audit_logs (store_id, created_at desc);

create trigger dingtalk_employee_directory_touch_updated_at before update on public.dingtalk_employee_directory for each row execute function public.touch_updated_at();
create trigger dingtalk_employee_bindings_touch_updated_at before update on public.dingtalk_employee_bindings for each row execute function public.touch_updated_at();
create trigger attendance_daily_records_touch_updated_at before update on public.attendance_daily_records for each row execute function public.touch_updated_at();
create trigger attendance_punch_records_touch_updated_at before update on public.attendance_punch_records for each row execute function public.touch_updated_at();
create trigger attendance_sync_jobs_touch_updated_at before update on public.attendance_sync_jobs for each row execute function public.touch_updated_at();

create or replace function public.can_admin_read_attendance_store(target_store_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.current_user_role() = 'admin' and public.has_store_access(target_store_id)
$$;

create or replace function public.can_admin_manage_attendance_profile(target_profile_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.current_user_role() = 'admin' and exists (
    select 1
    from public.profile_store_access target_access
    where target_access.profile_id = target_profile_id
      and public.has_store_access(target_access.store_id)
  )
$$;

alter table public.dingtalk_employee_directory enable row level security;
alter table public.dingtalk_employee_bindings enable row level security;
alter table public.attendance_daily_records enable row level security;
alter table public.attendance_punch_records enable row level security;
alter table public.attendance_sync_jobs enable row level security;
alter table public.attendance_sync_failures enable row level security;
alter table public.attendance_audit_logs enable row level security;

create policy dingtalk_employee_directory_select_admin on public.dingtalk_employee_directory for select to authenticated using (public.current_user_role() = 'admin');
create policy dingtalk_employee_bindings_select_allowed on public.dingtalk_employee_bindings for select to authenticated using (profile_id = auth.uid() or public.can_admin_manage_attendance_profile(profile_id));
create policy attendance_daily_records_select_allowed on public.attendance_daily_records for select to authenticated using (profile_id = auth.uid() or public.can_admin_read_attendance_store(store_id));
create policy attendance_punch_records_select_allowed on public.attendance_punch_records for select to authenticated using (profile_id = auth.uid() or public.can_admin_read_attendance_store(store_id));
create policy attendance_sync_jobs_select_admin on public.attendance_sync_jobs for select to authenticated using (
  public.current_user_role() = 'admin'
  and (store_id is null or public.has_store_access(store_id))
  and (profile_id is null or public.can_admin_manage_attendance_profile(profile_id))
);
create policy attendance_sync_failures_select_admin on public.attendance_sync_failures for select to authenticated using (
  exists (select 1 from public.attendance_sync_jobs job where job.id = sync_job_id)
);
create policy attendance_audit_logs_select_admin on public.attendance_audit_logs for select to authenticated using (
  public.current_user_role() = 'admin' and (store_id is null or public.has_store_access(store_id))
);

revoke all on public.dingtalk_employee_directory, public.dingtalk_employee_bindings, public.attendance_daily_records,
  public.attendance_punch_records, public.attendance_sync_jobs, public.attendance_sync_failures, public.attendance_audit_logs
from anon, authenticated;
grant select on public.dingtalk_employee_directory, public.dingtalk_employee_bindings, public.attendance_daily_records,
  public.attendance_punch_records, public.attendance_sync_jobs, public.attendance_sync_failures, public.attendance_audit_logs
to authenticated;

create view public.attendance_monthly_summary
with (security_invoker = true)
as
select
  profile_id,
  store_id,
  date_trunc('month', attendance_date)::date as month_start,
  array_agg(distinct attendance_date order by attendance_date) filter (where is_attended) as attendance_dates,
  count(distinct attendance_date) filter (where is_attended)::integer as attendance_days,
  count(*) filter (where on_duty_result = 'late' or daily_status = 'late')::integer as late_count,
  coalesce(sum(late_minutes), 0)::integer as late_minutes,
  count(*) filter (where missing_punch <> 'none' or daily_status = 'missing')::integer as missing_count,
  count(*) filter (where daily_status = 'abnormal')::integer as abnormal_count,
  max(last_synced_at) as last_synced_at
from public.attendance_daily_records
group by profile_id, store_id, date_trunc('month', attendance_date)::date;

revoke all on public.attendance_monthly_summary from anon;
grant select on public.attendance_monthly_summary to authenticated;

create or replace function public.get_attendance_month_detail(p_profile_id uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_result jsonb;
begin
  if p_profile_id <> auth.uid() and not public.can_admin_manage_attendance_profile(p_profile_id) then
    raise exception 'attendance access denied';
  end if;

  select jsonb_build_object(
    'summary', jsonb_build_object(
      'attendanceDates', coalesce(to_jsonb(summary.attendance_dates), '[]'::jsonb),
      'attendanceDays', coalesce(summary.attendance_days, 0),
      'lateCount', coalesce(summary.late_count, 0),
      'lateMinutes', coalesce(summary.late_minutes, 0),
      'missingCount', coalesce(summary.missing_count, 0),
      'abnormalCount', coalesce(summary.abnormal_count, 0),
      'lastSyncedAt', summary.last_synced_at
    ),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', daily.id,
        'date', daily.attendance_date,
        'timezone', daily.enterprise_timezone,
        'shiftId', daily.shift_id,
        'shiftName', daily.shift_name,
        'plannedOnAt', daily.planned_on_at,
        'plannedOffAt', daily.planned_off_at,
        'actualOnAt', daily.actual_on_at,
        'actualOffAt', daily.actual_off_at,
        'onDutyResult', daily.on_duty_result,
        'offDutyResult', daily.off_duty_result,
        'status', daily.daily_status,
        'isAttended', daily.is_attended,
        'lateMinutes', daily.late_minutes,
        'earlyMinutes', daily.early_minutes,
        'missingPunch', daily.missing_punch,
        'exceptionNote', daily.exception_note,
        'lastSyncedAt', daily.last_synced_at,
        'punches', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', punch.id,
            'time', punch.punch_time,
            'checkType', punch.check_type,
            'timeResult', punch.time_result,
            'locationResult', punch.location_result,
            'locationName', punch.location_name,
            'isApprovedCorrection', punch.is_approved_correction
          ) order by punch.punch_time)
          from public.attendance_punch_records punch
          where punch.daily_record_id = daily.id
        ), '[]'::jsonb)
      ) order by daily.attendance_date desc)
      from public.attendance_daily_records daily
      where daily.profile_id = p_profile_id
        and daily.attendance_date >= v_month
        and daily.attendance_date < (v_month + interval '1 month')::date
    ), '[]'::jsonb)
  ) into v_result
  from (
    select * from public.attendance_monthly_summary
    where profile_id = p_profile_id and month_start = v_month
    limit 1
  ) summary;

  if v_result is null then
    v_result := jsonb_build_object(
      'summary', jsonb_build_object('attendanceDates','[]'::jsonb,'attendanceDays',0,'lateCount',0,'lateMinutes',0,'missingCount',0,'abnormalCount',0,'lastSyncedAt',null),
      'days', '[]'::jsonb
    );
  end if;
  return v_result;
end;
$$;

create or replace function public.admin_attendance_month(
  p_month date,
  p_store_id uuid default null,
  p_search text default '',
  p_status text default 'all',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_result jsonb;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator permission required'; end if;
  if p_store_id is not null and not public.has_store_access(p_store_id) then raise exception 'store access denied'; end if;
  if p_status not in ('all','normal','late','missing','abnormal','unbound') then raise exception 'invalid attendance status filter'; end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 then raise exception 'invalid pagination'; end if;

  with targets as (
    select distinct profile.id, profile.display_name, access.store_id, store.name as store_name
    from public.profiles profile
    join public.profile_store_access access on access.profile_id = profile.id
    join public.stores store on store.id = access.store_id
    where profile.role in ('staff','manager') and profile.is_active and profile.deleted_at is null
      and public.has_store_access(access.store_id)
      and (p_store_id is null or access.store_id = p_store_id)
      and (trim(coalesce(p_search,'')) = '' or profile.display_name ilike '%'||trim(p_search)||'%' or profile.username ilike '%'||trim(p_search)||'%')
  ), rows as (
    select target.*, summary.attendance_dates, coalesce(summary.attendance_days,0) attendance_days,
      coalesce(summary.late_count,0) late_count, coalesce(summary.late_minutes,0) late_minutes,
      coalesce(summary.missing_count,0) missing_count, coalesce(summary.abnormal_count,0) abnormal_count,
      summary.last_synced_at,
      case when binding.id is null then 'unbound' else binding.binding_status end as binding_status
    from targets target
    left join public.attendance_monthly_summary summary on summary.profile_id=target.id and summary.store_id=target.store_id and summary.month_start=v_month
    left join public.dingtalk_employee_bindings binding on binding.profile_id=target.id and binding.binding_status='active'
  ), filtered as (
    select * from rows where
      p_status='all'
      or (p_status='normal' and binding_status='active' and late_count=0 and missing_count=0 and abnormal_count=0)
      or (p_status='late' and late_count>0)
      or (p_status='missing' and missing_count>0)
      or (p_status='abnormal' and abnormal_count>0)
      or (p_status='unbound' and binding_status='unbound')
  ), paged as (
    select * from filtered order by store_name, display_name limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'profileId', id, 'displayName', display_name, 'storeId', store_id, 'storeName', store_name,
      'attendanceDates', coalesce(to_jsonb(attendance_dates),'[]'::jsonb), 'attendanceDays', attendance_days,
      'lateCount', late_count, 'lateMinutes', late_minutes, 'missingCount', missing_count,
      'abnormalCount', abnormal_count, 'bindingStatus', binding_status, 'lastSyncedAt', last_synced_at
    ) order by store_name, display_name) from paged), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_bind_dingtalk_employee(
  p_profile_id uuid,
  p_directory_user_id uuid,
  p_match_source text default 'manual'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_directory public.dingtalk_employee_directory%rowtype; v_binding public.dingtalk_employee_bindings%rowtype; v_action text;
begin
  if not public.can_admin_manage_attendance_profile(p_profile_id) then raise exception 'administrator profile access required'; end if;
  if p_match_source not in ('manual','name_suggestion','imported') then raise exception 'invalid match source'; end if;
  select * into v_directory from public.dingtalk_employee_directory where id=p_directory_user_id and is_active;
  if not found then raise exception 'DingTalk employee not found or inactive'; end if;
  if exists(select 1 from public.dingtalk_employee_bindings where profile_id=p_profile_id and binding_status='active') then raise exception 'StoreHub profile already has an active DingTalk binding'; end if;
  if exists(select 1 from public.dingtalk_employee_bindings where corp_id=v_directory.corp_id and dingtalk_user_id=v_directory.dingtalk_user_id and binding_status='active') then raise exception 'DingTalk employee is already bound'; end if;
  v_action := case when exists(select 1 from public.dingtalk_employee_bindings where profile_id=p_profile_id) then 'binding_replaced' else 'binding_created' end;
  insert into public.dingtalk_employee_bindings(profile_id,directory_user_id,corp_id,dingtalk_user_id,union_id,binding_status,match_source,last_verified_at,created_by)
  values(p_profile_id,v_directory.id,v_directory.corp_id,v_directory.dingtalk_user_id,v_directory.union_id,'active',p_match_source,now(),auth.uid()) returning * into v_binding;
  insert into public.attendance_audit_logs(actor_id,action,entity_type,entity_id,store_id,metadata)
  select auth.uid(),v_action,'binding',v_binding.id,profile.store_id,jsonb_build_object('profileId',p_profile_id,'source',p_match_source)
  from public.profiles profile where profile.id=p_profile_id;
  return to_jsonb(v_binding);
end;
$$;

create or replace function public.admin_unbind_dingtalk_employee(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_binding public.dingtalk_employee_bindings%rowtype;
begin
  if not public.can_admin_manage_attendance_profile(p_profile_id) then raise exception 'administrator profile access required'; end if;
  update public.dingtalk_employee_bindings set binding_status='inactive',last_verified_at=now(),error_message=null
  where profile_id=p_profile_id and binding_status='active' returning * into v_binding;
  if not found then raise exception 'active DingTalk binding not found'; end if;
  insert into public.attendance_audit_logs(actor_id,action,entity_type,entity_id,store_id,metadata)
  select auth.uid(),'binding_removed','binding',v_binding.id,profile.store_id,jsonb_build_object('profileId',p_profile_id)
  from public.profiles profile where profile.id=p_profile_id;
  return to_jsonb(v_binding);
end;
$$;

revoke all on function public.can_admin_read_attendance_store(uuid), public.can_admin_manage_attendance_profile(uuid),
  public.get_attendance_month_detail(uuid,date), public.admin_attendance_month(date,uuid,text,text,integer,integer),
  public.admin_bind_dingtalk_employee(uuid,uuid,text), public.admin_unbind_dingtalk_employee(uuid) from public;
grant execute on function public.get_attendance_month_detail(uuid,date), public.admin_attendance_month(date,uuid,text,text,integer,integer),
  public.admin_bind_dingtalk_employee(uuid,uuid,text), public.admin_unbind_dingtalk_employee(uuid) to authenticated;

