-- Harden employee scope for multi-store accounts. Attendance follows the
-- employee's current StoreHub store; secondary profile access must not expose
-- another store's attendance through security-definer RPCs.

create or replace function public.can_admin_manage_attendance_profile(target_profile_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.current_user_role() = 'admin' and exists (
    select 1 from public.profiles target
    where target.id = target_profile_id
      and target.role in ('staff','manager')
      and target.is_active
      and target.deleted_at is null
      and public.has_store_access(target.store_id)
  )
$$;

create or replace function public.get_attendance_month_detail(p_profile_id uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_result jsonb;
begin
  if p_profile_id <> auth.uid() and not public.can_admin_manage_attendance_profile(p_profile_id) then
    raise exception 'attendance access denied';
  end if;

  with scoped_days as (
    select daily.*
    from public.attendance_daily_records daily
    where daily.profile_id = p_profile_id
      and daily.attendance_date >= v_month
      and daily.attendance_date < (v_month + interval '1 month')::date
      and (p_profile_id = auth.uid() or public.can_admin_read_attendance_store(daily.store_id))
  ), summary as (
    select
      coalesce(array_agg(distinct attendance_date order by attendance_date) filter (where is_attended), '{}'::date[]) attendance_dates,
      count(distinct attendance_date) filter (where is_attended)::integer attendance_days,
      count(*) filter (where on_duty_result = 'late' or daily_status = 'late')::integer late_count,
      coalesce(sum(late_minutes),0)::integer late_minutes,
      count(*) filter (where missing_punch <> 'none' or daily_status = 'missing')::integer missing_count,
      count(*) filter (where daily_status = 'abnormal')::integer abnormal_count,
      max(last_synced_at) last_synced_at
    from scoped_days
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'attendanceDates', to_jsonb(summary.attendance_dates), 'attendanceDays', summary.attendance_days,
      'lateCount', summary.late_count, 'lateMinutes', summary.late_minutes,
      'missingCount', summary.missing_count, 'abnormalCount', summary.abnormal_count,
      'lastSyncedAt', summary.last_synced_at
    ),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
      'id', daily.id, 'date', daily.attendance_date, 'timezone', daily.enterprise_timezone,
      'shiftId', daily.shift_id, 'shiftName', daily.shift_name,
      'plannedOnAt', daily.planned_on_at, 'plannedOffAt', daily.planned_off_at,
      'actualOnAt', daily.actual_on_at, 'actualOffAt', daily.actual_off_at,
      'onDutyResult', daily.on_duty_result, 'offDutyResult', daily.off_duty_result,
      'status', daily.daily_status, 'isAttended', daily.is_attended,
      'lateMinutes', daily.late_minutes, 'earlyMinutes', daily.early_minutes,
      'missingPunch', daily.missing_punch, 'exceptionNote', daily.exception_note,
      'lastSyncedAt', daily.last_synced_at,
      'punches', coalesce((select jsonb_agg(jsonb_build_object(
        'id', punch.id, 'time', punch.punch_time, 'checkType', punch.check_type,
        'timeResult', punch.time_result, 'locationResult', punch.location_result,
        'locationName', punch.location_name, 'isApprovedCorrection', punch.is_approved_correction
      ) order by punch.punch_time) from public.attendance_punch_records punch where punch.daily_record_id=daily.id), '[]'::jsonb)
    ) order by daily.attendance_date desc) from scoped_days daily), '[]'::jsonb)
  ) into v_result from summary;

  return coalesce(v_result, jsonb_build_object(
    'summary', jsonb_build_object('attendanceDates','[]'::jsonb,'attendanceDays',0,'lateCount',0,'lateMinutes',0,'missingCount',0,'abnormalCount',0,'lastSyncedAt',null),
    'days','[]'::jsonb
  ));
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
    select profile.id, profile.display_name, profile.store_id, store.name as store_name
    from public.profiles profile
    join public.stores store on store.id = profile.store_id
    where profile.role in ('staff','manager') and profile.is_active and profile.deleted_at is null
      and public.has_store_access(profile.store_id)
      and (p_store_id is null or profile.store_id = p_store_id)
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

revoke all on function public.can_admin_manage_attendance_profile(uuid), public.get_attendance_month_detail(uuid,date),
  public.admin_attendance_month(date,uuid,text,text,integer,integer) from public;
grant execute on function public.get_attendance_month_detail(uuid,date),
  public.admin_attendance_month(date,uuid,text,text,integer,integer) to authenticated;
