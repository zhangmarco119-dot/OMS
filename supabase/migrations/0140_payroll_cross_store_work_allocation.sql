-- Allocate scheduled work by the distinct stores actually involved on each
-- attendance day. A scheduled shift contributes its duration minus the
-- one-hour meal break; approved overtime remains a separate addition.

create function public.payroll_resolve_attendance_store(
  p_fallback_store_id uuid,
  p_location_name text
)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  with input as (
    select regexp_replace(lower(coalesce(p_location_name, '')), '[[:space:]（）()·._—–-]+', '', 'g') location
  ), candidates as (
    select store.id
    from public.stores store cross join input
    cross join lateral (
      select
        regexp_replace(lower(coalesce(store.name, '')), '[[:space:]（）()·._—–-]+', '', 'g') full_name,
        regexp_replace(lower(coalesce(store.short_name, '')), '[[:space:]（）()·._—–-]+', '', 'g') short_name
    ) normalized
    where store.is_active
      and public.has_store_access(store.id)
      and input.location <> ''
      and (
        (length(normalized.full_name) >= 2 and input.location like '%' || normalized.full_name || '%')
        or (length(normalized.short_name) >= 2 and input.location like '%' || normalized.short_name || '%')
        or (
          length(regexp_replace(normalized.short_name, '(门店|店)$', '')) >= 2
          and input.location like '%' || regexp_replace(normalized.short_name, '(门店|店)$', '') || '%'
        )
      )
  )
  select case when count(*) = 1 then min(id::text)::uuid else p_fallback_store_id end
  from candidates;
$$;

alter function public.admin_payroll_statistics_inputs(date, date)
  rename to admin_payroll_statistics_inputs_before_cross_store_work;

create function public.admin_payroll_statistics_inputs(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
  v_work jsonb;
begin
  v_result := public.admin_payroll_statistics_inputs_before_cross_store_work(p_from, p_to);

  with attendance_rows as (
    select daily.*
    from public.attendance_daily_records daily
    where daily.attendance_date between p_from and p_to
      and public.can_admin_manage_attendance_profile(daily.profile_id)
  ), eligible_days as (
    select row.profile_id, row.attendance_date,
      coalesce(
        max(greatest(extract(epoch from (row.planned_off_at - row.planned_on_at)) / 3600 - 1, 0))
          filter (where row.planned_on_at is not null and row.planned_off_at > row.planned_on_at),
        max(greatest(extract(epoch from (row.actual_off_at - row.actual_on_at)) / 3600 - 1, 0))
          filter (where row.actual_on_at is not null and row.actual_off_at > row.actual_on_at),
        0
      ) attendance_hours
    from attendance_rows row
    group by row.profile_id, row.attendance_date
    having bool_or(row.is_attended)
  ), scheduled_stores as (
    select distinct row.profile_id, row.attendance_date, row.store_id
    from attendance_rows row
    join eligible_days day using(profile_id, attendance_date)
    where row.is_attended and public.has_store_access(row.store_id)
  ), punch_stores as (
    select distinct row.profile_id, row.attendance_date,
      public.payroll_resolve_attendance_store(punch.store_id, punch.location_name) store_id
    from attendance_rows row
    join eligible_days day using(profile_id, attendance_date)
    join public.attendance_punch_records punch on punch.daily_record_id = row.id
  ), day_stores as (
    select profile_id, attendance_date, store_id from scheduled_stores
    union
    select profile_id, attendance_date, store_id from punch_stores where store_id is not null
  ), day_store_counts as (
    select profile_id, attendance_date, count(*) store_count
    from day_stores
    group by profile_id, attendance_date
  ), allocated_attendance as (
    select date_trunc('month', day.attendance_date)::date payroll_month,
      day.profile_id, store.store_id,
      round(sum(day.attendance_hours / nullif(store_count.store_count, 0)), 4) attendance_hours
    from eligible_days day
    join day_stores store using(profile_id, attendance_date)
    join day_store_counts store_count using(profile_id, attendance_date)
    group by 1, 2, 3
  ), overtime as (
    select date_trunc('month', request.overtime_date)::date payroll_month,
      request.profile_id, request.store_id,
      round(sum(request.hours), 2) overtime_hours,
      round(sum(request.hours * coalesce(request.approved_hourly_rate, 0)), 2) overtime_cost
    from public.payroll_overtime_requests request
    where request.overtime_date between p_from and p_to
      and request.status = 'approved'
      and public.can_admin_manage_attendance_profile(request.profile_id)
      and public.has_store_access(request.store_id)
    group by 1, 2, 3
  ), work_keys as (
    select payroll_month, profile_id, store_id from allocated_attendance
    union
    select payroll_month, profile_id, store_id from overtime
  ), work_rows as (
    select key.payroll_month, key.profile_id, key.store_id,
      coalesce(attendance.attendance_hours, 0) attendance_hours,
      coalesce(overtime.overtime_hours, 0) overtime_hours,
      coalesce(overtime.overtime_cost, 0) overtime_cost
    from work_keys key
    left join allocated_attendance attendance using(payroll_month, profile_id, store_id)
    left join overtime using(payroll_month, profile_id, store_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'payrollMonth', row.payroll_month,
    'profileId', row.profile_id,
    'storeId', row.store_id,
    'attendanceHours', row.attendance_hours,
    'overtimeHours', row.overtime_hours,
    'overtimeCost', row.overtime_cost
  ) order by row.payroll_month, row.profile_id, row.store_id), '[]'::jsonb)
  into v_work from work_rows row;

  return jsonb_set(v_result, '{work}', v_work, true);
end;
$$;

revoke all on function public.payroll_resolve_attendance_store(uuid,text) from public, anon, authenticated;
revoke all on function public.admin_payroll_statistics_inputs_before_cross_store_work(date,date) from public, anon, authenticated;
revoke all on function public.admin_payroll_statistics_inputs(date,date) from public, anon;
grant execute on function public.admin_payroll_statistics_inputs(date,date) to authenticated;

comment on function public.payroll_resolve_attendance_store(uuid,text) is
  'Resolves a DingTalk punch location to exactly one accessible active store, otherwise preserves its structured store.';
comment on function public.admin_payroll_statistics_inputs(date,date) is
  'Returns payroll statistics with scheduled hours minus one meal hour and equal per-day allocation across involved stores.';
