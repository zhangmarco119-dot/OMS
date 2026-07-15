-- Support multiple DingTalk enterprises, explicit enterprise-to-store mapping,
-- multiple enterprise identities per StoreHub employee, and merged attendance.

create table public.dingtalk_enterprises (
  corp_id text primary key,
  display_name text not null,
  is_active boolean not null default true,
  last_directory_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(corp_id)) > 0 and length(trim(display_name)) > 0)
);

create table public.dingtalk_store_enterprise_bindings (
  id uuid primary key default gen_random_uuid(),
  corp_id text not null references public.dingtalk_enterprises(corp_id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete cascade,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (corp_id, store_id)
);

create trigger dingtalk_enterprises_touch_updated_at before update on public.dingtalk_enterprises for each row execute function public.touch_updated_at();
create trigger dingtalk_store_enterprise_bindings_touch_updated_at before update on public.dingtalk_store_enterprise_bindings for each row execute function public.touch_updated_at();

insert into public.dingtalk_enterprises(corp_id, display_name, last_directory_synced_at)
select directory.corp_id, '钉钉企业 · ' || right(directory.corp_id, 6), max(directory.last_synced_at)
from public.dingtalk_employee_directory directory
group by directory.corp_id
on conflict (corp_id) do update set last_directory_synced_at = excluded.last_directory_synced_at;

alter table public.dingtalk_employee_bindings add column store_id uuid references public.stores(id) on delete restrict;
update public.dingtalk_employee_bindings binding
set store_id = profile.store_id
from public.profiles profile
where profile.id = binding.profile_id and binding.store_id is null;
alter table public.dingtalk_employee_bindings alter column store_id set not null;

insert into public.dingtalk_store_enterprise_bindings(corp_id, store_id)
select distinct corp_id, store_id from public.dingtalk_employee_bindings
on conflict (corp_id, store_id) do nothing;

drop index public.dingtalk_employee_bindings_active_profile_idx;
create unique index dingtalk_employee_bindings_active_profile_corp_idx
on public.dingtalk_employee_bindings(profile_id, corp_id)
where binding_status = 'active';
create index dingtalk_employee_bindings_store_idx
on public.dingtalk_employee_bindings(store_id, binding_status, profile_id);

alter table public.attendance_daily_records drop constraint attendance_daily_records_daily_status_check;
alter table public.attendance_daily_records add constraint attendance_daily_records_daily_status_check
check (daily_status in ('normal', 'late', 'early', 'missing', 'pending', 'rest', 'leave', 'business_trip', 'fieldwork', 'abnormal'));

alter table public.dingtalk_enterprises enable row level security;
alter table public.dingtalk_store_enterprise_bindings enable row level security;
create policy dingtalk_enterprises_select_admin on public.dingtalk_enterprises for select to authenticated
using (public.current_user_role() = 'admin');
create policy dingtalk_store_enterprise_bindings_select_admin on public.dingtalk_store_enterprise_bindings for select to authenticated
using (public.current_user_role() = 'admin' and public.has_store_access(store_id));
revoke all on public.dingtalk_enterprises, public.dingtalk_store_enterprise_bindings from anon, authenticated;
grant select on public.dingtalk_enterprises, public.dingtalk_store_enterprise_bindings to authenticated;

create or replace function public.can_admin_manage_attendance_profile(target_profile_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.current_user_role() = 'admin' and exists (
    select 1
    from public.profiles target
    where target.id = target_profile_id
      and target.role in ('staff','manager')
      and target.is_active
      and target.deleted_at is null
      and (
        public.has_store_access(target.store_id)
        or exists (
          select 1 from public.dingtalk_employee_bindings binding
          where binding.profile_id = target.id
            and binding.binding_status = 'active'
            and public.has_store_access(binding.store_id)
        )
      )
  )
$$;

create or replace function public.admin_save_dingtalk_store_enterprise(
  p_corp_id text,
  p_store_id uuid,
  p_display_name text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_mapping public.dingtalk_store_enterprise_bindings%rowtype;
begin
  if public.current_user_role() <> 'admin' or not public.has_store_access(p_store_id) then
    raise exception 'administrator store access required' using errcode = '42501';
  end if;
  if trim(coalesce(p_corp_id,'')) = '' or trim(coalesce(p_display_name,'')) = '' then
    raise exception 'enterprise id and name required' using errcode = '22023';
  end if;
  insert into public.dingtalk_enterprises(corp_id, display_name, is_active)
  values(trim(p_corp_id), trim(p_display_name), true)
  on conflict(corp_id) do update set display_name=excluded.display_name, is_active=true;
  insert into public.dingtalk_store_enterprise_bindings(corp_id, store_id, is_active, created_by)
  values(trim(p_corp_id), p_store_id, true, auth.uid())
  on conflict(corp_id,store_id) do update set is_active=true, updated_at=now()
  returning * into v_mapping;
  return to_jsonb(v_mapping);
end;
$$;

create or replace function public.admin_remove_dingtalk_store_enterprise(p_mapping_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_mapping public.dingtalk_store_enterprise_bindings%rowtype;
begin
  select * into v_mapping from public.dingtalk_store_enterprise_bindings where id=p_mapping_id for update;
  if v_mapping.id is null or public.current_user_role()<>'admin' or not public.has_store_access(v_mapping.store_id) then
    raise exception 'enterprise mapping access denied' using errcode='42501';
  end if;
  if exists(select 1 from public.dingtalk_employee_bindings where corp_id=v_mapping.corp_id and store_id=v_mapping.store_id and binding_status='active') then
    raise exception 'unbind employees before removing enterprise mapping' using errcode='55000';
  end if;
  update public.dingtalk_store_enterprise_bindings set is_active=false where id=v_mapping.id returning * into v_mapping;
  return to_jsonb(v_mapping);
end;
$$;

drop function public.admin_bind_dingtalk_employee(uuid,uuid,text);
create function public.admin_bind_dingtalk_employee(
  p_profile_id uuid,
  p_directory_user_id uuid,
  p_match_source text default 'manual',
  p_store_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_directory public.dingtalk_employee_directory%rowtype;
  v_profile public.profiles%rowtype;
  v_binding public.dingtalk_employee_bindings%rowtype;
  v_store_id uuid;
begin
  select * into v_profile from public.profiles where id=p_profile_id;
  if v_profile.id is null or not public.can_admin_manage_attendance_profile(p_profile_id) then
    raise exception 'administrator profile access required' using errcode='42501';
  end if;
  select * into v_directory from public.dingtalk_employee_directory where id=p_directory_user_id and is_active;
  if v_directory.id is null then raise exception 'active DingTalk employee required' using errcode='P0002'; end if;
  v_store_id := coalesce(p_store_id, v_profile.store_id);
  if not public.has_store_access(v_store_id) then raise exception 'store access denied' using errcode='42501'; end if;
  if not exists(select 1 from public.profile_store_access where profile_id=p_profile_id and store_id=v_store_id)
     and v_profile.store_id <> v_store_id then
    raise exception 'employee does not belong to selected store' using errcode='42501';
  end if;
  if not exists(select 1 from public.dingtalk_store_enterprise_bindings where corp_id=v_directory.corp_id and store_id=v_store_id and is_active) then
    raise exception 'map DingTalk enterprise to store before binding employee' using errcode='55000';
  end if;
  if exists(select 1 from public.dingtalk_employee_bindings where corp_id=v_directory.corp_id and dingtalk_user_id=v_directory.dingtalk_user_id and binding_status='active' and profile_id<>p_profile_id) then
    raise exception 'DingTalk employee already bound to another account' using errcode='23505';
  end if;
  update public.dingtalk_employee_bindings
  set binding_status='inactive', updated_at=now()
  where profile_id=p_profile_id and corp_id=v_directory.corp_id and binding_status='active';
  insert into public.dingtalk_employee_bindings(profile_id,directory_user_id,corp_id,dingtalk_user_id,union_id,store_id,binding_status,match_source,last_verified_at,created_by)
  values(p_profile_id,v_directory.id,v_directory.corp_id,v_directory.dingtalk_user_id,v_directory.union_id,v_store_id,'active',p_match_source,now(),auth.uid())
  returning * into v_binding;
  return to_jsonb(v_binding);
end;
$$;

drop function public.admin_unbind_dingtalk_employee(uuid);
create function public.admin_unbind_dingtalk_employee(p_binding_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_binding public.dingtalk_employee_bindings%rowtype;
begin
  select * into v_binding from public.dingtalk_employee_bindings where id=p_binding_id for update;
  if v_binding.id is null or not public.can_admin_manage_attendance_profile(v_binding.profile_id) or not public.has_store_access(v_binding.store_id) then
    raise exception 'binding access denied' using errcode='42501';
  end if;
  update public.dingtalk_employee_bindings set binding_status='inactive',updated_at=now()
  where id=v_binding.id returning * into v_binding;
  return to_jsonb(v_binding);
end;
$$;

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
  ), day_rollup as (
    select attendance_date,
      min(id::text) id, max(enterprise_timezone) timezone,
      string_agg(distinct shift_id, '、') filter(where shift_id is not null) shift_id,
      string_agg(distinct shift_name, '、') filter(where shift_name is not null) shift_name,
      min(planned_on_at) planned_on_at, max(planned_off_at) planned_off_at,
      min(actual_on_at) actual_on_at, max(actual_off_at) actual_off_at,
      case when bool_or(daily_status='abnormal') then 'abnormal' when bool_or(daily_status='missing') then 'missing'
        when bool_or(daily_status='late') then 'late' when bool_or(daily_status='early') then 'early'
        when bool_or(daily_status='leave') then 'leave' when bool_or(daily_status='business_trip') then 'business_trip'
        when bool_or(daily_status='fieldwork') then 'fieldwork' when bool_or(daily_status='normal') then 'normal'
        when bool_or(daily_status='pending') then 'pending' else 'rest' end status,
      bool_or(is_attended) is_attended, sum(late_minutes)::integer late_minutes, sum(early_minutes)::integer early_minutes,
      case when bool_or(missing_punch='both') or (bool_or(missing_punch in ('on','both')) and bool_or(missing_punch in ('off','both'))) then 'both'
        when bool_or(missing_punch='on') then 'on' when bool_or(missing_punch='off') then 'off' else 'none' end missing_punch,
      string_agg(distinct exception_note,'；') filter(where exception_note is not null and trim(exception_note)<>'') exception_note,
      max(last_synced_at) last_synced_at, count(distinct corp_id)::integer enterprise_count,
      count(*) filter(where daily_status<>'rest' and (planned_on_at is not null or planned_off_at is not null))>1 has_schedule_conflict
    from scoped_days group by attendance_date
  ), summary as (
    select coalesce(array_agg(attendance_date order by attendance_date) filter(where is_attended),'{}'::date[]) attendance_dates,
      count(*) filter(where is_attended)::integer attendance_days,
      count(*) filter(where status='late')::integer late_count, coalesce(sum(late_minutes),0)::integer late_minutes,
      count(*) filter(where status='missing')::integer missing_count, count(*) filter(where status='abnormal')::integer abnormal_count,
      max(last_synced_at) last_synced_at from day_rollup
  )
  select jsonb_build_object(
    'summary',jsonb_build_object('attendanceDates',to_jsonb(summary.attendance_dates),'attendanceDays',summary.attendance_days,'lateCount',summary.late_count,'lateMinutes',summary.late_minutes,'missingCount',summary.missing_count,'abnormalCount',summary.abnormal_count,'lastSyncedAt',summary.last_synced_at),
    'days',coalesce((select jsonb_agg(jsonb_build_object(
      'id',rollup.id,'date',rollup.attendance_date,'timezone',rollup.timezone,'shiftId',rollup.shift_id,'shiftName',rollup.shift_name,
      'plannedOnAt',rollup.planned_on_at,'plannedOffAt',rollup.planned_off_at,'actualOnAt',rollup.actual_on_at,'actualOffAt',rollup.actual_off_at,
      'onDutyResult','unknown','offDutyResult','unknown','status',rollup.status,'isAttended',rollup.is_attended,'lateMinutes',rollup.late_minutes,'earlyMinutes',rollup.early_minutes,
      'missingPunch',rollup.missing_punch,'exceptionNote',rollup.exception_note,'lastSyncedAt',rollup.last_synced_at,'enterpriseCount',rollup.enterprise_count,'hasScheduleConflict',rollup.has_schedule_conflict,
      'sources',coalesce((select jsonb_agg(jsonb_build_object('corpId',source.corp_id,'enterpriseName',source.enterprise_name,'storeId',source.store_id,'storeName',source.store_name,'shiftId',source.shift_id,'shiftName',source.shift_name,'plannedOnAt',source.planned_on_at,'plannedOffAt',source.planned_off_at,'actualOnAt',source.actual_on_at,'actualOffAt',source.actual_off_at,'status',source.daily_status) order by source.enterprise_name,source.store_name) from scoped_days source where source.attendance_date=rollup.attendance_date),'[]'::jsonb),
      'punches',coalesce((select jsonb_agg(jsonb_build_object('id',punch.id,'time',punch.punch_time,'checkType',punch.check_type,'timeResult',punch.time_result,'locationResult',punch.location_result,'locationName',punch.location_name,'isApprovedCorrection',punch.is_approved_correction,'enterpriseName',source.enterprise_name,'storeName',source.store_name) order by punch.punch_time) from scoped_days source join public.attendance_punch_records punch on punch.daily_record_id=source.id where source.attendance_date=rollup.attendance_date),'[]'::jsonb)
    ) order by rollup.attendance_date desc) from day_rollup rollup),'[]'::jsonb)
  ) into v_result from summary;
  return coalesce(v_result,jsonb_build_object('summary',jsonb_build_object('attendanceDates','[]'::jsonb,'attendanceDays',0,'lateCount',0,'lateMinutes',0,'missingCount',0,'abnormalCount',0,'lastSyncedAt',null),'days','[]'::jsonb));
end;
$$;

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
      bool_or(daily.daily_status='late') is_late,bool_or(daily.daily_status='missing') is_missing,bool_or(daily.daily_status='abnormal') is_abnormal,
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

revoke all on function public.admin_save_dingtalk_store_enterprise(text,uuid,text), public.admin_remove_dingtalk_store_enterprise(uuid), public.admin_bind_dingtalk_employee(uuid,uuid,text,uuid), public.admin_unbind_dingtalk_employee(uuid) from public;
grant execute on function public.admin_save_dingtalk_store_enterprise(text,uuid,text), public.admin_remove_dingtalk_store_enterprise(uuid), public.admin_bind_dingtalk_employee(uuid,uuid,text,uuid), public.admin_unbind_dingtalk_employee(uuid) to authenticated;
