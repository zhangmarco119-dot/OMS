-- Apply dated performance inside the existing departure-month and holiday
-- wrappers. Both wrappers must remain in the historical payroll chain.
CREATE OR REPLACE FUNCTION public.calculate_payroll_estimate_before_estimated_individual_tax(p_profile_id uuid, p_as_of date DEFAULT ((now() AT TIME ZONE 'Asia/Shanghai')::date)) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'private'
    AS $$
declare
 v_result jsonb; v_month date:=date_trunc('month',p_as_of)::date;
 v_dates date[]; v_amount numeric:=0;
begin
 v_result:=public.calculate_payroll_estimate_before_holiday_subsidy(p_profile_id,p_as_of);
 v_dates:=private.payroll_holiday_work_dates(p_profile_id,v_month,p_as_of);
 if cardinality(v_dates)>0 then
  select coalesce(amount,0) into v_amount from private.payroll_holiday_subsidies where profile_id=p_profile_id and payroll_month=v_month;
 end if;
 v_amount:=coalesce(v_amount,0);
 return v_result || jsonb_build_object(
  'holidayAttendanceDates',to_jsonb(v_dates),'holidaySubsidy',v_amount,
  'incomeSubtotalKnown',coalesce((v_result->>'incomeSubtotalKnown')::numeric,0)+v_amount,
  'knownEstimatedPayable',coalesce((v_result->>'knownEstimatedPayable')::numeric,0)+v_amount,
  'estimatedPayable',case when v_result->>'estimatedPayable' is null then null else (v_result->>'estimatedPayable')::numeric+v_amount end
 );
end;
$$;

CREATE OR REPLACE FUNCTION public.calculate_payroll_estimate_before_holiday_subsidy(p_profile_id uuid, p_as_of date DEFAULT ((now() AT TIME ZONE 'Asia/Shanghai'::text))::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_result jsonb;
  v_month date := date_trunc('month', p_as_of)::date;
  v_housing numeric := 0;
  v_performance numeric := 0;
  v_commission numeric := 0;
  v_reduction numeric := 0;
  v_issues jsonb := '[]'::jsonb;
begin
  v_result := public.calculate_payroll_estimate_before_departure_month(p_profile_id, p_as_of);
  if not exists(
    select 1 from public.payroll_employee_departure_months setting
    where setting.profile_id = p_profile_id and setting.payroll_month = v_month
  ) then
    return v_result || jsonb_build_object('departureMonthExcluded', false);
  end if;

  v_housing := coalesce(nullif(v_result->>'accruedHousingAllowance', '')::numeric, 0);
  v_performance := coalesce(nullif(v_result->>'accruedPerformance', '')::numeric, 0);
  v_commission := coalesce(nullif(v_result->>'accruedCommission', '')::numeric, 0);
  v_reduction := round(v_housing + v_performance + v_commission, 2);

  select coalesce(jsonb_agg(issue.value), '[]'::jsonb) into v_issues
  from jsonb_array_elements(coalesce(v_result->'dataIssues', '[]'::jsonb)) issue(value)
  where issue.value #>> '{}' not like '%绩效%'
    and issue.value #>> '{}' not like '%提成%'
    and issue.value #>> '{}' not like '%营业收入%'
    and issue.value #>> '{}' not like '%任务数据%';

  return v_result || jsonb_build_object(
    'departureMonthExcluded', true,
    'accruedHousingAllowance', 0,
    'accruedPerformance', 0,
    'accruedCommission', 0,
    'performanceStores', '[]'::jsonb,
    'hasMultiplePerformanceStores', false,
    'performanceAmountOverrideEnabled', false,
    'performanceAmountOverride', null,
    'performanceOverrideEnabled', false,
    'performanceOverrideAmount', 0,
    'performanceOverrideScore', null,
    'performanceScore', null,
    'performanceGrade', null,
    'performanceReady', true,
    'commissionReady', true,
    'incomeSubtotalKnown', round(greatest(coalesce((v_result->>'incomeSubtotalKnown')::numeric, 0) - v_reduction, 0), 2),
    'knownEstimatedPayable', round(greatest(coalesce((v_result->>'knownEstimatedPayable')::numeric, 0) - v_reduction, 0), 2),
    'estimatedPayable', case when v_result->>'estimatedPayable' is null then null
      else round(greatest((v_result->>'estimatedPayable')::numeric - v_reduction, 0), 2) end,
    'dataIssues', v_issues,
    'dataComplete', jsonb_array_length(v_issues) = 0
  );
end;
$$;

create or replace function public.calculate_payroll_estimate_before_departure_month(
  p_profile_id uuid,
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date)
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb;
  v_month date := date_trunc('month', p_as_of)::date;
  v_rule_id uuid;
  v_config_count integer := 0;
  v_store_count integer := 0;
  v_full_amount numeric := 0;
  v_full_days numeric := 0;
  v_attendance_days numeric := 0;
  v_regularization_factor numeric := 1;
  v_attendance_factor numeric := 0;
  v_discipline_deduction numeric := 0;
  v_old_amount numeric := 0;
  v_new_amount numeric := 0;
  v_final_override numeric := null;
  v_delta numeric := 0;
  v_store record;
  v_override record;
  v_due integer;
  v_completed integer;
  v_late_deduction numeric;
  v_task_score numeric;
  v_attendance_score numeric;
  v_discipline_score numeric;
  v_score numeric;
  v_grade text;
  v_coefficient numeric;
  v_store_amount numeric;
  v_store_results jsonb := '[]'::jsonb;
  v_all_scores boolean := true;
  v_weighted_score numeric := 0;
  v_due_total integer := 0;
  v_completed_total integer := 0;
  v_perf public.payroll_performance_rules%rowtype;
begin
  v_result := public.calculate_payroll_estimate_before_store_performance(p_profile_id, p_as_of)
    || jsonb_build_object('primaryStoreId',public.payroll_primary_store_on(p_profile_id,p_as_of));
  if coalesce(v_result->>'employmentType', 'full_time') = 'part_time'
     or not coalesce((v_result->>'performanceEnabled')::boolean, false) then
    return v_result || jsonb_build_object('performanceStores', '[]'::jsonb, 'hasMultiplePerformanceStores', false,
      'performanceAmountOverrideEnabled', false, 'performanceAmountOverride', null);
  end if;

  v_rule_id := nullif(v_result->>'ruleId', '')::uuid;
  v_full_amount := coalesce(nullif(v_result->>'fullPerformanceAmount', '')::numeric, 0);
  v_full_days := coalesce(nullif(v_result->>'fullAttendanceDays', '')::numeric, 0);
  v_attendance_days := coalesce(nullif(v_result->>'attendanceDays', '')::numeric, 0);
  v_regularization_factor := coalesce(nullif(v_result->>'regularizationFactor', '')::numeric, 1);
  v_attendance_factor := case when v_full_days > 0 then least(v_attendance_days / v_full_days, 1) else 0 end;

  select count(*) into v_config_count from public.payroll_employee_performance_stores where rule_id = v_rule_id;
  select count(*) into v_store_count from public.payroll_performance_store_scope(p_profile_id,v_rule_id,p_as_of);

  -- A legacy single-store employee keeps the existing calculation and monthly
  -- score override until the administrator explicitly saves store allocations.
  if v_store_count <= 1 and v_config_count = 0 and not exists(select 1 from public.profile_store_assignment_periods where profile_id=p_profile_id and effective_to <= p_as_of) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'storeId', store.id, 'storeName', store.name, 'allocationRatio', 1,
      'calculationMode', coalesce(v_result->>'performanceCalculationMode', 'automatic'),
      'score', nullif(v_result->>'performanceScore', '')::numeric,
      'grade', v_result->>'performanceGrade', 'coefficient', null, 'amount', nullif(v_result->>'accruedPerformance', '')::numeric
    )), '[]'::jsonb) into v_store_results
    from public.profiles profile join public.stores store on store.id = public.payroll_primary_store_on(p_profile_id,p_as_of)
    where profile.id = p_profile_id;
    return v_result || jsonb_build_object('performanceStores', v_store_results, 'hasMultiplePerformanceStores', false,
      'performanceAmountOverrideEnabled', false, 'performanceAmountOverride', null);
  end if;

  select * into v_perf from public.payroll_performance_rules rule
  order by case when rule.effective_from <= p_as_of and (rule.effective_to is null or rule.effective_to >= p_as_of) then 0
                when rule.effective_from > p_as_of then 1 else 2 end,
           case when rule.effective_from <= p_as_of then rule.effective_from end desc nulls last,
           rule.effective_from asc limit 1;

  select coalesce(sum(performance_deduction), 0) into v_discipline_deduction
  from public.payroll_penalties
  where profile_id = p_profile_id and event_date between v_month and p_as_of and status = 'active';

  for v_store in
    select scope.store_id,store.name store_name,scope.allocation_ratio
    from public.payroll_performance_store_scope(p_profile_id,v_rule_id,p_as_of) scope
    join public.stores store on store.id=scope.store_id order by store.name
  loop
    select count(*)::integer, count(*) filter(where task.status = 'approved')::integer
    into v_due, v_completed
    from public.v2_tasks task
    where task.store_id = v_store.store_id and task.due_at::date between v_month and p_as_of
      and exists(select 1 from public.profile_store_ids_on(p_profile_id,(task.due_at at time zone 'Asia/Shanghai')::date) scope where scope.store_id=task.store_id)
      and task.status <> 'cancelled'
      and (task.assigned_profile_id = p_profile_id or task.assigned_profile_id is null);

    select coalesce(sum(case when daily.late_minutes between 1 and 10 then v_perf.late_deduction_1_10
      when daily.late_minutes between 11 and 20 then v_perf.late_deduction_11_20
      when daily.late_minutes between 21 and 30 then v_perf.late_deduction_21_30
      when daily.late_minutes >= 31 then v_perf.late_deduction_31_plus else 0 end), 0)
    into v_late_deduction
    from public.attendance_daily_records daily
    where daily.profile_id = p_profile_id and daily.store_id = v_store.store_id
      and daily.attendance_date between v_month and p_as_of
      and exists(select 1 from public.profile_store_ids_on(p_profile_id,daily.attendance_date) scope where scope.store_id=daily.store_id);

    v_task_score := case when v_due > 0 then round(least(v_completed::numeric / v_due, 1) * v_perf.task_weight, 2) else v_perf.task_weight end;
    v_attendance_score := greatest(v_perf.attendance_weight - v_late_deduction, 0);
    v_discipline_score := greatest(v_perf.discipline_weight - v_discipline_deduction, 0);
    v_score := round(v_task_score + v_attendance_score + v_discipline_score, 2);

    select * into v_override from public.payroll_store_performance_overrides setting
    where setting.profile_id = p_profile_id and setting.payroll_month = v_month and setting.store_id = v_store.store_id;
    if found and v_override.override_mode = 'score' then
      v_score := v_override.performance_score;
    elsif found and v_override.override_mode = 'grade' then
      v_score := null;
    end if;

    if found and v_override.override_mode = 'grade' then
      v_grade := v_override.performance_grade;
    elsif v_score >= v_perf.grade_a_min then v_grade := 'A';
    elsif v_score >= v_perf.grade_b_min then v_grade := 'B';
    elsif v_score >= v_perf.grade_c_min then v_grade := 'C';
    else v_grade := 'D'; end if;

    v_coefficient := case v_grade when 'A' then v_perf.grade_a_coefficient when 'B' then v_perf.grade_b_coefficient
      when 'C' then v_perf.grade_c_coefficient else v_perf.grade_d_coefficient end;
    v_store_amount := round(v_full_amount * v_store.allocation_ratio * v_coefficient * v_attendance_factor * v_regularization_factor, 2);
    v_new_amount := v_new_amount + v_store_amount;
    v_due_total := v_due_total + v_due;
    v_completed_total := v_completed_total + v_completed;
    if v_score is null then v_all_scores := false; else v_weighted_score := v_weighted_score + v_score * v_store.allocation_ratio; end if;
    v_store_results := v_store_results || jsonb_build_array(jsonb_build_object(
      'storeId', v_store.store_id, 'storeName', v_store.store_name,
      'allocationRatio', round(v_store.allocation_ratio, 6),
      'calculationMode', case when found then v_override.override_mode else 'automatic' end,
      'score', case when v_score is null then null else round(v_score, 2) end,
      'grade', v_grade, 'coefficient', v_coefficient, 'amount', v_store_amount
    ));
  end loop;

  select amount into v_final_override from public.payroll_performance_amount_overrides
  where profile_id = p_profile_id and payroll_month = v_month;
  if v_final_override is not null then v_new_amount := v_final_override; end if;

  v_old_amount := coalesce(nullif(v_result->>'accruedPerformance', '')::numeric, 0);
  v_delta := round(v_new_amount - v_old_amount, 2);
  return v_result || jsonb_build_object(
    'performanceStores', v_store_results,
    'hasMultiplePerformanceStores', v_store_count > 1,
    'performanceAmountOverrideEnabled', v_final_override is not null,
    'performanceAmountOverride', v_final_override,
    'performanceCalculationMode', case when v_final_override is not null then 'amount_override' else 'store' end,
    'performanceOverrideEnabled', v_final_override is not null,
    'performanceOverrideScore', null,
    'performanceScore', case when v_all_scores then round(v_weighted_score, 2) else null end,
    'performanceGrade', case when v_store_count = 1 then v_store_results->0->>'grade' else null end,
    'taskDueCount', v_due_total,
    'taskCompletedCount', v_completed_total,
    'accruedPerformance', round(v_new_amount, 2),
    'incomeSubtotalKnown', round(coalesce((v_result->>'incomeSubtotalKnown')::numeric, 0) + v_delta, 2),
    'knownEstimatedPayable', round(coalesce((v_result->>'knownEstimatedPayable')::numeric, 0) + v_delta, 2),
    'estimatedPayable', case when v_result->>'estimatedPayable' is null then null else round((v_result->>'estimatedPayable')::numeric + v_delta, 2) end
  );
end;
$$;
