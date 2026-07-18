-- Add a part-time employment type without changing the existing authorization
-- roles. Part-time accounts remain staff accounts for RLS and task access, but
-- their payroll consists only of approved part-time hours.

alter table public.profiles
  add column employment_type text not null default 'full_time',
  add constraint profiles_employment_type_check
    check (employment_type in ('full_time', 'part_time'));

create index profiles_employment_type_idx
  on public.profiles(employment_type)
  where deleted_at is null and is_active;

alter function public.get_payroll_estimate(uuid, date)
  rename to calculate_payroll_estimate_before_part_time;

create function public.get_payroll_estimate(
  p_profile_id uuid,
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date)
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles%rowtype;
  v_month_start date := date_trunc('month', p_as_of)::date;
  v_month_end date := (date_trunc('month', p_as_of) + interval '1 month - 1 day')::date;
  v_hours numeric := 0;
  v_wage numeric := 0;
  v_rate numeric := null;
  v_updated_at timestamptz := null;
  v_result jsonb;
begin
  if p_as_of > (now() at time zone 'Asia/Shanghai')::date then
    raise exception 'payroll estimate date cannot be in the future';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_profile_id and deleted_at is null;

  if not found then raise exception 'payroll profile not found'; end if;
  if p_profile_id <> auth.uid() and not public.can_admin_manage_attendance_profile(p_profile_id) then
    raise exception 'payroll estimate access denied';
  end if;

  if v_profile.employment_type <> 'part_time' then
    v_result := public.calculate_payroll_estimate_before_part_time(p_profile_id, p_as_of);
    return v_result || jsonb_build_object(
      'employmentType', 'full_time',
      'partTimeHours', 0,
      'partTimeHourlyRate', null,
      'accruedPartTimeWage', 0
    );
  end if;

  select
    coalesce(sum(request.hours), 0),
    coalesce(sum(request.hours * request.approved_hourly_rate), 0),
    max(request.approved_hourly_rate),
    max(request.updated_at)
  into v_hours, v_wage, v_rate, v_updated_at
  from public.payroll_overtime_requests request
  where request.profile_id = p_profile_id
    and request.status = 'approved'
    and request.overtime_date between v_month_start and p_as_of;

  return jsonb_build_object(
    'profileId', v_profile.id,
    'displayName', v_profile.display_name,
    'username', v_profile.username,
    'primaryStoreId', v_profile.store_id,
    'asOf', p_as_of,
    'monthStart', v_month_start,
    'monthEnd', v_month_end,
    'employmentType', 'part_time',
    'partTimeHours', round(v_hours, 2),
    'partTimeHourlyRate', v_rate,
    'accruedPartTimeWage', round(v_wage, 2),
    'fullAttendanceDays', 0,
    'attendanceDays', 0,
    'ruleId', null,
    'ruleConfirmed', true,
    'monthlyBaseSalary', null,
    'monthlyHousingAllowance', null,
    'fullPerformanceAmount', null,
    'commissionRate', null,
    'housingEnabled', false,
    'performanceEnabled', false,
    'performanceOverrideEnabled', false,
    'performanceOverrideAmount', 0,
    'performanceCalculationMode', 'automatic',
    'commissionEnabled', false,
    'fullAttendanceBonusEnabled', false,
    'fullAttendanceBonusAmount', 0,
    'fullAttendanceBonusAwarded', false,
    'accruedFullAttendanceBonus', 0,
    'extraAttendanceDays', 0,
    'extraAttendanceBonusRate', 0,
    'accruedExtraAttendanceBonus', 0,
    'serviceAwardEnabled', false,
    'serviceAwardAmount', 0,
    'accruedServiceAward', 0,
    'extraRewardAmount', 0,
    'accruedExtraReward', 0,
    'regularizationDate', null,
    'eligibleAttendanceDays', 0,
    'regularizationFactor', 0,
    'isProbation', false,
    'accruedBaseSalary', 0,
    'accruedHousingAllowance', 0,
    'accruedPerformance', 0,
    'accruedCommission', 0,
    'overtimeHours', round(v_hours, 2),
    'overtimeHourlyRate', v_rate,
    'accruedOvertime', 0,
    'lateCount', 0,
    'lateMinutes', 0,
    'lateFine', 0,
    'otherFine', 0,
    'fineTotal', 0,
    'individualIncomeTax', 0,
    'deductionTotal', 0,
    'deductionItems', '[]'::jsonb,
    'taskDueCount', 0,
    'taskCompletedCount', 0,
    'taskScore', null,
    'attendanceScore', 0,
    'disciplineScore', 0,
    'performanceScore', null,
    'performanceGrade', null,
    'revenueTotal', 0,
    'revenueEffectiveDate', null,
    'revenueCarriedForward', false,
    'performanceReady', true,
    'commissionReady', true,
    'dataComplete', true,
    'incomeSubtotalKnown', round(v_wage, 2),
    'knownEstimatedPayable', round(v_wage, 2),
    'estimatedPayable', round(v_wage, 2),
    'attendanceUpdatedAt', null,
    'tasksUpdatedAt', null,
    'revenueUpdatedAt', null,
    'penaltiesUpdatedAt', null,
    'overtimeUpdatedAt', v_updated_at,
    'dataIssues', '[]'::jsonb
  );
end;
$$;

create or replace function public.admin_payroll_estimates(
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date),
  p_store_id uuid default null,
  p_search text default ''
)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_result jsonb; v_month_start date:=date_trunc('month',p_as_of)::date; v_month_end date:=(date_trunc('month',p_as_of)+interval '1 month - 1 day')::date;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator permission required'; end if;
  if p_store_id is not null and not public.has_store_access(p_store_id) then raise exception 'store access denied'; end if;
  with targets as (
    select profile.id from public.profiles profile
    where profile.role in ('staff','manager') and profile.is_active and profile.deleted_at is null
      and public.can_admin_manage_attendance_profile(profile.id)
      and (
        profile.employment_type = 'part_time'
        or v_month_start=date_trunc('month',now() at time zone 'Asia/Shanghai')::date
        or profile.created_at::date<=v_month_end
        or exists(select 1 from public.attendance_daily_records daily where daily.profile_id=profile.id and daily.attendance_date between v_month_start and v_month_end)
      )
      and (p_store_id is null or profile.store_id = p_store_id or exists (
        select 1 from public.dingtalk_employee_bindings binding where binding.profile_id = profile.id and binding.store_id = p_store_id and binding.binding_status = 'active'))
      and (trim(coalesce(p_search, '')) = '' or profile.display_name ilike '%' || trim(p_search) || '%' or profile.username ilike '%' || trim(p_search) || '%')
  ), estimates as (select public.get_payroll_estimate(target.id, p_as_of) estimate from targets target)
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(estimate order by estimate->>'displayName'), '[]'::jsonb),
    'employeeCount', count(*), 'completeCount', count(*) filter (where (estimate->>'dataComplete')::boolean),
    'incompleteCount', count(*) filter (where not (estimate->>'dataComplete')::boolean),
    'knownEstimatedTotal', coalesce(sum((estimate->>'knownEstimatedPayable')::numeric), 0),
    'completeEstimatedTotal', coalesce(sum((estimate->>'estimatedPayable')::numeric) filter (where estimate->>'estimatedPayable' is not null), 0)
  ) into v_result from estimates;
  return v_result;
end;
$$;

revoke all on function public.calculate_payroll_estimate_before_part_time(uuid,date) from public,anon,authenticated;
revoke all on function public.get_payroll_estimate(uuid,date), public.admin_payroll_estimates(date,uuid,text) from public,anon;
grant execute on function public.get_payroll_estimate(uuid,date), public.admin_payroll_estimates(date,uuid,text) to authenticated;
