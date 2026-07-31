-- Calculate employee performance independently for every assigned store while
-- keeping employee-facing payroll snapshots intentionally compact.

create table public.payroll_employee_performance_stores (
  rule_id uuid not null references public.payroll_employee_rules(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  allocation_ratio numeric(7,6) not null check (allocation_ratio > 0 and allocation_ratio <= 1),
  created_at timestamptz not null default now(),
  primary key(rule_id, store_id)
);

create table public.payroll_store_performance_overrides (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  payroll_month date not null check (payroll_month = date_trunc('month', payroll_month)::date),
  store_id uuid not null references public.stores(id) on delete cascade,
  override_mode text not null check (override_mode in ('score', 'grade')),
  performance_score numeric(5,2) check (performance_score between 0 and 100),
  performance_grade text check (performance_grade in ('A', 'B', 'C', 'D')),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(profile_id, payroll_month, store_id),
  check (
    (override_mode = 'score' and performance_score is not null and performance_grade is null)
    or (override_mode = 'grade' and performance_grade is not null and performance_score is null)
  )
);

create table public.payroll_performance_amount_overrides (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  payroll_month date not null check (payroll_month = date_trunc('month', payroll_month)::date),
  amount numeric(12,2) not null check (amount >= 0),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(profile_id, payroll_month)
);

create trigger payroll_store_performance_overrides_touch_updated_at
before update on public.payroll_store_performance_overrides
for each row execute function public.touch_updated_at();

create trigger payroll_performance_amount_overrides_touch_updated_at
before update on public.payroll_performance_amount_overrides
for each row execute function public.touch_updated_at();

alter table public.payroll_employee_performance_stores enable row level security;
alter table public.payroll_store_performance_overrides enable row level security;
alter table public.payroll_performance_amount_overrides enable row level security;

create policy payroll_employee_performance_stores_admin_select
on public.payroll_employee_performance_stores for select to authenticated
using(exists(
  select 1 from public.payroll_employee_rules rule
  where rule.id = rule_id and public.current_user_role() = 'admin'
    and public.can_admin_manage_attendance_profile(rule.profile_id)
));

create policy payroll_store_performance_overrides_admin_select
on public.payroll_store_performance_overrides for select to authenticated
using(public.current_user_role() = 'admin' and public.can_admin_manage_attendance_profile(profile_id));

create policy payroll_performance_amount_overrides_admin_select
on public.payroll_performance_amount_overrides for select to authenticated
using(public.current_user_role() = 'admin' and public.can_admin_manage_attendance_profile(profile_id));

grant select on public.payroll_employee_performance_stores,
  public.payroll_store_performance_overrides,
  public.payroll_performance_amount_overrides to authenticated;

create function public.admin_save_payroll_employee_rule_v2(
  p_profile_id uuid,
  p_fields jsonb,
  p_commission_store_ids uuid[] default '{}',
  p_performance_stores jsonb default '[]'::jsonb
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_rule_id uuid;
  v_store jsonb;
  v_store_id uuid;
  v_ratio numeric;
  v_ratio_total numeric := 0;
  v_count integer := 0;
begin
  if public.current_user_role() <> 'admin' or not public.can_admin_manage_attendance_profile(p_profile_id) then
    raise exception 'payroll profile access denied';
  end if;
  if jsonb_typeof(coalesce(p_performance_stores, '[]'::jsonb)) <> 'array' then
    raise exception 'performance store allocations must be an array';
  end if;

  for v_store in select value from jsonb_array_elements(coalesce(p_performance_stores, '[]'::jsonb)) loop
    v_store_id := nullif(v_store->>'storeId', '')::uuid;
    v_ratio := nullif(v_store->>'allocationRatio', '')::numeric;
    if v_store_id is null or v_ratio is null or v_ratio <= 0 or v_ratio > 1 then
      raise exception 'invalid performance store allocation';
    end if;
    if not public.has_store_access(v_store_id)
       or not exists(select 1 from public.profile_store_access where profile_id = p_profile_id and store_id = v_store_id) then
      raise exception 'performance store access denied';
    end if;
    v_ratio_total := v_ratio_total + v_ratio;
    v_count := v_count + 1;
  end loop;


  if coalesce((p_fields->>'performanceEnabled')::boolean, false) then
    if v_count = 0 then raise exception 'at least one performance store is required'; end if;
    if abs(v_ratio_total - 1) > 0.000001 then raise exception 'performance store allocations must total 100 percent'; end if;
  end if;

  v_rule_id := public.admin_save_payroll_employee_rule(
    p_profile_id, p_fields, coalesce(p_commission_store_ids, '{}'::uuid[])
  );
  delete from public.payroll_employee_performance_stores where rule_id = v_rule_id;
  insert into public.payroll_employee_performance_stores(rule_id, store_id, allocation_ratio)
  select v_rule_id, (entry->>'storeId')::uuid, (entry->>'allocationRatio')::numeric
  from jsonb_array_elements(coalesce(p_performance_stores, '[]'::jsonb)) entry;
  return v_rule_id;
end;
$$;

create function public.admin_save_payroll_monthly_performance(
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

  select count(*) into v_store_count from public.profile_store_access where profile_id = p_profile_id;
  if v_store_count = 0 then raise exception 'employee has no assigned store'; end if;


  delete from public.payroll_store_performance_overrides
  where profile_id = p_profile_id and payroll_month = v_month;

  for v_setting in select value from jsonb_array_elements(coalesce(p_store_settings, '[]'::jsonb)) loop
    v_store_id := nullif(v_setting->>'storeId', '')::uuid;
    v_mode := coalesce(nullif(v_setting->>'mode', ''), 'automatic');
    v_score := nullif(v_setting->>'score', '')::numeric;
    v_grade := upper(nullif(v_setting->>'grade', ''));
    if v_store_id is null or not exists(
      select 1 from public.profile_store_access where profile_id = p_profile_id and store_id = v_store_id
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

alter function public.calculate_payroll_estimate_before_estimated_individual_tax(uuid, date)
  rename to calculate_payroll_estimate_before_store_performance;

create function public.calculate_payroll_estimate_before_estimated_individual_tax(
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
  v_result := public.calculate_payroll_estimate_before_store_performance(p_profile_id, p_as_of);
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
  select count(*) into v_store_count from (
    select store_id from public.payroll_employee_performance_stores where rule_id = v_rule_id
    union all
    select access.store_id from public.profile_store_access access
    where access.profile_id = p_profile_id and v_config_count = 0
  ) scope;

  if v_store_count = 0 then
    select count(*) into v_store_count from public.profiles where id = p_profile_id and store_id is not null;
  end if;

  -- A legacy single-store employee keeps the existing calculation and monthly
  -- score override until the administrator explicitly saves store allocations.
  if v_store_count <= 1 and v_config_count = 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'storeId', store.id, 'storeName', store.name, 'allocationRatio', 1,
      'calculationMode', coalesce(v_result->>'performanceCalculationMode', 'automatic'),
      'score', nullif(v_result->>'performanceScore', '')::numeric,
      'grade', v_result->>'performanceGrade', 'coefficient', null, 'amount', nullif(v_result->>'accruedPerformance', '')::numeric
    )), '[]'::jsonb) into v_store_results
    from public.profiles profile join public.stores store on store.id = profile.store_id
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
    with configured as (
      select allocation.store_id, allocation.allocation_ratio
      from public.payroll_employee_performance_stores allocation where allocation.rule_id = v_rule_id
    ), fallback as (
      select access.store_id, 1::numeric / nullif(count(*) over(), 0) allocation_ratio
      from public.profile_store_access access where access.profile_id = p_profile_id and v_config_count = 0
    ), scope as (
      select * from configured union all select * from fallback
    )
    select scope.store_id, store.name store_name, scope.allocation_ratio
    from scope join public.stores store on store.id = scope.store_id order by store.name
  loop
    select count(*)::integer, count(*) filter(where task.status = 'approved')::integer
    into v_due, v_completed
    from public.v2_tasks task
    where task.store_id = v_store.store_id and task.due_at::date between v_month and p_as_of
      and task.status <> 'cancelled'
      and (task.assigned_profile_id = p_profile_id or task.assigned_profile_id is null);

    select coalesce(sum(case when daily.late_minutes between 1 and 10 then v_perf.late_deduction_1_10
      when daily.late_minutes between 11 and 20 then v_perf.late_deduction_11_20
      when daily.late_minutes between 21 and 30 then v_perf.late_deduction_21_30
      when daily.late_minutes >= 31 then v_perf.late_deduction_31_plus else 0 end), 0)
    into v_late_deduction
    from public.attendance_daily_records daily
    where daily.profile_id = p_profile_id and daily.store_id = v_store.store_id
      and daily.attendance_date between v_month and p_as_of;

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

revoke all on function public.admin_save_payroll_employee_rule_v2(uuid,jsonb,uuid[],jsonb),
  public.admin_save_payroll_monthly_performance(uuid,date,jsonb,numeric),
  public.calculate_payroll_estimate_before_store_performance(uuid,date),
  public.calculate_payroll_estimate_before_estimated_individual_tax(uuid,date)
from public, anon, authenticated;
grant execute on function public.admin_save_payroll_employee_rule_v2(uuid,jsonb,uuid[],jsonb),
  public.admin_save_payroll_monthly_performance(uuid,date,jsonb,numeric) to authenticated;
