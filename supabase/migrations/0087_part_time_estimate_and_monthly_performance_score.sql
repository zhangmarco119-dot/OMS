-- Fix the compact part-time estimate payload and replace the legacy persistent
-- performance amount override with a score override scoped to one payroll month.

create table public.payroll_performance_overrides (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  payroll_month date not null,
  performance_score numeric(5,2) not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_performance_overrides_month_check
    check (payroll_month = date_trunc('month', payroll_month)::date),
  constraint payroll_performance_overrides_score_check
    check (performance_score between 0 and 100),
  unique (profile_id, payroll_month)
);

create trigger payroll_performance_overrides_touch_updated_at
before update on public.payroll_performance_overrides
for each row execute function public.touch_updated_at();

alter table public.payroll_performance_overrides enable row level security;

create policy payroll_performance_overrides_admin_select
on public.payroll_performance_overrides
for select to authenticated
using (
  public.current_user_role() = 'admin'
  and public.can_admin_manage_attendance_profile(profile_id)
);

grant select on public.payroll_performance_overrides to authenticated;

-- The old fields represented an amount and were stored on a long-lived salary
-- rule. They are retained only for schema compatibility and are no longer used.
update public.payroll_employee_rules
set performance_override_enabled = false,
    performance_override_amount = 0
where performance_override_enabled or performance_override_amount <> 0;

create or replace function public.admin_save_payroll_employee_rule(
  p_profile_id uuid,
  p_fields jsonb,
  p_store_ids uuid[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_rule_id uuid;
begin
  v_rule_id := public.admin_save_payroll_employee_rule_before_performance_override(
    p_profile_id,
    p_fields - 'performanceOverrideEnabled' - 'performanceOverrideAmount',
    p_store_ids
  );
  update public.payroll_employee_rules
  set performance_override_enabled = false,
      performance_override_amount = 0
  where id = v_rule_id;
  return v_rule_id;
end;
$$;

create function public.admin_save_payroll_performance_override(
  p_profile_id uuid,
  p_payroll_month date,
  p_performance_score numeric default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_payroll_month)::date;
  v_row public.payroll_performance_overrides;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator permission required';
  end if;
  if not public.can_admin_manage_attendance_profile(p_profile_id) then
    raise exception 'payroll profile access denied';
  end if;
  if p_performance_score is not null and (p_performance_score < 0 or p_performance_score > 100) then
    raise exception 'performance score must be between 0 and 100';
  end if;

  if p_performance_score is null then
    delete from public.payroll_performance_overrides
    where profile_id = p_profile_id and payroll_month = v_month;
    return jsonb_build_object(
      'profileId', p_profile_id,
      'payrollMonth', v_month,
      'performanceScore', null,
      'mode', 'automatic'
    );
  end if;

  insert into public.payroll_performance_overrides(
    profile_id, payroll_month, performance_score, created_by
  ) values (
    p_profile_id, v_month, round(p_performance_score, 2), auth.uid()
  )
  on conflict (profile_id, payroll_month) do update
  set performance_score = excluded.performance_score,
      created_by = auth.uid(),
      updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'profileId', v_row.profile_id,
    'payrollMonth', v_row.payroll_month,
    'performanceScore', v_row.performance_score,
    'mode', 'override'
  );
end;
$$;

alter function public.get_payroll_estimate(uuid, date)
  rename to calculate_payroll_estimate_before_monthly_performance_score;

create function public.get_payroll_estimate(
  p_profile_id uuid,
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date)
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles%rowtype;
  v_result jsonb;
  v_month_start date := date_trunc('month', p_as_of)::date;
  v_month_end date := (date_trunc('month', p_as_of) + interval '1 month - 1 day')::date;
  v_hours numeric := 0;
  v_wage numeric := 0;
  v_rate numeric := null;
  v_updated_at timestamptz := null;
  v_override_score numeric := null;
  v_grade text;
  v_coefficient numeric := 0;
  v_old_performance numeric := 0;
  v_new_performance numeric := 0;
  v_delta numeric := 0;
  v_full_days numeric := 0;
  v_attendance_days numeric := 0;
  v_regularization_factor numeric := 1;
  v_full_performance numeric := 0;
  v_performance_enabled boolean := false;
  v_grade_a_min numeric;
  v_grade_b_min numeric;
  v_grade_c_min numeric;
  v_grade_a_coefficient numeric;
  v_grade_b_coefficient numeric;
  v_grade_c_coefficient numeric;
  v_grade_d_coefficient numeric;
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

  if v_profile.employment_type = 'part_time' then
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

    -- Keep this response intentionally compact. The client supplies zero/null
    -- defaults for full-time-only fields, avoiding PostgreSQL's 100-argument
    -- function-call limit while preserving the shared response model.
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
      'overtimeHours', round(v_hours, 2),
      'overtimeUpdatedAt', v_updated_at,
      'performanceCalculationMode', 'automatic',
      'performanceOverrideEnabled', false,
      'performanceOverrideScore', null,
      'performanceReady', true,
      'commissionReady', true,
      'dataComplete', true,
      'incomeSubtotalKnown', round(v_wage, 2),
      'knownEstimatedPayable', round(v_wage, 2),
      'estimatedPayable', round(v_wage, 2),
      'dataIssues', '[]'::jsonb,
      'deductionItems', '[]'::jsonb
    );
  end if;

  v_result := public.calculate_payroll_estimate_before_monthly_performance_score(p_profile_id, p_as_of);
  v_result := v_result || jsonb_build_object(
    'employmentType', 'full_time',
    'partTimeHours', 0,
    'partTimeHourlyRate', null,
    'accruedPartTimeWage', 0,
    'performanceOverrideScore', null
  );

  select override.performance_score
  into v_override_score
  from public.payroll_performance_overrides override
  where override.profile_id = p_profile_id
    and override.payroll_month = v_month_start;

  v_performance_enabled := coalesce((v_result->>'performanceEnabled')::boolean, false);
  if v_override_score is null or not v_performance_enabled then
    return v_result || jsonb_build_object(
      'performanceOverrideEnabled', false,
      'performanceCalculationMode', 'automatic'
    );
  end if;

  select
    rule.grade_a_min, rule.grade_b_min, rule.grade_c_min,
    rule.grade_a_coefficient, rule.grade_b_coefficient,
    rule.grade_c_coefficient, rule.grade_d_coefficient
  into
    v_grade_a_min, v_grade_b_min, v_grade_c_min,
    v_grade_a_coefficient, v_grade_b_coefficient,
    v_grade_c_coefficient, v_grade_d_coefficient
  from public.payroll_performance_rules rule
  where rule.effective_from <= p_as_of
    and (rule.effective_to is null or rule.effective_to >= v_month_start)
  order by rule.effective_from desc, rule.created_at desc
  limit 1;

  if v_override_score >= v_grade_a_min then
    v_grade := 'A'; v_coefficient := v_grade_a_coefficient;
  elsif v_override_score >= v_grade_b_min then
    v_grade := 'B'; v_coefficient := v_grade_b_coefficient;
  elsif v_override_score >= v_grade_c_min then
    v_grade := 'C'; v_coefficient := v_grade_c_coefficient;
  else
    v_grade := 'D'; v_coefficient := v_grade_d_coefficient;
  end if;

  v_old_performance := coalesce(nullif(v_result->>'accruedPerformance', '')::numeric, 0);
  v_full_performance := coalesce(nullif(v_result->>'fullPerformanceAmount', '')::numeric, 0);
  v_full_days := coalesce(nullif(v_result->>'fullAttendanceDays', '')::numeric, 0);
  v_attendance_days := coalesce(nullif(v_result->>'attendanceDays', '')::numeric, 0);
  v_regularization_factor := coalesce(nullif(v_result->>'regularizationFactor', '')::numeric, 1);
  v_new_performance := case when v_full_days > 0
    then round(v_full_performance * v_coefficient * least(v_attendance_days / v_full_days, 1) * v_regularization_factor, 2)
    else 0 end;
  v_delta := v_new_performance - v_old_performance;

  v_result := v_result || jsonb_build_object(
    'performanceOverrideEnabled', true,
    'performanceOverrideScore', round(v_override_score, 2),
    'performanceCalculationMode', 'override',
    'performanceScore', round(v_override_score, 2),
    'performanceGrade', v_grade,
    'performanceReady', true,
    'accruedPerformance', v_new_performance,
    'incomeSubtotalKnown', round(coalesce((v_result->>'incomeSubtotalKnown')::numeric, 0) + v_delta, 2),
    'knownEstimatedPayable', round(coalesce((v_result->>'knownEstimatedPayable')::numeric, 0) + v_delta, 2),
    'estimatedPayable', case when v_result->>'estimatedPayable' is null then null else round((v_result->>'estimatedPayable')::numeric + v_delta, 2) end
  );

  return v_result;
end;
$$;

revoke all on function public.calculate_payroll_estimate_before_monthly_performance_score(uuid, date) from public, anon, authenticated;
revoke all on function public.admin_save_payroll_performance_override(uuid, date, numeric) from public, anon;
revoke all on function public.admin_save_payroll_employee_rule(uuid, jsonb, uuid[]) from public, anon;
revoke all on function public.get_payroll_estimate(uuid, date) from public, anon;
grant execute on function public.admin_save_payroll_performance_override(uuid, date, numeric) to authenticated;
grant execute on function public.admin_save_payroll_employee_rule(uuid, jsonb, uuid[]) to authenticated;
grant execute on function public.get_payroll_estimate(uuid, date) to authenticated;
