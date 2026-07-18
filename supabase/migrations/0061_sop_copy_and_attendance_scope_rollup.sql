-- Keep SOP wording consistent and make attendance totals follow the selected
-- store scope. With no store filter, every authorized store is aggregated;
-- with a store filter, only that store contributes to totals and detail rows.

create temporary table affected_sop_copy_cleanup on commit drop as
select id as sop_id
from public.v2_sops
where body like '%按规格取用%'
union
select distinct sop_id
from public.v2_sop_assets
where step_text like '%按规格取用%';

update public.v2_sop_assets
set step_text = replace(step_text, '按规格取用', '')
where step_text like '%按规格取用%';

update public.v2_sops
set body = replace(body, '按规格取用', ''),
    updated_at = now(),
    version = version + 1
where id in (select sop_id from affected_sop_copy_cleanup);

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
          select 1
          from public.dingtalk_employee_bindings binding
          where binding.profile_id = target.id
            and binding.binding_status = 'active'
            and public.has_store_access(binding.store_id)
        )
      )
  )
$$;

drop function if exists public.get_attendance_month_detail(uuid,date);

create function public.get_attendance_month_detail(
  p_profile_id uuid,
  p_month date,
  p_store_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_result jsonb;
begin
  if p_profile_id <> auth.uid() and not public.can_admin_manage_attendance_profile(p_profile_id) then
    raise exception 'attendance access denied';
  end if;

  if p_store_id is not null and not (
    (p_profile_id = auth.uid() and exists (
      select 1 from public.profiles profile
      where profile.id = p_profile_id
        and (
          profile.store_id = p_store_id
          or exists (
            select 1 from public.dingtalk_employee_bindings binding
            where binding.profile_id = p_profile_id
              and binding.store_id = p_store_id
              and binding.binding_status = 'active'
          )
        )
    ))
    or (p_profile_id <> auth.uid() and public.can_admin_read_attendance_store(p_store_id))
  ) then
    raise exception 'attendance store access denied';
  end if;

  with scoped_days as (
    select daily.*,
      coalesce(enterprise.display_name, '钉钉企业') enterprise_name,
      store.name store_name,
      case
        when daily.actual_on_at is not null and daily.actual_off_at is not null and daily.actual_off_at > daily.actual_on_at
          then floor(extract(epoch from (daily.actual_off_at - daily.actual_on_at)) / 60)::integer
        else 0
      end worked_minutes
    from public.attendance_daily_records daily
    left join public.dingtalk_enterprises enterprise on enterprise.corp_id = daily.corp_id
    join public.stores store on store.id = daily.store_id
    where daily.profile_id = p_profile_id
      and daily.attendance_date >= v_month
      and daily.attendance_date < (v_month + interval '1 month')::date
      and (p_store_id is null or daily.store_id = p_store_id)
      and (p_profile_id = auth.uid() or public.can_admin_read_attendance_store(daily.store_id))
  ), conflict_days as (
    select attendance_date,
      count(distinct store_id) filter (
        where daily_status not in ('rest','leave','business_trip')
          and planned_on_at is not null
          and (planned_on_at at time zone enterprise_timezone)::date = attendance_date
      ) > 1 has_schedule_conflict
    from scoped_days
    group by attendance_date
  ), day_rollup as (
    select d.attendance_date,
      min(d.id::text) id,
      max(d.enterprise_timezone) timezone,
      string_agg(distinct d.shift_id, '、') filter (where d.shift_id is not null) shift_id,
      string_agg(distinct d.shift_name, '、') filter (where d.shift_name is not null) shift_name,
      min(d.planned_on_at) planned_on_at,
      max(d.planned_off_at) planned_off_at,
      min(d.actual_on_at) actual_on_at,
      max(d.actual_off_at) actual_off_at,
      case
        when c.has_schedule_conflict then 'abnormal'
        when bool_or(d.daily_status = 'abnormal') then 'abnormal'
        when bool_or(d.daily_status = 'missing') then 'missing'
        when bool_or(d.daily_status = 'late') then 'late'
        when bool_or(d.daily_status = 'early') then 'early'
        when bool_or(d.daily_status = 'leave') then 'leave'
        when bool_or(d.daily_status = 'business_trip') then 'business_trip'
        when bool_or(d.daily_status = 'fieldwork') then 'fieldwork'
        when bool_or(d.daily_status = 'normal') then 'normal'
        when bool_or(d.daily_status = 'pending') then 'pending'
        else 'rest'
      end status,
      bool_or(d.is_attended) is_attended,
      sum(d.worked_minutes)::integer worked_minutes,
      count(*) filter (where d.daily_status = 'late')::integer late_count,
      sum(d.late_minutes)::integer late_minutes,
      sum(d.early_minutes)::integer early_minutes,
      count(*) filter (where d.daily_status = 'missing')::integer missing_count,
      greatest(
        count(*) filter (where d.daily_status = 'abnormal'),
        case when c.has_schedule_conflict then 1 else 0 end
      )::integer abnormal_count,
      case
        when bool_or(d.missing_punch = 'both')
          or (bool_or(d.missing_punch in ('on','both')) and bool_or(d.missing_punch in ('off','both'))) then 'both'
        when bool_or(d.missing_punch = 'on') then 'on'
        when bool_or(d.missing_punch = 'off') then 'off'
        else 'none'
      end missing_punch,
      string_agg(distinct d.exception_note, '；') filter (where d.exception_note is not null and trim(d.exception_note) <> '') exception_note,
      max(d.last_synced_at) last_synced_at,
      count(distinct d.corp_id)::integer enterprise_count,
      c.has_schedule_conflict,
      bool_or(d.daily_status = 'fieldwork') or exists (
        select 1
        from public.attendance_punch_records punch
        join scoped_days source_day on source_day.id = punch.daily_record_id
        where source_day.attendance_date = d.attendance_date
          and (
            lower(coalesce(punch.source_type, '')) similar to '%(outside|field|外勤)%'
            or lower(coalesce(punch.location_result, '')) similar to '%(outside|field|外勤)%'
          )
      ) has_fieldwork
    from scoped_days d
    join conflict_days c using (attendance_date)
    group by d.attendance_date, c.has_schedule_conflict
  ), summary as (
    select
      coalesce(array_agg(attendance_date order by attendance_date) filter (where is_attended), '{}'::date[]) attendance_dates,
      count(*) filter (where is_attended)::integer attendance_days,
      coalesce(sum(worked_minutes), 0)::integer worked_minutes,
      coalesce(sum(late_count), 0)::integer late_count,
      coalesce(sum(late_minutes), 0)::integer late_minutes,
      coalesce(sum(missing_count), 0)::integer missing_count,
      coalesce(sum(abnormal_count), 0)::integer abnormal_count,
      max(last_synced_at) last_synced_at
    from day_rollup
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'attendanceDates', to_jsonb(summary.attendance_dates),
      'attendanceDays', summary.attendance_days,
      'workedMinutes', summary.worked_minutes,
      'lateCount', summary.late_count,
      'lateMinutes', summary.late_minutes,
      'missingCount', summary.missing_count,
      'abnormalCount', summary.abnormal_count,
      'lastSyncedAt', summary.last_synced_at
    ),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rollup.id,
        'date', rollup.attendance_date,
        'timezone', rollup.timezone,
        'shiftId', rollup.shift_id,
        'shiftName', rollup.shift_name,
        'plannedOnAt', rollup.planned_on_at,
        'plannedOffAt', rollup.planned_off_at,
        'actualOnAt', rollup.actual_on_at,
        'actualOffAt', rollup.actual_off_at,
        'onDutyResult', 'unknown',
        'offDutyResult', 'unknown',
        'status', rollup.status,
        'isAttended', rollup.is_attended,
        'workedMinutes', rollup.worked_minutes,
        'lateMinutes', rollup.late_minutes,
        'earlyMinutes', rollup.early_minutes,
        'missingPunch', rollup.missing_punch,
        'exceptionNote', rollup.exception_note,
        'lastSyncedAt', rollup.last_synced_at,
        'enterpriseCount', rollup.enterprise_count,
        'hasScheduleConflict', rollup.has_schedule_conflict,
        'hasFieldwork', rollup.has_fieldwork,
        'sources', coalesce((
          select jsonb_agg(jsonb_build_object(
            'corpId', source.corp_id,
            'enterpriseName', source.enterprise_name,
            'storeId', source.store_id,
            'storeName', source.store_name,
            'shiftId', source.shift_id,
            'shiftName', source.shift_name,
            'plannedOnAt', source.planned_on_at,
            'plannedOffAt', source.planned_off_at,
            'actualOnAt', source.actual_on_at,
            'actualOffAt', source.actual_off_at,
            'workedMinutes', source.worked_minutes,
            'status', source.daily_status
          ) order by source.enterprise_name, source.store_name)
          from scoped_days source
          where source.attendance_date = rollup.attendance_date
        ), '[]'::jsonb),
        'punches', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', punch.id,
            'time', punch.punch_time,
            'checkType', punch.check_type,
            'timeResult', punch.time_result,
            'locationResult', punch.location_result,
            'locationName', punch.location_name,
            'isApprovedCorrection', punch.is_approved_correction,
            'enterpriseName', source.enterprise_name,
            'storeName', source.store_name
          ) order by punch.punch_time)
          from scoped_days source
          join public.attendance_punch_records punch on punch.daily_record_id = source.id
          where source.attendance_date = rollup.attendance_date
        ), '[]'::jsonb)
      ) order by rollup.attendance_date desc)
      from day_rollup rollup
    ), '[]'::jsonb)
  ) into v_result
  from summary;

  return coalesce(v_result, jsonb_build_object(
    'summary', jsonb_build_object(
      'attendanceDates', '[]'::jsonb,
      'attendanceDays', 0,
      'workedMinutes', 0,
      'lateCount', 0,
      'lateMinutes', 0,
      'missingCount', 0,
      'abnormalCount', 0,
      'lastSyncedAt', null
    ),
    'days', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.get_attendance_month_detail(uuid,date,uuid) from public;
grant execute on function public.get_attendance_month_detail(uuid,date,uuid) to authenticated;

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
    select profile.id,
      profile.display_name,
      profile.username,
      coalesce(p_store_id, profile.store_id) store_id,
      coalesce((
        select string_agg(distinct store.name, '、' order by store.name)
        from public.stores store
        where (
          store.id = profile.store_id
          or exists (
            select 1 from public.dingtalk_employee_bindings binding
            where binding.profile_id = profile.id
              and binding.store_id = store.id
              and binding.binding_status = 'active'
          )
        )
          and public.has_store_access(store.id)
          and (p_store_id is null or store.id = p_store_id)
      ), '未知门店') store_name
    from public.profiles profile
    where profile.role in ('staff','manager')
      and profile.is_active
      and profile.deleted_at is null
      and (
        public.has_store_access(profile.store_id)
        or exists (
          select 1 from public.dingtalk_employee_bindings binding
          where binding.profile_id = profile.id
            and binding.binding_status = 'active'
            and public.has_store_access(binding.store_id)
        )
      )
      and (
        p_store_id is null
        or profile.store_id = p_store_id
        or exists (
          select 1 from public.dingtalk_employee_bindings binding
          where binding.profile_id = profile.id
            and binding.store_id = p_store_id
            and binding.binding_status = 'active'
        )
      )
      and (
        trim(coalesce(p_search, '')) = ''
        or profile.display_name ilike '%' || trim(p_search) || '%'
        or profile.username ilike '%' || trim(p_search) || '%'
      )
  ), daily_by_date as (
    select daily.profile_id,
      daily.attendance_date,
      bool_or(daily.is_attended) is_attended,
      sum(case
        when daily.actual_on_at is not null and daily.actual_off_at is not null and daily.actual_off_at > daily.actual_on_at
          then floor(extract(epoch from (daily.actual_off_at - daily.actual_on_at)) / 60)::integer
        else 0
      end)::integer worked_minutes,
      count(*) filter (where daily.daily_status = 'late')::integer late_count,
      sum(daily.late_minutes)::integer late_minutes,
      count(*) filter (where daily.daily_status = 'missing')::integer missing_count,
      greatest(
        count(*) filter (where daily.daily_status = 'abnormal'),
        case when count(distinct daily.store_id) filter (
          where daily.daily_status not in ('rest','leave','business_trip')
            and daily.planned_on_at is not null
            and (daily.planned_on_at at time zone daily.enterprise_timezone)::date = daily.attendance_date
        ) > 1 then 1 else 0 end
      )::integer abnormal_count,
      max(daily.last_synced_at) last_synced_at
    from public.attendance_daily_records daily
    where daily.attendance_date >= v_month
      and daily.attendance_date < (v_month + interval '1 month')::date
      and public.can_admin_read_attendance_store(daily.store_id)
      and (p_store_id is null or daily.store_id = p_store_id)
    group by daily.profile_id, daily.attendance_date
  ), stats as (
    select profile_id,
      array_agg(attendance_date order by attendance_date) filter (where is_attended) attendance_dates,
      count(*) filter (where is_attended)::integer attendance_days,
      coalesce(sum(worked_minutes), 0)::integer worked_minutes,
      coalesce(sum(late_count), 0)::integer late_count,
      coalesce(sum(late_minutes), 0)::integer late_minutes,
      coalesce(sum(missing_count), 0)::integer missing_count,
      coalesce(sum(abnormal_count), 0)::integer abnormal_count,
      max(last_synced_at) last_synced_at
    from daily_by_date
    group by profile_id
  ), rows as (
    select target.*,
      coalesce(stats.attendance_dates, '{}'::date[]) attendance_dates,
      coalesce(stats.attendance_days, 0) attendance_days,
      coalesce(stats.worked_minutes, 0) worked_minutes,
      coalesce(stats.late_count, 0) late_count,
      coalesce(stats.late_minutes, 0) late_minutes,
      coalesce(stats.missing_count, 0) missing_count,
      coalesce(stats.abnormal_count, 0) abnormal_count,
      stats.last_synced_at,
      case when exists (
        select 1 from public.dingtalk_employee_bindings binding
        where binding.profile_id = target.id and binding.binding_status = 'active'
      ) then 'active' else 'unbound' end binding_status
    from targets target
    left join stats on stats.profile_id = target.id
  ), filtered as (
    select *
    from rows
    where p_status = 'all'
      or (p_status = 'normal' and binding_status = 'active' and late_count = 0 and missing_count = 0 and abnormal_count = 0)
      or (p_status = 'late' and late_count > 0)
      or (p_status = 'missing' and missing_count > 0)
      or (p_status = 'abnormal' and abnormal_count > 0)
      or (p_status = 'unbound' and binding_status = 'unbound')
  ), paged as (
    select * from filtered order by store_name, display_name limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profileId', id,
        'displayName', display_name,
        'storeId', store_id,
        'storeName', store_name,
        'attendanceDates', to_jsonb(attendance_dates),
        'attendanceDays', attendance_days,
        'workedMinutes', worked_minutes,
        'lateCount', late_count,
        'lateMinutes', late_minutes,
        'missingCount', missing_count,
        'abnormalCount', abnormal_count,
        'bindingStatus', binding_status,
        'lastSyncedAt', last_synced_at
      ) order by store_name, display_name)
      from paged
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_attendance_month(date,uuid,text,text,integer,integer) from public;
grant execute on function public.admin_attendance_month(date,uuid,text,text,integer,integer) to authenticated;
