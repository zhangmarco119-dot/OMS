-- Let administrators define an employee-level rule that reallocates a fixed
-- share of scheduled hours and their salary cost when a fieldwork punch exists.

create table public.payroll_attendance_allocation_rules (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  source_store_id uuid not null references public.stores(id),
  target_store_id uuid not null references public.stores(id),
  punch_scope text not null default 'any' check (punch_scope in ('any', 'on_duty', 'off_duty')),
  target_ratio numeric(7,6) not null default 0.5 check (target_ratio > 0 and target_ratio < 1),
  effective_from date not null,
  effective_to date,
  is_enabled boolean not null default true,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_store_id <> target_store_id),
  check (effective_to is null or effective_to >= effective_from)
);

alter table public.payroll_attendance_allocation_rules enable row level security;

create policy payroll_attendance_allocation_rules_admin_select
on public.payroll_attendance_allocation_rules for select to authenticated
using (
  public.current_user_role() = 'admin'
  and public.can_admin_manage_attendance_profile(profile_id)
  and public.has_store_access(source_store_id)
  and public.has_store_access(target_store_id)
);

grant select on public.payroll_attendance_allocation_rules to authenticated;

create function public.admin_save_payroll_attendance_allocation_rule(
  p_profile_id uuid,
  p_source_store_id uuid,
  p_target_store_id uuid,
  p_punch_scope text,
  p_target_ratio numeric,
  p_effective_from date,
  p_effective_to date default null,
  p_is_enabled boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'admin'
     or not public.can_admin_manage_attendance_profile(p_profile_id) then
    raise exception 'payroll profile access denied';
  end if;
  if not public.has_store_access(p_source_store_id)
     or not public.has_store_access(p_target_store_id) then
    raise exception 'payroll allocation store access denied';
  end if;
  if p_source_store_id = p_target_store_id then
    raise exception 'source and target stores must be different';
  end if;
  if p_punch_scope not in ('any', 'on_duty', 'off_duty') then
    raise exception 'invalid fieldwork punch scope';
  end if;
  if p_target_ratio <= 0 or p_target_ratio >= 1 then
    raise exception 'target allocation ratio must be between zero and one';
  end if;
  if p_effective_from is null or (p_effective_to is not null and p_effective_to < p_effective_from) then
    raise exception 'invalid payroll allocation effective range';
  end if;

  insert into public.payroll_attendance_allocation_rules(
    profile_id, source_store_id, target_store_id, punch_scope, target_ratio,
    effective_from, effective_to, is_enabled, updated_by
  ) values (
    p_profile_id, p_source_store_id, p_target_store_id, p_punch_scope, p_target_ratio,
    p_effective_from, p_effective_to, p_is_enabled, auth.uid()
  )
  on conflict(profile_id) do update set
    source_store_id = excluded.source_store_id,
    target_store_id = excluded.target_store_id,
    punch_scope = excluded.punch_scope,
    target_ratio = excluded.target_ratio,
    effective_from = excluded.effective_from,
    effective_to = excluded.effective_to,
    is_enabled = excluded.is_enabled,
    updated_by = excluded.updated_by,
    updated_at = now();

  return p_profile_id;
end;
$$;

-- Existing business rule: when 李天欣 is scheduled at 西直门 and has any
-- fieldwork punch that day, allocate 50% to 五道口. The guarded lookup makes
-- this a no-op in environments that do not contain the matching records.
insert into public.payroll_attendance_allocation_rules(
  profile_id, source_store_id, target_store_id, punch_scope, target_ratio,
  effective_from, effective_to, is_enabled
)
select profile.id, source_store.id, target_store.id, 'any', 0.5,
  date '2026-01-01', null, true
from lateral (
  select id from public.profiles
  where regexp_replace(display_name, '[[:space:]]+', '', 'g') = '李天欣'
    and is_active and deleted_at is null
  order by created_at limit 1
) profile
cross join lateral (
  select id from public.stores
  where is_active and (name like '%西直门%' or short_name like '%西直门%')
  order by name limit 1
) source_store
cross join lateral (
  select id from public.stores
  where is_active and (name like '%五道口%' or short_name like '%五道口%')
  order by name limit 1
) target_store
on conflict(profile_id) do nothing;

alter function public.admin_payroll_statistics_inputs(date, date)
  rename to admin_payroll_statistics_inputs_before_configurable_fieldwork_allocation;

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
  v_result := public.admin_payroll_statistics_inputs_before_configurable_fieldwork_allocation(p_from, p_to);

  with attendance_rows as (
    select daily.*
    from public.attendance_daily_records daily
    where daily.attendance_date between p_from and p_to
      and public.can_admin_manage_attendance_profile(daily.profile_id)
  ), punch_flags as (
    select daily.profile_id, daily.attendance_date,
      bool_or(
        lower(coalesce(punch.source_type, '')) similar to '%(outside|field|外勤)%'
        or lower(coalesce(punch.location_result, '')) similar to '%(outside|field|外勤)%'
      ) any_fieldwork,
      bool_or(punch.check_type = 'on_duty' and (
        lower(coalesce(punch.source_type, '')) similar to '%(outside|field|外勤)%'
        or lower(coalesce(punch.location_result, '')) similar to '%(outside|field|外勤)%'
      )) on_fieldwork,
      bool_or(punch.check_type = 'off_duty' and (
        lower(coalesce(punch.source_type, '')) similar to '%(outside|field|外勤)%'
        or lower(coalesce(punch.location_result, '')) similar to '%(outside|field|外勤)%'
      )) off_fieldwork
    from attendance_rows daily
    join public.attendance_punch_records punch on punch.daily_record_id = daily.id
    group by daily.profile_id, daily.attendance_date
  ), eligible_days as (
    select row.profile_id, row.attendance_date,
      coalesce(
        max(greatest(extract(epoch from (row.planned_off_at - row.planned_on_at)) / 3600 - 1, 0))
          filter (where row.planned_on_at is not null and row.planned_off_at > row.planned_on_at),
        max(greatest(extract(epoch from (row.actual_off_at - row.actual_on_at)) / 3600 - 1, 0))
          filter (where row.actual_on_at is not null and row.actual_off_at > row.actual_on_at),
        0
      ) attendance_hours,
      bool_or(row.daily_status = 'fieldwork' or row.on_duty_result = 'fieldwork' or row.off_duty_result = 'fieldwork')
        or coalesce(bool_or(flag.any_fieldwork), false) any_fieldwork,
      bool_or(row.on_duty_result = 'fieldwork') or coalesce(bool_or(flag.on_fieldwork), false) on_fieldwork,
      bool_or(row.off_duty_result = 'fieldwork') or coalesce(bool_or(flag.off_fieldwork), false) off_fieldwork
    from attendance_rows row
    left join punch_flags flag using(profile_id, attendance_date)
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
  ), day_rules as (
    select day.*,
      rule.profile_id rule_profile_id,
      rule.source_store_id,
      rule.target_store_id,
      rule.target_ratio
    from eligible_days day
    left join public.payroll_attendance_allocation_rules rule
      on rule.profile_id = day.profile_id
      and rule.is_enabled
      and day.attendance_date >= rule.effective_from
      and (rule.effective_to is null or day.attendance_date <= rule.effective_to)
      and exists (
        select 1 from scheduled_stores scheduled
        where scheduled.profile_id = day.profile_id
          and scheduled.attendance_date = day.attendance_date
          and scheduled.store_id = rule.source_store_id
      )
      and case rule.punch_scope
        when 'on_duty' then day.on_fieldwork
        when 'off_duty' then day.off_fieldwork
        else day.any_fieldwork
      end
  ), day_weights as (
    select day.profile_id, day.attendance_date, day.source_store_id store_id,
      1 - day.target_ratio weight
    from day_rules day where day.rule_profile_id is not null
    union all
    select day.profile_id, day.attendance_date, day.target_store_id store_id,
      day.target_ratio weight
    from day_rules day where day.rule_profile_id is not null
    union all
    select day.profile_id, day.attendance_date, store.store_id,
      1.0 / nullif(store_count.store_count, 0) weight
    from day_rules day
    join day_stores store using(profile_id, attendance_date)
    join day_store_counts store_count using(profile_id, attendance_date)
    where day.rule_profile_id is null
  ), allocated_attendance as (
    select date_trunc('month', day.attendance_date)::date payroll_month,
      day.profile_id, weight.store_id,
      round(sum(day.attendance_hours * weight.weight), 4) attendance_hours
    from eligible_days day
    join day_weights weight using(profile_id, attendance_date)
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

revoke all on table public.payroll_attendance_allocation_rules from anon;
revoke insert, update, delete on table public.payroll_attendance_allocation_rules from authenticated;
revoke all on function public.admin_save_payroll_attendance_allocation_rule(uuid,uuid,uuid,text,numeric,date,date,boolean) from public, anon;
grant execute on function public.admin_save_payroll_attendance_allocation_rule(uuid,uuid,uuid,text,numeric,date,date,boolean) to authenticated;
revoke all on function public.admin_payroll_statistics_inputs_before_configurable_fieldwork_allocation(date,date) from public, anon, authenticated;
revoke all on function public.admin_payroll_statistics_inputs(date,date) from public, anon;
grant execute on function public.admin_payroll_statistics_inputs(date,date) to authenticated;

comment on table public.payroll_attendance_allocation_rules is
  'Administrator-maintained employee rules that split scheduled hours and salary cost when fieldwork punches occur.';
comment on function public.admin_save_payroll_attendance_allocation_rule(uuid,uuid,uuid,text,numeric,date,date,boolean) is
  'Validates and saves one configurable fieldwork payroll allocation rule per employee.';
comment on function public.admin_payroll_statistics_inputs(date,date) is
  'Returns payroll statistics using configurable fieldwork allocation rules before location-based fallback allocation.';
