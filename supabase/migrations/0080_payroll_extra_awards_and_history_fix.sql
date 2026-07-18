-- Add extra-attendance and discretionary rewards, and keep historical payroll
-- calculable when payroll/performance configuration was entered after imported
-- attendance records. No historical business rows are changed by this migration.

alter table public.payroll_employee_rules
  add column extra_reward_amount numeric(12,2) not null default 0;

alter table public.payroll_employee_rules
  add constraint payroll_employee_rules_extra_reward_amount_check
  check (extra_reward_amount >= 0);

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
  v_service_enabled boolean := coalesce((p_fields->>'serviceAwardEnabled')::boolean, false);
  v_service_amount numeric := coalesce(nullif(p_fields->>'serviceAwardAmount', '')::numeric, 100);
  v_regularization_date date := nullif(p_fields->>'regularizationDate', '')::date;
  v_extra_reward numeric := coalesce(nullif(p_fields->>'extraRewardAmount', '')::numeric, 0);
begin
  if not public.can_admin_manage_attendance_profile(p_profile_id) then raise exception 'payroll profile access denied'; end if;
  if v_bonus_amount < 0 then raise exception 'full attendance bonus amount must not be negative'; end if;
  if v_bonus_enabled and v_bonus_amount <= 0 then raise exception 'full attendance bonus amount is required'; end if;
  if v_service_amount < 0 then raise exception 'service award amount must not be negative'; end if;
  if v_service_enabled and v_service_amount <= 0 then raise exception 'service award amount is required'; end if;
  if v_extra_reward < 0 then raise exception 'extra reward amount must not be negative'; end if;
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
    service_award_enabled, service_award_amount, regularization_date, extra_reward_amount,
    confirmed, effective_from, effective_to, change_reason, created_by
  ) values (
    p_profile_id, coalesce((p_fields->>'monthlyBaseSalary')::numeric, 0),
    coalesce((p_fields->>'monthlyHousingAllowance')::numeric, 0), nullif(p_fields->>'fullPerformanceAmount', '')::numeric,
    nullif(p_fields->>'commissionRate', '')::numeric, coalesce((p_fields->>'housingEnabled')::boolean, false),
    coalesce((p_fields->>'performanceEnabled')::boolean, false), coalesce((p_fields->>'commissionEnabled')::boolean, false),
    v_bonus_enabled, v_bonus_amount, v_service_enabled, v_service_amount, v_regularization_date, v_extra_reward,
    coalesce((p_fields->>'confirmed')::boolean, false), v_effective_from, v_effective_to,
    trim(coalesce(p_fields->>'changeReason', '')), auth.uid()
  ) on conflict (profile_id, effective_from) do update set
    monthly_base_salary = excluded.monthly_base_salary, monthly_housing_allowance = excluded.monthly_housing_allowance,
    full_performance_amount = excluded.full_performance_amount, commission_rate = excluded.commission_rate,
    housing_enabled = excluded.housing_enabled, performance_enabled = excluded.performance_enabled,
    commission_enabled = excluded.commission_enabled,
    full_attendance_bonus_enabled = excluded.full_attendance_bonus_enabled,
    full_attendance_bonus_amount = excluded.full_attendance_bonus_amount,
    service_award_enabled = excluded.service_award_enabled,
    service_award_amount = excluded.service_award_amount,
    regularization_date = excluded.regularization_date,
    extra_reward_amount = excluded.extra_reward_amount,
    confirmed = excluded.confirmed, effective_to = excluded.effective_to,
    change_reason = excluded.change_reason, created_by = excluded.created_by, created_at = now()
  returning id into v_rule_id;
  delete from public.payroll_employee_commission_stores where rule_id = v_rule_id;
  insert into public.payroll_employee_commission_stores(rule_id, store_id)
    select v_rule_id, store_id from unnest(coalesce(p_store_ids, '{}'::uuid[])) store_id;
  return v_rule_id;
end;
$$;

-- This is the original base calculator used by all later payroll wrappers.
-- The old version returned no row when a selected historical month predated the
-- first performance rule, which erased the employee name and every amount.
create or replace function public.calculate_payroll_estimate_internal(p_profile_id uuid, p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_month_start date := date_trunc('month', p_as_of)::date;
  v_month_end date := (date_trunc('month', p_as_of) + interval '1 month - 1 day')::date;
  v_full_days integer := extract(day from (date_trunc('month', p_as_of) + interval '1 month - 1 day'))::integer - 4;
  v_result jsonb;
begin
  if p_as_of > (now() at time zone 'Asia/Shanghai')::date then raise exception 'future payroll estimates are not allowed'; end if;
  if p_profile_id <> auth.uid() and not public.can_admin_manage_attendance_profile(p_profile_id) then raise exception 'payroll access denied'; end if;

  with employee as (
    select profile.id, profile.display_name, profile.username, profile.store_id
    from public.profiles profile where profile.id = p_profile_id
  ), active_rule as (
    select rule.* from public.payroll_employee_rules rule
    where rule.profile_id = p_profile_id
    order by
      case when rule.effective_from <= p_as_of and (rule.effective_to is null or rule.effective_to >= p_as_of) then 0
           when rule.effective_from > p_as_of then 1 else 2 end,
      case when rule.effective_from <= p_as_of then rule.effective_from end desc nulls last,
      rule.effective_from asc
    limit 1
  ), performance_rule as (
    select rule.* from public.payroll_performance_rules rule
    order by
      case when rule.effective_from <= p_as_of and (rule.effective_to is null or rule.effective_to >= p_as_of) then 0
           when rule.effective_from > p_as_of then 1 else 2 end,
      case when rule.effective_from <= p_as_of then rule.effective_from end desc nulls last,
      rule.effective_from asc
    limit 1
  ), attendance as (
    select count(distinct daily.attendance_date) filter (where daily.is_attended)::integer attendance_days,
      max(daily.last_synced_at) last_synced_at
    from public.attendance_daily_records daily
    where daily.profile_id = p_profile_id and daily.attendance_date between v_month_start and p_as_of
  ), late_events as (
    select count(*) filter (where daily.late_minutes > 0)::integer late_count,
      coalesce(sum(daily.late_minutes) filter (where daily.late_minutes > 0), 0)::integer late_minutes,
      coalesce(sum(case when daily.late_minutes between 1 and 10 then 20 when daily.late_minutes between 11 and 20 then 50 when daily.late_minutes between 21 and 30 then 100 when daily.late_minutes >= 31 then 200 else 0 end), 0)::numeric late_fine,
      coalesce(sum(case when daily.late_minutes between 1 and 10 then perf.late_deduction_1_10 when daily.late_minutes between 11 and 20 then perf.late_deduction_11_20 when daily.late_minutes between 21 and 30 then perf.late_deduction_21_30 when daily.late_minutes >= 31 then perf.late_deduction_31_plus else 0 end), 0)::numeric late_performance_deduction
    from public.attendance_daily_records daily cross join performance_rule perf
    where daily.profile_id = p_profile_id and daily.attendance_date between v_month_start and p_as_of
  ), penalties as (
    select coalesce(sum(amount), 0)::numeric other_fine, coalesce(sum(performance_deduction), 0)::numeric discipline_deduction,
      max(updated_at) last_updated_at
    from public.payroll_penalties
    where profile_id = p_profile_id and event_date between v_month_start and p_as_of and status = 'active'
  ), employee_stores as (
    select employee.store_id from employee
    union select binding.store_id from public.dingtalk_employee_bindings binding where binding.profile_id = p_profile_id and binding.binding_status = 'active'
  ), tasks as (
    select count(*)::integer due_count, count(*) filter (where task.status = 'approved')::integer completed_count, max(task.updated_at) last_updated_at
    from public.v2_tasks task
    where task.due_at::date between v_month_start and p_as_of and task.status <> 'cancelled'
      and (task.assigned_profile_id = p_profile_id or (task.assigned_profile_id is null and task.store_id in (select store_id from employee_stores)))
  ), commission_scope as (
    select store.store_id from public.payroll_employee_commission_stores store join active_rule rule on rule.id = store.rule_id
  ), revenues as (
    select coalesce(sum(revenue.confirmed_amount), 0)::numeric revenue_total,
      count(distinct revenue.store_id) filter (where revenue.revenue_date = p_as_of)::integer stores_with_data,
      (select count(*) from commission_scope)::integer required_store_count, max(revenue.updated_at) last_updated_at
    from public.payroll_store_revenues revenue
    where revenue.store_id in (select store_id from commission_scope) and revenue.revenue_date between v_month_start and p_as_of
  ), calculated as (
    select employee.*, rule.id rule_id, rule.confirmed rule_confirmed,
      rule.monthly_base_salary, rule.monthly_housing_allowance, rule.full_performance_amount, rule.commission_rate,
      rule.housing_enabled, rule.performance_enabled, rule.commission_enabled,
      coalesce(attendance.attendance_days, 0) attendance_days, attendance.last_synced_at attendance_updated_at,
      late_events.late_count, late_events.late_minutes, late_events.late_fine, late_events.late_performance_deduction,
      penalties.other_fine, penalties.discipline_deduction, penalties.last_updated_at penalties_updated_at,
      tasks.due_count, tasks.completed_count, tasks.last_updated_at tasks_updated_at,
      revenues.revenue_total, revenues.last_updated_at revenue_updated_at, revenues.required_store_count, revenues.stores_with_data,
      perf.task_weight, perf.attendance_weight, perf.discipline_weight, perf.grade_a_min, perf.grade_b_min, perf.grade_c_min,
      perf.grade_a_coefficient, perf.grade_b_coefficient, perf.grade_c_coefficient, perf.grade_d_coefficient,
      case when tasks.due_count > 0 then round(least(tasks.completed_count::numeric / tasks.due_count, 1) * perf.task_weight, 2) else perf.task_weight end task_score,
      greatest(perf.attendance_weight - late_events.late_performance_deduction, 0) attendance_score,
      greatest(perf.discipline_weight - penalties.discipline_deduction, 0) discipline_score
    from employee left join active_rule rule on true cross join performance_rule perf cross join attendance cross join late_events cross join penalties cross join tasks cross join revenues
  ), scored as (
    select calculated.*, round(task_score + attendance_score + discipline_score, 2) performance_score,
      round(coalesce(monthly_base_salary, 0) / v_full_days * least(attendance_days, v_full_days), 2) accrued_base_salary,
      round(case when housing_enabled then coalesce(monthly_housing_allowance, 0) / v_full_days * least(attendance_days, v_full_days) else 0 end, 2) accrued_housing_allowance,
      (not performance_enabled or full_performance_amount is not null) performance_ready,
      (not commission_enabled or (commission_rate is not null and required_store_count > 0 and stores_with_data = required_store_count)) commission_ready
    from calculated
  ), amounts as (
    select scored.*,
      case when performance_score >= grade_a_min then 'A' when performance_score >= grade_b_min then 'B' when performance_score >= grade_c_min then 'C' else 'D' end performance_grade,
      case when performance_score >= grade_a_min then grade_a_coefficient when performance_score >= grade_b_min then grade_b_coefficient when performance_score >= grade_c_min then grade_c_coefficient else grade_d_coefficient end performance_coefficient
    from scored
  ), totals as (
    select amounts.*,
      case when performance_enabled and performance_ready then round(full_performance_amount * performance_coefficient * least(attendance_days::numeric / v_full_days, 1), 2) when not performance_enabled then 0 end accrued_performance,
      case when commission_enabled and commission_ready then round(revenue_total * commission_rate, 2) when not commission_enabled then 0 end accrued_commission,
      round(late_fine + other_fine, 2) fine_total
    from amounts
  )
  select jsonb_build_object(
    'profileId', id, 'displayName', display_name, 'username', username, 'primaryStoreId', store_id,
    'asOf', p_as_of, 'monthStart', v_month_start, 'monthEnd', v_month_end, 'fullAttendanceDays', v_full_days,
    'attendanceDays', attendance_days, 'ruleId', rule_id, 'ruleConfirmed', coalesce(rule_confirmed, false),
    'monthlyBaseSalary', monthly_base_salary, 'monthlyHousingAllowance', monthly_housing_allowance,
    'fullPerformanceAmount', full_performance_amount, 'commissionRate', commission_rate,
    'housingEnabled', coalesce(housing_enabled, false), 'performanceEnabled', coalesce(performance_enabled, false), 'commissionEnabled', coalesce(commission_enabled, false),
    'accruedBaseSalary', accrued_base_salary, 'accruedHousingAllowance', accrued_housing_allowance,
    'accruedPerformance', accrued_performance, 'accruedCommission', accrued_commission,
    'lateCount', late_count, 'lateMinutes', late_minutes, 'lateFine', late_fine, 'otherFine', other_fine, 'fineTotal', fine_total,
    'taskDueCount', due_count, 'taskCompletedCount', completed_count, 'taskScore', task_score,
    'attendanceScore', attendance_score, 'disciplineScore', discipline_score, 'performanceScore', performance_score, 'performanceGrade', performance_grade,
    'revenueTotal', revenue_total, 'performanceReady', performance_ready, 'commissionReady', commission_ready,
    'dataComplete', (rule_id is not null and rule_confirmed and performance_ready and commission_ready),
    'incomeSubtotalKnown', round(accrued_base_salary + accrued_housing_allowance + coalesce(accrued_performance, 0) + coalesce(accrued_commission, 0), 2),
    'knownEstimatedPayable', round(accrued_base_salary + accrued_housing_allowance + coalesce(accrued_performance, 0) + coalesce(accrued_commission, 0) - fine_total, 2),
    'estimatedPayable', case when rule_id is not null and rule_confirmed and performance_ready and commission_ready then round(accrued_base_salary + accrued_housing_allowance + coalesce(accrued_performance, 0) + coalesce(accrued_commission, 0) - fine_total, 2) end,
    'attendanceUpdatedAt', attendance_updated_at, 'tasksUpdatedAt', tasks_updated_at, 'revenueUpdatedAt', revenue_updated_at, 'penaltiesUpdatedAt', penalties_updated_at,
    'dataIssues', to_jsonb(array_remove(array[
      case when rule_id is null then '未配置工资参数' when not rule_confirmed then '工资参数待管理员确认' end,
      case when performance_enabled and full_performance_amount is null then '满绩效金额待录入' end,
      case when commission_enabled and not commission_ready then '该月营业收入或提成门店范围待完善' end
    ], null))
  ) into v_result from totals;

  return coalesce(v_result, jsonb_build_object(
    'profileId', p_profile_id,
    'displayName', coalesce((select display_name from public.profiles where id=p_profile_id), '员工'),
    'username', coalesce((select username from public.profiles where id=p_profile_id), ''),
    'asOf', p_as_of, 'monthStart', v_month_start, 'monthEnd', v_month_end,
    'dataComplete', false, 'knownEstimatedPayable', 0, 'estimatedPayable', null,
    'dataIssues', jsonb_build_array('工资计算规则尚未配置')
  ));
end;
$$;

alter function public.get_payroll_estimate(uuid,date)
  rename to calculate_payroll_estimate_before_extra_awards;

create function public.get_payroll_estimate(
  p_profile_id uuid,
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date)
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_result jsonb;
  v_rule_id uuid;
  v_extra_days integer := 0;
  v_extra_attendance_rate numeric := 300;
  v_extra_attendance_bonus numeric := 0;
  v_extra_reward numeric := 0;
  v_delta numeric := 0;
begin
  v_result := public.calculate_payroll_estimate_before_extra_awards(p_profile_id,p_as_of);
  v_extra_days := greatest(coalesce((v_result->>'attendanceDays')::integer,0)-coalesce((v_result->>'fullAttendanceDays')::integer,0),0);
  v_extra_attendance_bonus := v_extra_days * v_extra_attendance_rate;
  if nullif(v_result->>'ruleId','') is not null then
    v_rule_id := (v_result->>'ruleId')::uuid;
    select coalesce(extra_reward_amount,0) into v_extra_reward from public.payroll_employee_rules where id=v_rule_id;
  end if;
  v_delta := v_extra_attendance_bonus + coalesce(v_extra_reward,0);
  v_result := v_result || jsonb_build_object(
    'extraAttendanceDays',v_extra_days,
    'extraAttendanceBonusRate',v_extra_attendance_rate,
    'accruedExtraAttendanceBonus',round(v_extra_attendance_bonus,2),
    'extraRewardAmount',round(coalesce(v_extra_reward,0),2),
    'accruedExtraReward',round(coalesce(v_extra_reward,0),2),
    'incomeSubtotalKnown',round(coalesce((v_result->>'incomeSubtotalKnown')::numeric,0)+v_delta,2),
    'knownEstimatedPayable',round(coalesce((v_result->>'knownEstimatedPayable')::numeric,0)+v_delta,2),
    'estimatedPayable',case when v_result->>'estimatedPayable' is null then null else round((v_result->>'estimatedPayable')::numeric+v_delta,2) end
  );
  return v_result;
end;
$$;

create or replace function public.admin_update_payroll_payslip(p_payslip_id uuid,p_fields jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_row public.payroll_payslips;
  v_base numeric := coalesce((p_fields->>'accruedBaseSalary')::numeric,0);
  v_housing numeric := coalesce((p_fields->>'accruedHousingAllowance')::numeric,0);
  v_performance numeric := coalesce((p_fields->>'accruedPerformance')::numeric,0);
  v_attendance_bonus numeric := coalesce((p_fields->>'accruedFullAttendanceBonus')::numeric,0);
  v_extra_attendance_bonus numeric := coalesce((p_fields->>'accruedExtraAttendanceBonus')::numeric,0);
  v_service_award numeric := coalesce((p_fields->>'accruedServiceAward')::numeric,0);
  v_extra_reward numeric := coalesce((p_fields->>'accruedExtraReward')::numeric,0);
  v_commission numeric := coalesce((p_fields->>'accruedCommission')::numeric,0);
  v_overtime numeric := coalesce((p_fields->>'accruedOvertime')::numeric,0);
  v_fine numeric := coalesce((p_fields->>'fineTotal')::numeric,0);
  v_payable numeric;
  v_was_confirmed boolean;
begin
  select * into v_row from public.payroll_payslips where id=p_payslip_id for update;
  if v_row.id is null or public.current_user_role()<>'admin' or not public.can_admin_manage_attendance_profile(v_row.profile_id) then raise exception '没有该工资单的操作权限'; end if;
  if v_row.status='withdrawn' then raise exception '已撤回工资单不能修改，请重新生成'; end if;
  if least(v_base,v_housing,v_performance,v_attendance_bonus,v_extra_attendance_bonus,v_service_award,v_extra_reward,v_commission,v_overtime,v_fine)<0 then raise exception '工资单金额不能小于 0'; end if;
  v_payable := v_base+v_housing+v_performance+v_attendance_bonus+v_extra_attendance_bonus+v_service_award+v_extra_reward+v_commission+v_overtime-v_fine;
  v_was_confirmed := v_row.status='confirmed';
  update public.payroll_payslips set
    estimate_snapshot=estimate_snapshot||jsonb_build_object(
      'accruedBaseSalary',v_base,'accruedHousingAllowance',v_housing,'accruedPerformance',v_performance,
      'accruedFullAttendanceBonus',v_attendance_bonus,'accruedExtraAttendanceBonus',v_extra_attendance_bonus,
      'accruedServiceAward',v_service_award,'accruedExtraReward',v_extra_reward,
      'extraRewardAmount',v_extra_reward,'accruedCommission',v_commission,'accruedOvertime',v_overtime,'fineTotal',v_fine,
      'incomeSubtotalKnown',v_base+v_housing+v_performance+v_attendance_bonus+v_extra_attendance_bonus+v_service_award+v_extra_reward+v_commission+v_overtime,
      'knownEstimatedPayable',v_payable,'estimatedPayable',v_payable,'dataComplete',true,'dataIssues',jsonb_build_array()
    ),
    admin_note=btrim(coalesce(p_fields->>'adminNote','')),
    status=case when status='confirmed' then 'issued' else status end,
    confirmed_at=case when status='confirmed' then null else confirmed_at end,
    revision=revision+1,last_modified_by=auth.uid()
  where id=v_row.id returning * into v_row;
  if v_row.status='issued' then
    insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
    values(v_row.profile_id,v_row.store_id,'payroll_payslip_updated',to_char(v_row.payroll_month,'YYYY年MM月')||'工资单已调整',case when v_was_confirmed then '工资单内容已调整，请重新核对并确认。' else '工资单内容已调整，请核对最新内容。' end,'payroll_payslip',v_row.id,'payroll-payslip:'||v_row.profile_id||':'||v_row.payroll_month::text)
    on conflict(dedupe_key) do update set type=excluded.type,title=excluded.title,body=excluded.body,is_read=false,read_at=null,created_at=now();
  end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.calculate_payroll_estimate_before_extra_awards(uuid,date), public.calculate_payroll_estimate_internal(uuid,date) from public,anon,authenticated;
revoke all on function public.get_payroll_estimate(uuid,date), public.admin_save_payroll_employee_rule(uuid,jsonb,uuid[]), public.admin_update_payroll_payslip(uuid,jsonb) from public,anon;
grant execute on function public.get_payroll_estimate(uuid,date), public.admin_save_payroll_employee_rule(uuid,jsonb,uuid[]), public.admin_update_payroll_payslip(uuid,jsonb) to authenticated;
