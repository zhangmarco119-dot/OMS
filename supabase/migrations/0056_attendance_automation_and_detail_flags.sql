-- Hourly DingTalk attendance automation, queued historical backfill, and richer day flags.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table public.attendance_sync_jobs drop constraint if exists attendance_sync_jobs_sync_type_check;
alter table public.attendance_sync_jobs add constraint attendance_sync_jobs_sync_type_check
  check (sync_type in ('directory', 'current_month', 'month', 'date_range', 'employee', 'history_month'));

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.attendance_automation_config (
  singleton boolean primary key default true check (singleton),
  function_url text not null,
  cron_token text not null,
  enabled boolean not null default true,
  configured_by uuid references public.profiles(id) on delete set null,
  configured_at timestamptz not null default now()
);
revoke all on private.attendance_automation_config from public, anon, authenticated;

create or replace function public.verify_attendance_cron_token(p_token text)
returns boolean language sql security definer set search_path = public, private stable as $$
  select exists(
    select 1 from private.attendance_automation_config
    where singleton and enabled and cron_token = coalesce(p_token, '')
  );
$$;
revoke all on function public.verify_attendance_cron_token(text) from public, anon, authenticated;
grant execute on function public.verify_attendance_cron_token(text) to service_role;

create or replace function private.dispatch_attendance_automation(p_mode text)
returns bigint language plpgsql security definer set search_path = public, private, extensions as $$
declare v_config private.attendance_automation_config%rowtype; v_request_id bigint;
begin
  select * into v_config from private.attendance_automation_config where singleton and enabled;
  if not found then return null; end if;
  select net.http_post(
    url := v_config.function_url,
    headers := jsonb_build_object('Content-Type','application/json','x-storehub-cron-secret',v_config.cron_token),
    body := jsonb_build_object('action','scheduled-sync','mode',p_mode),
    timeout_milliseconds := 25000
  ) into v_request_id;
  return v_request_id;
end;
$$;
revoke all on function private.dispatch_attendance_automation(text) from public, anon, authenticated;

create or replace function public.configure_attendance_automation()
returns jsonb language plpgsql security definer set search_path = public, private, cron as $$
declare v_issuer text; v_url text; v_token text; v_enabled boolean;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  v_issuer := coalesce(auth.jwt()->>'iss','');
  if v_issuer !~ '^https://[a-z0-9-]+\.supabase\.co/auth/v1/?$' then
    raise exception 'unable to determine Supabase project URL' using errcode = '22023';
  end if;
  v_url := regexp_replace(v_issuer, '/auth/v1/?$', '/functions/v1/dingtalk-attendance');
  select cron_token into v_token from private.attendance_automation_config where singleton;
  v_token := coalesce(v_token, gen_random_uuid()::text || gen_random_uuid()::text);
  insert into private.attendance_automation_config(singleton,function_url,cron_token,enabled,configured_by,configured_at)
  values(true,v_url,v_token,true,auth.uid(),now())
  on conflict(singleton) do update set function_url=excluded.function_url, enabled=true, configured_by=auth.uid(), configured_at=now();

  perform cron.unschedule('storehub-attendance-hourly') where exists(select 1 from cron.job where jobname='storehub-attendance-hourly');
  perform cron.unschedule('storehub-attendance-history-queue') where exists(select 1 from cron.job where jobname='storehub-attendance-history-queue');
  perform cron.schedule('storehub-attendance-hourly','5 * * * *', $cron$select private.dispatch_attendance_automation('hourly');$cron$);
  perform cron.schedule('storehub-attendance-history-queue','*/10 * * * *', $cron$select private.dispatch_attendance_automation('history-queue');$cron$);
  select enabled into v_enabled from private.attendance_automation_config where singleton;
  return jsonb_build_object('enabled',v_enabled,'hourly',true,'historyQueue',true,'configuredAt',now());
end;
$$;
revoke all on function public.configure_attendance_automation() from public, anon;
grant execute on function public.configure_attendance_automation() to authenticated;

create or replace function public.claim_attendance_history_sync_job()
returns public.attendance_sync_jobs language plpgsql security definer set search_path = public as $$
declare v_job public.attendance_sync_jobs%rowtype;
begin
  update public.attendance_sync_jobs set status='queued', started_at=null
  where sync_type='history_month' and status='running' and started_at < now()-interval '90 minutes';
  select * into v_job from public.attendance_sync_jobs
  where sync_type='history_month' and status='queued'
  order by range_start, created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.attendance_sync_jobs set status='running', started_at=now(), updated_at=now()
  where id=v_job.id returning * into v_job;
  return v_job;
end;
$$;
revoke all on function public.claim_attendance_history_sync_job() from public, anon, authenticated;
grant execute on function public.claim_attendance_history_sync_job() to service_role;

create index if not exists attendance_history_queue_idx
on public.attendance_sync_jobs(status, range_start, created_at) where sync_type='history_month';

create or replace function public.get_attendance_month_detail(p_profile_id uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_month date := date_trunc('month',p_month)::date; v_result jsonb;
begin
  if p_profile_id<>auth.uid() and not public.can_admin_manage_attendance_profile(p_profile_id) then raise exception 'attendance access denied'; end if;
  with scoped_days as (
    select daily.*, coalesce(enterprise.display_name,'钉钉企业') enterprise_name, store.name store_name
    from public.attendance_daily_records daily
    left join public.dingtalk_enterprises enterprise on enterprise.corp_id=daily.corp_id
    join public.stores store on store.id=daily.store_id
    where daily.profile_id=p_profile_id and daily.attendance_date>=v_month and daily.attendance_date<(v_month+interval '1 month')::date
      and (p_profile_id=auth.uid() or public.can_admin_read_attendance_store(daily.store_id))
  ), conflict_days as (
    select attendance_date, count(distinct store_id) filter(
      where daily_status not in ('rest','leave','business_trip') and planned_on_at is not null
        and (planned_on_at at time zone enterprise_timezone)::date=attendance_date
    )>1 has_schedule_conflict
    from scoped_days group by attendance_date
  ), day_rollup as (
    select d.attendance_date, min(d.id::text) id, max(d.enterprise_timezone) timezone,
      string_agg(distinct d.shift_id, '、') filter(where d.shift_id is not null) shift_id,
      string_agg(distinct d.shift_name, '、') filter(where d.shift_name is not null) shift_name,
      min(d.planned_on_at) planned_on_at, max(d.planned_off_at) planned_off_at,
      min(d.actual_on_at) actual_on_at, max(d.actual_off_at) actual_off_at,
      case when c.has_schedule_conflict then 'abnormal' when bool_or(d.daily_status='abnormal') then 'abnormal'
        when bool_or(d.daily_status='missing') then 'missing' when bool_or(d.daily_status='late') then 'late'
        when bool_or(d.daily_status='early') then 'early' when bool_or(d.daily_status='leave') then 'leave'
        when bool_or(d.daily_status='business_trip') then 'business_trip' when bool_or(d.daily_status='fieldwork') then 'fieldwork'
        when bool_or(d.daily_status='normal') then 'normal' when bool_or(d.daily_status='pending') then 'pending' else 'rest' end status,
      bool_or(d.is_attended) is_attended, sum(d.late_minutes)::integer late_minutes, sum(d.early_minutes)::integer early_minutes,
      case when bool_or(d.missing_punch='both') or (bool_or(d.missing_punch in ('on','both')) and bool_or(d.missing_punch in ('off','both'))) then 'both'
        when bool_or(d.missing_punch='on') then 'on' when bool_or(d.missing_punch='off') then 'off' else 'none' end missing_punch,
      string_agg(distinct d.exception_note,'；') filter(where d.exception_note is not null and trim(d.exception_note)<>'') exception_note,
      max(d.last_synced_at) last_synced_at, count(distinct d.corp_id)::integer enterprise_count, c.has_schedule_conflict,
      bool_or(d.daily_status='fieldwork') or exists(
        select 1 from public.attendance_punch_records p join scoped_days sd on sd.id=p.daily_record_id
        where sd.attendance_date=d.attendance_date and (
          lower(coalesce(p.source_type,'')) similar to '%(outside|field|外勤)%' or
          lower(coalesce(p.location_result,'')) similar to '%(outside|field|外勤)%'
        )
      ) has_fieldwork
    from scoped_days d join conflict_days c using(attendance_date) group by d.attendance_date,c.has_schedule_conflict
  ), summary as (
    select coalesce(array_agg(attendance_date order by attendance_date) filter(where is_attended),'{}'::date[]) attendance_dates,
      count(*) filter(where is_attended)::integer attendance_days, count(*) filter(where status='late')::integer late_count,
      coalesce(sum(late_minutes),0)::integer late_minutes, count(*) filter(where status='missing')::integer missing_count,
      count(*) filter(where status='abnormal')::integer abnormal_count, max(last_synced_at) last_synced_at from day_rollup
  )
  select jsonb_build_object(
    'summary',jsonb_build_object('attendanceDates',to_jsonb(summary.attendance_dates),'attendanceDays',summary.attendance_days,'lateCount',summary.late_count,'lateMinutes',summary.late_minutes,'missingCount',summary.missing_count,'abnormalCount',summary.abnormal_count,'lastSyncedAt',summary.last_synced_at),
    'days',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'date',r.attendance_date,'timezone',r.timezone,'shiftId',r.shift_id,'shiftName',r.shift_name,
      'plannedOnAt',r.planned_on_at,'plannedOffAt',r.planned_off_at,'actualOnAt',r.actual_on_at,'actualOffAt',r.actual_off_at,
      'onDutyResult','unknown','offDutyResult','unknown','status',r.status,'isAttended',r.is_attended,'lateMinutes',r.late_minutes,'earlyMinutes',r.early_minutes,
      'missingPunch',r.missing_punch,'exceptionNote',r.exception_note,'lastSyncedAt',r.last_synced_at,'enterpriseCount',r.enterprise_count,
      'hasScheduleConflict',r.has_schedule_conflict,'hasFieldwork',r.has_fieldwork,
      'sources',coalesce((select jsonb_agg(jsonb_build_object('corpId',s.corp_id,'enterpriseName',s.enterprise_name,'storeId',s.store_id,'storeName',s.store_name,'shiftId',s.shift_id,'shiftName',s.shift_name,'plannedOnAt',s.planned_on_at,'plannedOffAt',s.planned_off_at,'actualOnAt',s.actual_on_at,'actualOffAt',s.actual_off_at,'status',s.daily_status) order by s.enterprise_name,s.store_name) from scoped_days s where s.attendance_date=r.attendance_date),'[]'::jsonb),
      'punches',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'time',p.punch_time,'checkType',p.check_type,'timeResult',p.time_result,'locationResult',p.location_result,'locationName',p.location_name,'isApprovedCorrection',p.is_approved_correction,'enterpriseName',s.enterprise_name,'storeName',s.store_name) order by p.punch_time) from scoped_days s join public.attendance_punch_records p on p.daily_record_id=s.id where s.attendance_date=r.attendance_date),'[]'::jsonb)
    ) order by r.attendance_date desc) from day_rollup r),'[]'::jsonb)
  ) into v_result from summary;
  return coalesce(v_result,jsonb_build_object('summary',jsonb_build_object('attendanceDates','[]'::jsonb,'attendanceDays',0,'lateCount',0,'lateMinutes',0,'missingCount',0,'abnormalCount',0,'lastSyncedAt',null),'days','[]'::jsonb));
end;
$$;

revoke all on function public.get_attendance_month_detail(uuid,date) from public;
grant execute on function public.get_attendance_month_detail(uuid,date) to authenticated;

create or replace function public.admin_attendance_month(p_month date,p_store_id uuid default null,p_search text default '',p_status text default 'all',p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare v_month date:=date_trunc('month',p_month)::date; v_result jsonb;
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator permission required'; end if;
  if p_store_id is not null and not public.has_store_access(p_store_id) then raise exception 'store access denied'; end if;
  if p_status not in ('all','normal','late','missing','abnormal','unbound') then raise exception 'invalid attendance status filter'; end if;
  if p_limit<1 or p_limit>100 or p_offset<0 then raise exception 'invalid pagination'; end if;
  with targets as (
    select profile.id,profile.display_name,profile.username,profile.store_id,
      coalesce((select string_agg(distinct store.name,'、' order by store.name) from public.stores store where (store.id=profile.store_id or exists(select 1 from public.dingtalk_employee_bindings binding where binding.profile_id=profile.id and binding.store_id=store.id and binding.binding_status='active')) and public.has_store_access(store.id)),'未知门店') store_name
    from public.profiles profile
    where profile.role in ('staff','manager') and profile.is_active and profile.deleted_at is null
      and (public.has_store_access(profile.store_id) or exists(select 1 from public.dingtalk_employee_bindings binding where binding.profile_id=profile.id and binding.binding_status='active' and public.has_store_access(binding.store_id)))
      and (p_store_id is null or profile.store_id=p_store_id or exists(select 1 from public.dingtalk_employee_bindings binding where binding.profile_id=profile.id and binding.store_id=p_store_id and binding.binding_status='active'))
      and (trim(coalesce(p_search,''))='' or profile.display_name ilike '%'||trim(p_search)||'%' or profile.username ilike '%'||trim(p_search)||'%')
  ), daily_by_date as (
    select daily.profile_id,daily.attendance_date,bool_or(daily.is_attended) is_attended,
      bool_or(daily.daily_status='late') is_late,bool_or(daily.daily_status='missing') is_missing,
      bool_or(daily.daily_status='abnormal') or count(distinct daily.store_id) filter(
        where daily.daily_status not in ('rest','leave','business_trip') and daily.planned_on_at is not null
          and (daily.planned_on_at at time zone daily.enterprise_timezone)::date=daily.attendance_date
      )>1 is_abnormal,
      sum(daily.late_minutes)::integer late_minutes,max(daily.last_synced_at) last_synced_at
    from public.attendance_daily_records daily
    where daily.attendance_date>=v_month and daily.attendance_date<(v_month+interval '1 month')::date
      and public.can_admin_read_attendance_store(daily.store_id) and (p_store_id is null or daily.store_id=p_store_id)
    group by daily.profile_id,daily.attendance_date
  ), stats as (
    select profile_id,array_agg(attendance_date order by attendance_date) filter(where is_attended) attendance_dates,
      count(*) filter(where is_attended)::integer attendance_days,count(*) filter(where is_late)::integer late_count,
      coalesce(sum(late_minutes),0)::integer late_minutes,count(*) filter(where is_missing)::integer missing_count,
      count(*) filter(where is_abnormal)::integer abnormal_count,max(last_synced_at) last_synced_at
    from daily_by_date group by profile_id
  ), rows as (
    select target.*,coalesce(stats.attendance_dates,'{}'::date[]) attendance_dates,coalesce(stats.attendance_days,0) attendance_days,
      coalesce(stats.late_count,0) late_count,coalesce(stats.late_minutes,0) late_minutes,coalesce(stats.missing_count,0) missing_count,
      coalesce(stats.abnormal_count,0) abnormal_count,stats.last_synced_at,
      case when exists(select 1 from public.dingtalk_employee_bindings binding where binding.profile_id=target.id and binding.binding_status='active') then 'active' else 'unbound' end binding_status
    from targets target left join stats on stats.profile_id=target.id
  ), filtered as (
    select * from rows where p_status='all' or (p_status='normal' and binding_status='active' and late_count=0 and missing_count=0 and abnormal_count=0)
      or (p_status='late' and late_count>0) or (p_status='missing' and missing_count>0) or (p_status='abnormal' and abnormal_count>0) or (p_status='unbound' and binding_status='unbound')
  ), paged as (select * from filtered order by store_name,display_name limit p_limit offset p_offset)
  select jsonb_build_object('total',(select count(*) from filtered),'items',coalesce((select jsonb_agg(jsonb_build_object('profileId',id,'displayName',display_name,'storeId',store_id,'storeName',store_name,'attendanceDates',to_jsonb(attendance_dates),'attendanceDays',attendance_days,'lateCount',late_count,'lateMinutes',late_minutes,'missingCount',missing_count,'abnormalCount',abnormal_count,'bindingStatus',binding_status,'lastSyncedAt',last_synced_at) order by store_name,display_name) from paged),'[]'::jsonb)) into v_result;
  return v_result;
end;
$$;

revoke all on function public.admin_attendance_month(date,uuid,text,text,integer,integer) from public;
grant execute on function public.admin_attendance_month(date,uuid,text,text,integer,integer) to authenticated;
