-- Realtime payroll estimates. Values are month-to-date only and never predict
-- the remainder of the month. Missing task or revenue data remains pending.

create table public.payroll_employee_rules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  monthly_base_salary numeric(12,2) not null check (monthly_base_salary >= 0),
  monthly_housing_allowance numeric(12,2) not null default 0 check (monthly_housing_allowance >= 0),
  full_performance_amount numeric(12,2) check (full_performance_amount >= 0),
  commission_rate numeric(9,6) check (commission_rate >= 0 and commission_rate <= 1),
  housing_enabled boolean not null default true,
  performance_enabled boolean not null default true,
  commission_enabled boolean not null default false,
  confirmed boolean not null default false,
  effective_from date not null,
  effective_to date,
  change_reason text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  unique (profile_id, effective_from)
);

create index payroll_employee_rules_profile_effective_idx
on public.payroll_employee_rules(profile_id, effective_from desc);

create table public.payroll_employee_commission_stores (
  rule_id uuid not null references public.payroll_employee_rules(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (rule_id, store_id)
);

create table public.payroll_performance_rules (
  id uuid primary key default gen_random_uuid(),
  task_weight numeric(5,2) not null default 60 check (task_weight >= 0),
  attendance_weight numeric(5,2) not null default 25 check (attendance_weight >= 0),
  discipline_weight numeric(5,2) not null default 15 check (discipline_weight >= 0),
  late_deduction_1_10 numeric(5,2) not null default 1 check (late_deduction_1_10 >= 0),
  late_deduction_11_20 numeric(5,2) not null default 3 check (late_deduction_11_20 >= 0),
  late_deduction_21_30 numeric(5,2) not null default 5 check (late_deduction_21_30 >= 0),
  late_deduction_31_plus numeric(5,2) not null default 10 check (late_deduction_31_plus >= 0),
  grade_a_min numeric(5,2) not null default 90,
  grade_b_min numeric(5,2) not null default 80,
  grade_c_min numeric(5,2) not null default 70,
  grade_a_coefficient numeric(5,4) not null default 1 check (grade_a_coefficient >= 0),
  grade_b_coefficient numeric(5,4) not null default .8 check (grade_b_coefficient >= 0),
  grade_c_coefficient numeric(5,4) not null default .5 check (grade_c_coefficient >= 0),
  grade_d_coefficient numeric(5,4) not null default .2 check (grade_d_coefficient >= 0),
  effective_from date not null,
  effective_to date,
  change_reason text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (task_weight + attendance_weight + discipline_weight = 100),
  check (grade_a_min > grade_b_min and grade_b_min > grade_c_min and grade_c_min >= 0),
  check (effective_to is null or effective_to >= effective_from),
  unique (effective_from)
);

create table public.payroll_store_revenues (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  revenue_date date not null,
  confirmed_amount numeric(14,2) not null check (confirmed_amount >= 0),
  note text not null default '',
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, revenue_date)
);

create trigger payroll_store_revenues_touch_updated_at
before update on public.payroll_store_revenues
for each row execute function public.touch_updated_at();

create table public.payroll_penalties (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_date date not null,
  reason text not null check (nullif(trim(reason), '') is not null),
  amount numeric(12,2) not null default 0 check (amount >= 0),
  event_level text not null check (event_level in ('reminder','warning','formal_warning','serious')),
  performance_deduction numeric(5,2) not null default 0 check (performance_deduction >= 0),
  status text not null default 'active' check (status in ('active','revoked')),
  revoke_reason text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger payroll_penalties_touch_updated_at
before update on public.payroll_penalties
for each row execute function public.touch_updated_at();

alter table public.payroll_employee_rules enable row level security;
alter table public.payroll_employee_commission_stores enable row level security;
alter table public.payroll_performance_rules enable row level security;
alter table public.payroll_store_revenues enable row level security;
alter table public.payroll_penalties enable row level security;

create policy payroll_employee_rules_admin_all on public.payroll_employee_rules
for all to authenticated using (public.can_admin_manage_attendance_profile(profile_id))
with check (public.can_admin_manage_attendance_profile(profile_id));

create policy payroll_commission_stores_admin_all on public.payroll_employee_commission_stores
for all to authenticated using (exists (
  select 1 from public.payroll_employee_rules rule
  where rule.id = rule_id and public.can_admin_manage_attendance_profile(rule.profile_id)
)) with check (exists (
  select 1 from public.payroll_employee_rules rule
  where rule.id = rule_id and public.can_admin_manage_attendance_profile(rule.profile_id)
));

create policy payroll_performance_rules_admin_all on public.payroll_performance_rules
for all to authenticated using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy payroll_store_revenues_admin_all on public.payroll_store_revenues
for all to authenticated using (public.current_user_role() = 'admin' and public.has_store_access(store_id))
with check (public.current_user_role() = 'admin' and public.has_store_access(store_id));

create policy payroll_penalties_admin_all on public.payroll_penalties
for all to authenticated using (public.can_admin_manage_attendance_profile(profile_id))
with check (public.can_admin_manage_attendance_profile(profile_id));

grant select, insert, update, delete on public.payroll_employee_rules,
  public.payroll_employee_commission_stores, public.payroll_performance_rules,
  public.payroll_store_revenues, public.payroll_penalties to authenticated;

insert into public.payroll_performance_rules(effective_from, change_reason)
values (date_trunc('month', current_date)::date, '系统初始绩效规则');

with seed(display_name, base_salary, housing, performance_amount, commission_rate, housing_enabled, performance_enabled, commission_enabled, confirmed) as (
  values
    ('李天欣', 5500::numeric, 1100::numeric, 3000::numeric, .006::numeric, true, true, true, false),
    ('刘成跃', 5300::numeric, 1000::numeric, null::numeric, .002::numeric, true, true, true, false),
    ('蔚师阳', 5300::numeric, 1000::numeric, null::numeric, null::numeric, true, true, false, false),
    ('谢中旭', 5300::numeric, 1000::numeric, null::numeric, null::numeric, true, true, false, false),
    ('刘佳泽', 5300::numeric, 1000::numeric, null::numeric, .002::numeric, true, true, false, false)
)
insert into public.payroll_employee_rules(
  profile_id, monthly_base_salary, monthly_housing_allowance, full_performance_amount,
  commission_rate, housing_enabled, performance_enabled, commission_enabled,
  confirmed, effective_from, change_reason
)
select profile.id, seed.base_salary, seed.housing, seed.performance_amount,
  seed.commission_rate, seed.housing_enabled, seed.performance_enabled, seed.commission_enabled,
  seed.confirmed, date_trunc('month', current_date)::date, '根据现有工资表导入，待管理员确认'
from seed
join public.profiles profile on profile.display_name = seed.display_name
on conflict (profile_id, effective_from) do nothing;

insert into public.payroll_employee_commission_stores(rule_id, store_id)
select rule.id, store.id
from public.payroll_employee_rules rule
join public.profiles profile on profile.id = rule.profile_id
join public.stores store on (
  (profile.display_name = '李天欣' and (store.name like '%五道口%' or store.name like '%西直门%' or store.name like '%领展%'))
  or (profile.display_name = '刘成跃' and store.name like '%西直门%')
)
where rule.effective_from = date_trunc('month', current_date)::date
on conflict do nothing;

create or replace function public.admin_save_payroll_employee_rule(
  p_profile_id uuid,
  p_fields jsonb,
  p_store_ids uuid[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_effective_from date := coalesce((p_fields->>'effectiveFrom')::date, current_date);
  v_effective_to date;
  v_rule_id uuid;
  v_store_id uuid;
begin
  if not public.can_admin_manage_attendance_profile(p_profile_id) then raise exception 'payroll profile access denied'; end if;
  if nullif(trim(coalesce(p_fields->>'changeReason', '')), '') is null then raise exception 'change reason is required'; end if;
  foreach v_store_id in array coalesce(p_store_ids, '{}'::uuid[]) loop
    if not public.has_store_access(v_store_id) then raise exception 'payroll store access denied'; end if;
  end loop;

  select min(effective_from) - 1 into v_effective_to
  from public.payroll_employee_rules
  where profile_id = p_profile_id and effective_from > v_effective_from;

  update public.payroll_employee_rules
  set effective_to = v_effective_from - 1
  where profile_id = p_profile_id and effective_from < v_effective_from
    and (effective_to is null or effective_to >= v_effective_from);

  insert into public.payroll_employee_rules(
    profile_id, monthly_base_salary, monthly_housing_allowance, full_performance_amount,
    commission_rate, housing_enabled, performance_enabled, commission_enabled,
    confirmed, effective_from, effective_to, change_reason, created_by
  ) values (
    p_profile_id,
    coalesce((p_fields->>'monthlyBaseSalary')::numeric, 0),
    coalesce((p_fields->>'monthlyHousingAllowance')::numeric, 0),
    nullif(p_fields->>'fullPerformanceAmount', '')::numeric,
    nullif(p_fields->>'commissionRate', '')::numeric,
    coalesce((p_fields->>'housingEnabled')::boolean, false),
    coalesce((p_fields->>'performanceEnabled')::boolean, false),
    coalesce((p_fields->>'commissionEnabled')::boolean, false),
    coalesce((p_fields->>'confirmed')::boolean, false),
    v_effective_from, v_effective_to,
    trim(p_fields->>'changeReason'),
    auth.uid()
  ) on conflict (profile_id, effective_from) do update set
    monthly_base_salary = excluded.monthly_base_salary,
    monthly_housing_allowance = excluded.monthly_housing_allowance,
    full_performance_amount = excluded.full_performance_amount,
    commission_rate = excluded.commission_rate,
    housing_enabled = excluded.housing_enabled,
    performance_enabled = excluded.performance_enabled,
    commission_enabled = excluded.commission_enabled,
    confirmed = excluded.confirmed,
    effective_to = excluded.effective_to,
    change_reason = excluded.change_reason,
    created_by = excluded.created_by,
    created_at = now()
  returning id into v_rule_id;

  delete from public.payroll_employee_commission_stores where rule_id = v_rule_id;

  insert into public.payroll_employee_commission_stores(rule_id, store_id)
  select v_rule_id, store_id from unnest(coalesce(p_store_ids, '{}'::uuid[])) store_id;
  return v_rule_id;
end;
$$;

create or replace function public.admin_save_payroll_performance_rule(p_fields jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_effective_from date := coalesce((p_fields->>'effectiveFrom')::date, current_date);
  v_effective_to date;
  v_rule_id uuid;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator permission required'; end if;
  if nullif(trim(coalesce(p_fields->>'changeReason', '')), '') is null then raise exception 'change reason is required'; end if;
  select min(effective_from) - 1 into v_effective_to
  from public.payroll_performance_rules where effective_from > v_effective_from;
  update public.payroll_performance_rules set effective_to = v_effective_from - 1
  where effective_from < v_effective_from and (effective_to is null or effective_to >= v_effective_from);
  insert into public.payroll_performance_rules(
    task_weight, attendance_weight, discipline_weight,
    late_deduction_1_10, late_deduction_11_20, late_deduction_21_30, late_deduction_31_plus,
    grade_a_min, grade_b_min, grade_c_min,
    grade_a_coefficient, grade_b_coefficient, grade_c_coefficient, grade_d_coefficient,
    effective_from, effective_to, change_reason, created_by
  ) values (
    (p_fields->>'taskWeight')::numeric, (p_fields->>'attendanceWeight')::numeric, (p_fields->>'disciplineWeight')::numeric,
    (p_fields->>'lateDeduction1To10')::numeric, (p_fields->>'lateDeduction11To20')::numeric,
    (p_fields->>'lateDeduction21To30')::numeric, (p_fields->>'lateDeduction31Plus')::numeric,
    (p_fields->>'gradeAMin')::numeric, (p_fields->>'gradeBMin')::numeric, (p_fields->>'gradeCMin')::numeric,
    (p_fields->>'gradeACoefficient')::numeric, (p_fields->>'gradeBCoefficient')::numeric,
    (p_fields->>'gradeCCoefficient')::numeric, (p_fields->>'gradeDCoefficient')::numeric,
    v_effective_from, v_effective_to, trim(p_fields->>'changeReason'), auth.uid()
  ) on conflict (effective_from) do update set
    task_weight = excluded.task_weight,
    attendance_weight = excluded.attendance_weight,
    discipline_weight = excluded.discipline_weight,
    late_deduction_1_10 = excluded.late_deduction_1_10,
    late_deduction_11_20 = excluded.late_deduction_11_20,
    late_deduction_21_30 = excluded.late_deduction_21_30,
    late_deduction_31_plus = excluded.late_deduction_31_plus,
    grade_a_min = excluded.grade_a_min,
    grade_b_min = excluded.grade_b_min,
    grade_c_min = excluded.grade_c_min,
    grade_a_coefficient = excluded.grade_a_coefficient,
    grade_b_coefficient = excluded.grade_b_coefficient,
    grade_c_coefficient = excluded.grade_c_coefficient,
    grade_d_coefficient = excluded.grade_d_coefficient,
    effective_to = excluded.effective_to,
    change_reason = excluded.change_reason,
    created_by = excluded.created_by,
    created_at = now()
  returning id into v_rule_id;
  return v_rule_id;
end;
$$;

create or replace function public.get_payroll_estimate(p_profile_id uuid, p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_month_start date := date_trunc('month', p_as_of)::date;
  v_month_end date := (date_trunc('month', p_as_of) + interval '1 month - 1 day')::date;
  v_full_days integer := extract(day from (date_trunc('month', p_as_of) + interval '1 month - 1 day'))::integer - 4;
  v_result jsonb;
begin
  if p_as_of > current_date then raise exception 'future payroll estimates are not allowed'; end if;
  if p_profile_id <> auth.uid() and not public.can_admin_manage_attendance_profile(p_profile_id) then raise exception 'payroll access denied'; end if;

  with employee as (
    select profile.id, profile.display_name, profile.username, profile.store_id
    from public.profiles profile where profile.id = p_profile_id
  ), active_rule as (
    select rule.* from public.payroll_employee_rules rule
    where rule.profile_id = p_profile_id and rule.effective_from <= p_as_of
      and (rule.effective_to is null or rule.effective_to >= p_as_of)
    order by rule.effective_from desc limit 1
  ), performance_rule as (
    select rule.* from public.payroll_performance_rules rule
    where rule.effective_from <= p_as_of and (rule.effective_to is null or rule.effective_to >= p_as_of)
    order by rule.effective_from desc limit 1
  ), attendance as (
    select count(distinct daily.attendance_date) filter (where daily.is_attended)::integer attendance_days,
      max(daily.last_synced_at) last_synced_at
    from public.attendance_daily_records daily
    where daily.profile_id = p_profile_id and daily.attendance_date between v_month_start and p_as_of
  ), late_events as (
    select count(*) filter (where daily.late_minutes > 0)::integer late_count,
      coalesce(sum(daily.late_minutes) filter (where daily.late_minutes > 0), 0)::integer late_minutes,
      coalesce(sum(case when daily.late_minutes between 1 and 10 then 20 when daily.late_minutes between 11 and 20 then 50 when daily.late_minutes between 21 and 30 then 100 when daily.late_minutes >= 31 then 200 else 0 end), 0)::numeric late_fine,
      coalesce(sum(case
        when daily.late_minutes between 1 and 10 then perf.late_deduction_1_10
        when daily.late_minutes between 11 and 20 then perf.late_deduction_11_20
        when daily.late_minutes between 21 and 30 then perf.late_deduction_21_30
        when daily.late_minutes >= 31 then perf.late_deduction_31_plus else 0 end), 0)::numeric late_performance_deduction
    from public.attendance_daily_records daily cross join performance_rule perf
    where daily.profile_id = p_profile_id and daily.attendance_date between v_month_start and p_as_of
  ), penalties as (
    select coalesce(sum(amount), 0)::numeric other_fine,
      coalesce(sum(performance_deduction), 0)::numeric discipline_deduction,
      max(updated_at) last_updated_at
    from public.payroll_penalties
    where profile_id = p_profile_id and event_date between v_month_start and p_as_of and status = 'active'
  ), employee_stores as (
    select employee.store_id from employee
    union select binding.store_id from public.dingtalk_employee_bindings binding
      where binding.profile_id = p_profile_id and binding.binding_status = 'active'
  ), tasks as (
    select count(*)::integer due_count,
      count(*) filter (where task.status = 'approved')::integer completed_count,
      max(task.updated_at) last_updated_at
    from public.v2_tasks task
    where task.due_at::date between v_month_start and p_as_of and task.status <> 'cancelled'
      and (task.assigned_profile_id = p_profile_id or (task.assigned_profile_id is null and task.store_id in (select store_id from employee_stores)))
  ), commission_scope as (
    select store.store_id from public.payroll_employee_commission_stores store join active_rule rule on rule.id = store.rule_id
  ), revenues as (
    select coalesce(sum(revenue.confirmed_amount), 0)::numeric revenue_total,
      count(distinct revenue.store_id) filter (where revenue.revenue_date = p_as_of)::integer stores_with_data,
      (select count(*) from commission_scope)::integer required_store_count,
      max(revenue.updated_at) last_updated_at
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
      revenues.revenue_total, revenues.last_updated_at revenue_updated_at,
      revenues.required_store_count, revenues.stores_with_data,
      perf.task_weight, perf.attendance_weight, perf.discipline_weight,
      case when tasks.due_count > 0 then round(least(tasks.completed_count::numeric / tasks.due_count, 1) * perf.task_weight, 2) end task_score,
      greatest(perf.attendance_weight - late_events.late_performance_deduction, 0) attendance_score,
      greatest(perf.discipline_weight - penalties.discipline_deduction, 0) discipline_score
    from employee
    left join active_rule rule on true
    cross join performance_rule perf
    cross join attendance
    cross join late_events
    cross join penalties
    cross join tasks
    cross join revenues
  ), scored as (
    select calculated.*,
      case when task_score is not null then round(task_score + attendance_score + discipline_score, 2) end performance_score,
      round(coalesce(monthly_base_salary, 0) / v_full_days * least(attendance_days, v_full_days), 2) accrued_base_salary,
      round(case when housing_enabled then coalesce(monthly_housing_allowance, 0) / v_full_days * least(attendance_days, v_full_days) else 0 end, 2) accrued_housing_allowance,
      (not performance_enabled or (full_performance_amount is not null and task_score is not null)) performance_ready,
      (not commission_enabled or (commission_rate is not null and required_store_count > 0 and stores_with_data = required_store_count)) commission_ready
    from calculated
  ), amounts as (
    select scored.*,
      case when performance_score >= grade_a_min then 'A' when performance_score >= grade_b_min then 'B' when performance_score >= grade_c_min then 'C' when performance_score is not null then 'D' end performance_grade,
      case when performance_score >= grade_a_min then grade_a_coefficient when performance_score >= grade_b_min then grade_b_coefficient when performance_score >= grade_c_min then grade_c_coefficient else grade_d_coefficient end performance_coefficient
    from scored cross join performance_rule
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
    'attendanceScore', attendance_score, 'disciplineScore', discipline_score,
    'performanceScore', performance_score, 'performanceGrade', performance_grade,
    'revenueTotal', revenue_total, 'performanceReady', performance_ready, 'commissionReady', commission_ready,
    'dataComplete', (rule_id is not null and rule_confirmed and performance_ready and commission_ready),
    'incomeSubtotalKnown', round(accrued_base_salary + accrued_housing_allowance + coalesce(accrued_performance, 0) + coalesce(accrued_commission, 0), 2),
    'knownEstimatedPayable', round(accrued_base_salary + accrued_housing_allowance + coalesce(accrued_performance, 0) + coalesce(accrued_commission, 0) - fine_total, 2),
    'estimatedPayable', case when rule_id is not null and rule_confirmed and performance_ready and commission_ready then round(accrued_base_salary + accrued_housing_allowance + coalesce(accrued_performance, 0) + coalesce(accrued_commission, 0) - fine_total, 2) end,
    'attendanceUpdatedAt', attendance_updated_at, 'tasksUpdatedAt', tasks_updated_at,
    'revenueUpdatedAt', revenue_updated_at, 'penaltiesUpdatedAt', penalties_updated_at,
    'dataIssues', to_jsonb(array_remove(array[
      case when rule_id is null then '未配置工资参数' when not rule_confirmed then '工资参数待管理员确认' end,
      case when performance_enabled and full_performance_amount is null then '满绩效金额待录入' when performance_enabled and task_score is null then '任务数据不足，绩效待评分' end,
      case when commission_enabled and not commission_ready then '营业收入待更新' end
    ], null))
  ) into v_result
  from totals;

  return coalesce(v_result, jsonb_build_object('profileId', p_profile_id, 'asOf', p_as_of, 'dataComplete', false, 'dataIssues', jsonb_build_array('无法计算预估工资')));
end;
$$;

create or replace function public.admin_payroll_estimates(
  p_as_of date default current_date,
  p_store_id uuid default null,
  p_search text default ''
)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_result jsonb;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator permission required'; end if;
  if p_store_id is not null and not public.has_store_access(p_store_id) then raise exception 'store access denied'; end if;
  with targets as (
    select profile.id
    from public.profiles profile
    where profile.role in ('staff','manager') and profile.is_active and profile.deleted_at is null
      and profile.display_name not in ('李荣珊','李荣妹','李荣美')
      and public.can_admin_manage_attendance_profile(profile.id)
      and (p_store_id is null or profile.store_id = p_store_id or exists (
        select 1 from public.dingtalk_employee_bindings binding
        where binding.profile_id = profile.id and binding.store_id = p_store_id and binding.binding_status = 'active'
      ))
      and (trim(coalesce(p_search, '')) = '' or profile.display_name ilike '%' || trim(p_search) || '%' or profile.username ilike '%' || trim(p_search) || '%')
  ), estimates as (
    select public.get_payroll_estimate(target.id, p_as_of) estimate from targets target
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(estimate order by estimate->>'displayName'), '[]'::jsonb),
    'employeeCount', count(*),
    'completeCount', count(*) filter (where (estimate->>'dataComplete')::boolean),
    'incompleteCount', count(*) filter (where not (estimate->>'dataComplete')::boolean),
    'knownEstimatedTotal', coalesce(sum((estimate->>'knownEstimatedPayable')::numeric), 0),
    'completeEstimatedTotal', coalesce(sum((estimate->>'estimatedPayable')::numeric) filter (where estimate->>'estimatedPayable' is not null), 0)
  ) into v_result from estimates;
  return v_result;
end;
$$;

revoke all on function public.admin_save_payroll_employee_rule(uuid,jsonb,uuid[]),
  public.admin_save_payroll_performance_rule(jsonb), public.get_payroll_estimate(uuid,date),
  public.admin_payroll_estimates(date,uuid,text) from public;
grant execute on function public.admin_save_payroll_employee_rule(uuid,jsonb,uuid[]),
  public.admin_save_payroll_performance_rule(jsonb), public.get_payroll_estimate(uuid,date),
  public.admin_payroll_estimates(date,uuid,text) to authenticated;
