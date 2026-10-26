-- Dated memberships drive performance and work allocation; historical estimates
-- use their own dates, independent of the employee's current access list.
create function public.payroll_membership_store(p_profile_id uuid,p_date date,p_candidate uuid)
returns uuid language sql stable security definer set search_path=public as $$
  select case when bool_or(store_id=p_candidate) then p_candidate when count(*)=1 then min(store_id::text)::uuid else null end
  from public.profile_store_ids_on(p_profile_id,p_date);
$$;

create function public.payroll_primary_store_on(p_profile_id uuid,p_date date)
returns uuid language sql stable security definer set search_path=public as $$
  select store_id from public.profile_store_assignment_periods where profile_id=p_profile_id and effective_from<=p_date and (effective_to is null or effective_to>p_date) order by is_primary desc,effective_from,store_id limit 1;
$$;

create function public.payroll_performance_store_scope(p_profile_id uuid,p_rule_id uuid,p_as_of date)
returns table(store_id uuid,allocation_ratio numeric) language sql stable security definer set search_path=public as $$
  with dates as (select generate_series(date_trunc('month',p_as_of)::date,p_as_of,'1 day'::interval)::date work_date),
  weights as (
    select dates.work_date,scope.store_id,coalesce(config.allocation_ratio,1) weight
    from dates cross join lateral public.profile_store_ids_on(p_profile_id,dates.work_date) scope
    left join public.payroll_employee_performance_stores config on config.rule_id=p_rule_id and config.store_id=scope.store_id
    where config.store_id is not null or not exists(
      select 1 from public.profile_store_ids_on(p_profile_id,dates.work_date) active_scope
      join public.payroll_employee_performance_stores active_config on active_config.rule_id=p_rule_id and active_config.store_id=active_scope.store_id
    )
  ), daily as (select *,weight/sum(weight) over(partition by work_date) ratio from weights)
  select daily.store_id,sum(ratio)/(select count(distinct work_date) from daily) from daily group by daily.store_id;
$$;

create or replace function public.calculate_payroll_estimate_before_estimated_individual_tax(
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
create or replace function public.admin_save_payroll_monthly_performance(
  p_profile_id uuid,
  p_payroll_month date,
  p_store_settings jsonb default '[]'::jsonb,
  p_final_amount numeric default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_payroll_month)::date;
  v_setting jsonb;
  v_store_id uuid;
  v_mode text;
  v_score numeric;
  v_grade text;
  v_store_count integer := 0;
  v_explicit_count integer := 0;
begin
  if public.current_user_role() <> 'admin' or not public.can_admin_manage_attendance_profile(p_profile_id) then
    raise exception 'payroll profile access denied';
  end if;
  if p_final_amount is not null and p_final_amount < 0 then raise exception 'performance amount must not be negative'; end if;
  if jsonb_typeof(coalesce(p_store_settings, '[]'::jsonb)) <> 'array' then raise exception 'store settings must be an array'; end if;

  select count(distinct store_id) into v_store_count from public.profile_store_assignment_periods where profile_id = p_profile_id and effective_from < (v_month+interval '1 month')::date and (effective_to is null or effective_to > v_month);
  if v_store_count = 0 then raise exception 'employee has no assigned store'; end if;


  delete from public.payroll_store_performance_overrides
  where profile_id = p_profile_id and payroll_month = v_month;

  for v_setting in select value from jsonb_array_elements(coalesce(p_store_settings, '[]'::jsonb)) loop
    v_store_id := nullif(v_setting->>'storeId', '')::uuid;
    v_mode := coalesce(nullif(v_setting->>'mode', ''), 'automatic');
    v_score := nullif(v_setting->>'score', '')::numeric;
    v_grade := upper(nullif(v_setting->>'grade', ''));
    if v_store_id is null or not exists(
      select 1 from public.profile_store_assignment_periods where profile_id = p_profile_id and effective_from < (v_month+interval '1 month')::date and (effective_to is null or effective_to > v_month) and store_id = v_store_id
    ) or not public.has_store_access(v_store_id) then raise exception 'performance store access denied'; end if;
    if v_mode not in ('automatic', 'score', 'grade') then raise exception 'invalid performance override mode'; end if;
    if v_mode = 'score' and (v_score is null or v_score < 0 or v_score > 100) then raise exception 'performance score must be between 0 and 100'; end if;
    if v_mode = 'grade' and coalesce(v_grade, '') not in ('A', 'B', 'C', 'D') then raise exception 'performance grade must be A, B, C or D'; end if;
    if v_mode <> 'automatic' then
      insert into public.payroll_store_performance_overrides(
        profile_id, payroll_month, store_id, override_mode, performance_score, performance_grade, updated_by
      ) values(
        p_profile_id, v_month, v_store_id, v_mode,
        case when v_mode = 'score' then round(v_score, 2) end,
        case when v_mode = 'grade' then v_grade end,
        auth.uid()
      );
      v_explicit_count := v_explicit_count + 1;
    end if;
  end loop;

  if p_final_amount is not null and v_explicit_count <> v_store_count then
    raise exception 'set every store performance grade or score before overriding the final amount';
  end if;
  if p_final_amount is null then
    delete from public.payroll_performance_amount_overrides where profile_id = p_profile_id and payroll_month = v_month;
  else
    insert into public.payroll_performance_amount_overrides(profile_id, payroll_month, amount, updated_by)
    values(p_profile_id, v_month, round(p_final_amount, 2), auth.uid())
    on conflict(profile_id, payroll_month) do update
    set amount = excluded.amount, updated_by = auth.uid(), updated_at = now();
  end if;

  return jsonb_build_object('profileId', p_profile_id, 'payrollMonth', v_month,
    'storeOverrideCount', v_explicit_count, 'finalAmount', p_final_amount);
end;
$$;
create or replace function public.admin_payroll_statistics_inputs(p_from date, p_to date)
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
    select distinct row.profile_id, row.attendance_date,public.payroll_membership_store(row.profile_id,row.attendance_date,row.store_id) store_id
    from attendance_rows row
    join eligible_days day using(profile_id, attendance_date)
    where row.is_attended and public.has_store_access(row.store_id)
  ), punch_stores as (
    select distinct row.profile_id, row.attendance_date,
      public.payroll_membership_store(row.profile_id,row.attendance_date,public.payroll_resolve_attendance_store(punch.store_id,punch.location_name)) store_id
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
      and exists(select 1 from public.profile_store_ids_on(day.profile_id,day.attendance_date) scope where scope.store_id=rule.source_store_id)
      and exists(select 1 from public.profile_store_ids_on(day.profile_id,day.attendance_date) scope where scope.store_id=rule.target_store_id)
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

revoke all on function public.payroll_primary_store_on(uuid,date),public.payroll_membership_store(uuid,date,uuid),public.payroll_performance_store_scope(uuid,uuid,date) from public,anon,authenticated;

-- A store ended before this month no longer blocks commission on missing revenue.
CREATE OR REPLACE FUNCTION public.calculate_payroll_estimate_before_award_separation(p_profile_id uuid, p_as_of date DEFAULT ((now() AT TIME ZONE 'Asia/Shanghai'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
  v_rule_id uuid;
  v_rate numeric;
  v_required integer := 0;
  v_revenue numeric := 0;
  v_ready boolean := false;
  v_old_commission numeric := 0;
  v_new_commission numeric;
  v_delta numeric := 0;
  v_known numeric := 0;
  v_complete boolean := false;
  v_issues jsonb := '[]'::jsonb;
  v_updated timestamptz;
  v_effective_date date;
begin
  v_result := public.calculate_payroll_estimate_before_revenue_carry_forward(p_profile_id, p_as_of);
  if not coalesce((v_result->>'commissionEnabled')::boolean, false)
    or nullif(v_result->>'ruleId', '') is null then
    v_result := jsonb_set(v_result, '{revenueEffectiveDate}', 'null'::jsonb, true);
    v_result := jsonb_set(v_result, '{revenueCarriedForward}', 'false'::jsonb, true);
    return v_result;
  end if;

  v_rule_id := (v_result->>'ruleId')::uuid;
  v_rate := nullif(v_result->>'commissionRate', '')::numeric;

  with store_values as (
    select scope.store_id,
      case
        when latest_input.input_mode = 'manual' then latest_input.manual_cumulative_amount
        else daily.amount
      end amount,
      case
        when latest_input.input_mode = 'manual' then latest_input.manual_cumulative_amount is not null
        else daily.effective_date is not null
      end ready,
      case
        when latest_input.input_mode = 'manual' then latest_input.as_of_date
        else daily.effective_date
      end effective_date,
      greatest(latest_input.updated_at, daily.updated_at) updated_at
    from public.payroll_employee_commission_stores scope
    left join lateral (
      select input.as_of_date, input.input_mode, input.manual_cumulative_amount, input.updated_at
      from public.payroll_store_revenue_inputs input
      where input.store_id = scope.store_id
        and input.as_of_date between date_trunc('month', p_as_of)::date and p_as_of
      order by input.as_of_date desc, input.updated_at desc
      limit 1
    ) latest_input on true
    left join lateral (
      select coalesce(sum(revenue.confirmed_amount), 0) amount,
        max(revenue.revenue_date) effective_date,
        max(revenue.updated_at) updated_at
      from public.payroll_store_revenues revenue
      where revenue.store_id = scope.store_id
        and revenue.revenue_date between date_trunc('month', p_as_of)::date and p_as_of
    ) daily on true
    where scope.rule_id = v_rule_id
      and exists(select 1 from public.profile_store_assignment_periods membership where membership.profile_id=p_profile_id and membership.store_id=scope.store_id and membership.effective_from <= p_as_of and (membership.effective_to is null or membership.effective_to>date_trunc('month',p_as_of)::date))
  )
  select count(*)::integer,
    coalesce(sum(amount), 0),
    coalesce(bool_and(ready), false),
    max(updated_at),
    min(effective_date)
  into v_required, v_revenue, v_ready, v_updated, v_effective_date
  from store_values;

  v_ready := v_required > 0 and v_ready and v_rate is not null;
  v_old_commission := coalesce(nullif(v_result->>'accruedCommission', '')::numeric, 0);
  v_new_commission := case when v_ready then round(v_revenue * v_rate, 2) end;
  v_delta := coalesce(v_new_commission, 0) - v_old_commission;
  v_known := round(coalesce((v_result->>'knownEstimatedPayable')::numeric, 0) + v_delta, 2);

  select coalesce(jsonb_agg(issue), '[]'::jsonb)
  into v_issues
  from jsonb_array_elements_text(coalesce(v_result->'dataIssues', '[]'::jsonb)) issue
  where issue <> '营业收入待更新';
  if not v_ready then
    v_issues := v_issues || jsonb_build_array('营业收入待更新');
  end if;

  v_complete := coalesce((v_result->>'ruleConfirmed')::boolean, false)
    and coalesce((v_result->>'performanceReady')::boolean, false)
    and v_ready;

  v_result := jsonb_set(v_result, '{revenueTotal}', to_jsonb(round(v_revenue, 2)), true);
  v_result := jsonb_set(v_result, '{revenueEffectiveDate}', coalesce(to_jsonb(v_effective_date), 'null'::jsonb), true);
  v_result := jsonb_set(v_result, '{revenueCarriedForward}', to_jsonb(v_ready and v_effective_date < p_as_of), true);
  v_result := jsonb_set(v_result, '{commissionReady}', to_jsonb(v_ready), true);
  v_result := jsonb_set(v_result, '{accruedCommission}', coalesce(to_jsonb(v_new_commission), 'null'::jsonb), true);
  v_result := jsonb_set(v_result, '{incomeSubtotalKnown}', to_jsonb(round(coalesce((v_result->>'incomeSubtotalKnown')::numeric, 0) + v_delta, 2)), true);
  v_result := jsonb_set(v_result, '{knownEstimatedPayable}', to_jsonb(v_known), true);
  v_result := jsonb_set(v_result, '{estimatedPayable}', case when v_complete then to_jsonb(v_known) else 'null'::jsonb end, true);
  v_result := jsonb_set(v_result, '{dataComplete}', to_jsonb(v_complete), true);
  v_result := jsonb_set(v_result, '{dataIssues}', v_issues, true);
  if v_updated is not null then
    v_result := jsonb_set(v_result, '{revenueUpdatedAt}', to_jsonb(v_updated), true);
  end if;
  return v_result;
end;
$function$;
