-- Optional full-attendance bonus for employee payroll rules.
-- The bonus becomes part of accrued performance pay once the current month's
-- attended days reach the configured full-attendance day count.

alter table public.payroll_employee_rules
  add column full_attendance_bonus_enabled boolean not null default false,
  add column full_attendance_bonus_amount numeric(12,2) not null default 0;

alter table public.payroll_employee_rules
  add constraint payroll_employee_rules_full_attendance_bonus_amount_check
  check (full_attendance_bonus_amount >= 0);

create or replace function public.admin_save_payroll_employee_rule(
  p_profile_id uuid,
  p_fields jsonb,
  p_store_ids uuid[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_effective_from date := coalesce((p_fields->>'effectiveFrom')::date, (now() at time zone 'Asia/Shanghai')::date);
  v_effective_to date;
  v_rule_id uuid;
  v_store_id uuid;
  v_bonus_enabled boolean := coalesce((p_fields->>'fullAttendanceBonusEnabled')::boolean, false);
  v_bonus_amount numeric := coalesce(nullif(p_fields->>'fullAttendanceBonusAmount', '')::numeric, 0);
begin
  if not public.can_admin_manage_attendance_profile(p_profile_id) then raise exception 'payroll profile access denied'; end if;
  if v_bonus_amount < 0 then raise exception 'full attendance bonus amount must not be negative'; end if;
  if v_bonus_enabled and v_bonus_amount <= 0 then raise exception 'full attendance bonus amount is required'; end if;
  foreach v_store_id in array coalesce(p_store_ids, '{}'::uuid[]) loop
    if not public.has_store_access(v_store_id) then raise exception 'payroll store access denied'; end if;
  end loop;
  select min(effective_from) - 1 into v_effective_to from public.payroll_employee_rules
    where profile_id = p_profile_id and effective_from > v_effective_from;
  update public.payroll_employee_rules set effective_to = v_effective_from - 1
    where profile_id = p_profile_id and effective_from < v_effective_from and (effective_to is null or effective_to >= v_effective_from);
  insert into public.payroll_employee_rules(
    profile_id, monthly_base_salary, monthly_housing_allowance, full_performance_amount,
    commission_rate, housing_enabled, performance_enabled, commission_enabled,
    full_attendance_bonus_enabled, full_attendance_bonus_amount,
    confirmed, effective_from, effective_to, change_reason, created_by
  ) values (
    p_profile_id, coalesce((p_fields->>'monthlyBaseSalary')::numeric, 0),
    coalesce((p_fields->>'monthlyHousingAllowance')::numeric, 0), nullif(p_fields->>'fullPerformanceAmount', '')::numeric,
    nullif(p_fields->>'commissionRate', '')::numeric, coalesce((p_fields->>'housingEnabled')::boolean, false),
    coalesce((p_fields->>'performanceEnabled')::boolean, false), coalesce((p_fields->>'commissionEnabled')::boolean, false),
    v_bonus_enabled, v_bonus_amount,
    coalesce((p_fields->>'confirmed')::boolean, false), v_effective_from, v_effective_to,
    trim(coalesce(p_fields->>'changeReason', '')), auth.uid()
  ) on conflict (profile_id, effective_from) do update set
    monthly_base_salary = excluded.monthly_base_salary, monthly_housing_allowance = excluded.monthly_housing_allowance,
    full_performance_amount = excluded.full_performance_amount, commission_rate = excluded.commission_rate,
    housing_enabled = excluded.housing_enabled, performance_enabled = excluded.performance_enabled,
    commission_enabled = excluded.commission_enabled,
    full_attendance_bonus_enabled = excluded.full_attendance_bonus_enabled,
    full_attendance_bonus_amount = excluded.full_attendance_bonus_amount,
    confirmed = excluded.confirmed,
    effective_to = excluded.effective_to, change_reason = excluded.change_reason,
    created_by = excluded.created_by, created_at = now()
  returning id into v_rule_id;
  delete from public.payroll_employee_commission_stores where rule_id = v_rule_id;
  insert into public.payroll_employee_commission_stores(rule_id, store_id)
    select v_rule_id, store_id from unnest(coalesce(p_store_ids, '{}'::uuid[])) store_id;
  return v_rule_id;
end;
$$;

alter function public.get_payroll_estimate(uuid, date)
  rename to calculate_payroll_estimate_before_attendance_bonus;

create function public.get_payroll_estimate(
  p_profile_id uuid,
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date)
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_rule_id uuid;
  v_enabled boolean := false;
  v_amount numeric := 0;
  v_awarded boolean := false;
  v_bonus numeric := 0;
  v_attendance_days integer := 0;
  v_full_days integer := 0;
  v_old_performance numeric;
  v_old_estimated numeric;
begin
  v_result := public.calculate_payroll_estimate_before_attendance_bonus(p_profile_id, p_as_of);
  if nullif(v_result->>'ruleId', '') is not null then
    v_rule_id := (v_result->>'ruleId')::uuid;
    select rule.full_attendance_bonus_enabled, rule.full_attendance_bonus_amount
      into v_enabled, v_amount
    from public.payroll_employee_rules rule
    where rule.id = v_rule_id;
  end if;

  v_enabled := coalesce(v_enabled, false);
  v_amount := coalesce(v_amount, 0);
  v_attendance_days := coalesce((v_result->>'attendanceDays')::integer, 0);
  v_full_days := coalesce((v_result->>'fullAttendanceDays')::integer, 0);
  v_awarded := v_enabled and v_full_days > 0 and v_attendance_days >= v_full_days;
  v_bonus := case when v_awarded then v_amount else 0 end;

  v_result := jsonb_set(v_result, '{fullAttendanceBonusEnabled}', to_jsonb(v_enabled), true);
  v_result := jsonb_set(v_result, '{fullAttendanceBonusAmount}', to_jsonb(round(v_amount, 2)), true);
  v_result := jsonb_set(v_result, '{fullAttendanceBonusAwarded}', to_jsonb(v_awarded), true);
  v_result := jsonb_set(v_result, '{accruedFullAttendanceBonus}', to_jsonb(round(v_bonus, 2)), true);

  if v_bonus > 0 then
    v_old_performance := nullif(v_result->>'accruedPerformance', '')::numeric;
    v_result := jsonb_set(v_result, '{accruedPerformance}', to_jsonb(round(coalesce(v_old_performance, 0) + v_bonus, 2)), true);
    v_result := jsonb_set(v_result, '{incomeSubtotalKnown}', to_jsonb(round(coalesce((v_result->>'incomeSubtotalKnown')::numeric, 0) + v_bonus, 2)), true);
    v_result := jsonb_set(v_result, '{knownEstimatedPayable}', to_jsonb(round(coalesce((v_result->>'knownEstimatedPayable')::numeric, 0) + v_bonus, 2)), true);
    v_old_estimated := nullif(v_result->>'estimatedPayable', '')::numeric;
    if v_old_estimated is not null then
      v_result := jsonb_set(v_result, '{estimatedPayable}', to_jsonb(round(v_old_estimated + v_bonus, 2)), true);
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.calculate_payroll_estimate_before_attendance_bonus(uuid,date) from public, anon, authenticated;
revoke all on function public.admin_save_payroll_employee_rule(uuid,jsonb,uuid[]), public.get_payroll_estimate(uuid,date) from public, anon;
grant execute on function public.admin_save_payroll_employee_rule(uuid,jsonb,uuid[]), public.get_payroll_estimate(uuid,date) to authenticated;
