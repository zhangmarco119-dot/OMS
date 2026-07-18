-- Keep DingTalk-synchronized enterprise names authoritative and only warn when
-- more than one enterprise has a real shift starting on the attendance date.

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
  on conflict(corp_id) do update set is_active=true;
  insert into public.dingtalk_store_enterprise_bindings(corp_id, store_id, is_active, created_by)
  values(trim(p_corp_id), p_store_id, true, auth.uid())
  on conflict(corp_id,store_id) do update set is_active=true, updated_at=now()
  returning * into v_mapping;
  return to_jsonb(v_mapping);
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
      count(distinct corp_id) filter(
        where daily_status not in ('rest','leave','business_trip')
          and planned_on_at is not null
          and (planned_on_at at time zone enterprise_timezone)::date=attendance_date
      )>1 has_schedule_conflict
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

revoke all on function public.admin_save_dingtalk_store_enterprise(text,uuid,text), public.get_attendance_month_detail(uuid,date) from public;
grant execute on function public.admin_save_dingtalk_store_enterprise(text,uuid,text), public.get_attendance_month_detail(uuid,date) to authenticated;
