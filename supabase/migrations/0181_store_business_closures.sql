-- Business closure is independent of account/access activation and preserves dated history.
create table public.store_business_closures (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id) on delete restrict,
 closed_from date not null, reopened_from date, resume_sales_sync boolean not null default false,
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(),
 check(reopened_from is null or reopened_from>=closed_from)
);
create unique index store_business_one_open_closure on public.store_business_closures(store_id) where reopened_from is null;
create index store_business_closure_dates on public.store_business_closures(store_id,closed_from,reopened_from);
alter table public.store_business_closures enable row level security;
create policy store_business_closures_read on public.store_business_closures for select to authenticated
using(public.current_user_role()='admin' and public.has_store_access(store_id));
grant select on public.store_business_closures to authenticated;
create function public.store_is_operating_on(p_store_id uuid,p_date date) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.stores where id=p_store_id) and not exists(
 select 1 from public.store_business_closures where store_id=p_store_id and closed_from<=p_date and (reopened_from is null or reopened_from>p_date));
$$;
create function public.store_has_operating_days(p_store_id uuid,p_from date,p_to date) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from generate_series(p_from,p_to,'1 day'::interval) d where public.store_is_operating_on(p_store_id,d::date));
$$;
create function public.admin_set_store_operating(p_store_id uuid,p_operating boolean,p_effective_date date) returns uuid
language plpgsql security definer set search_path=public as $$
declare c public.store_business_closures%rowtype; sid uuid; restore_sync boolean;
begin
 if public.current_user_role()<>'admin' or not public.has_store_access(p_store_id) then raise exception '没有设置该门店的权限' using errcode='42501'; end if;
 if p_operating is null or p_effective_date is null or p_effective_date>(now() at time zone 'Asia/Shanghai')::date then raise exception '请选择不晚于今天的生效日期'; end if;
 perform pg_advisory_xact_lock(hashtextextended('store-business:'||p_store_id::text,0));
 select * into c from public.store_business_closures where store_id=p_store_id and reopened_from is null for update;
 if p_operating then
   if c.id is null then return null; end if;
   if p_effective_date<c.closed_from then raise exception '恢复营业日期不能早于关店日期'; end if;
   update public.store_business_closures set reopened_from=p_effective_date,updated_by=auth.uid(),updated_at=now() where id=c.id;
   sid:=c.id;
   if c.resume_sales_sync then update public.pos_sales_integrations set enabled=true,next_sync_at=now() where store_id=p_store_id; end if;
 else
   if exists(select 1 from public.store_business_closures where store_id=p_store_id and reopened_from is not null and reopened_from>p_effective_date) then raise exception '关店日期不能覆盖已有的经营历史'; end if;
   if c.id is null then
     select coalesce(bool_or(enabled),false) into restore_sync from public.pos_sales_integrations where store_id=p_store_id;
     insert into public.store_business_closures(store_id,closed_from,resume_sales_sync,updated_by) values(p_store_id,p_effective_date,restore_sync,auth.uid()) returning id into sid;
   else
     update public.store_business_closures set closed_from=p_effective_date,updated_by=auth.uid(),updated_at=now() where id=c.id returning id into sid;
   end if;
   update public.pos_sales_integrations set enabled=false where store_id=p_store_id;
 end if;
 insert into public.system_operation_logs(actor_id,actor_name_snapshot,actor_username_snapshot,actor_role_snapshot,actor_employment_type_snapshot,store_id,module,operation,entity_type,entity_id,summary,metadata)
 select id,display_name,username,role,employment_type,p_store_id,'account','updated','store_business_closures',sid,
 case when p_operating then '恢复门店营业' else '设置门店关店' end,jsonb_build_object('effectiveDate',p_effective_date,'afterStatus',case when p_operating then 'operating' else 'closed' end) from public.profiles where id=auth.uid();
 return sid;
end;
$$;
create function public.guard_closed_store_sales_sync() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.enabled and not public.store_is_operating_on(new.store_id,(now() at time zone 'Asia/Shanghai')::date) then raise exception '门店已关店，请先恢复营业再启用自动同步'; end if;
 return new;
end;
$$;
create trigger pos_sales_operating_guard before insert or update of enabled,store_id on public.pos_sales_integrations for each row execute function public.guard_closed_store_sales_sync();
revoke all on function public.store_is_operating_on(uuid,date),public.store_has_operating_days(uuid,date,date),public.admin_set_store_operating(uuid,boolean,date),public.guard_closed_store_sales_sync() from public,anon;
grant execute on function public.store_is_operating_on(uuid,date),public.store_has_operating_days(uuid,date,date) to authenticated,service_role;
grant execute on function public.admin_set_store_operating(uuid,boolean,date) to authenticated;

create or replace function public.payroll_performance_store_scope(p_profile_id uuid,p_rule_id uuid,p_as_of date)
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
  select daily.store_id,sum(ratio)/(select count(distinct work_date) from daily) from daily where public.store_has_operating_days(daily.store_id,date_trunc('month',p_as_of)::date,p_as_of) group by daily.store_id;
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
  v_open_attendance numeric;
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
  if v_store_count <= 1 and v_config_count = 0 and not exists(select 1 from public.profile_store_assignment_periods m join public.store_business_closures c on c.store_id=m.store_id where m.profile_id=p_profile_id and c.closed_from<=p_as_of and (c.reopened_from is null or c.reopened_from>v_month)) and not exists(select 1 from public.profile_store_assignment_periods where profile_id=p_profile_id and effective_to <= p_as_of) then
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
      and public.store_is_operating_on(task.store_id,(task.due_at at time zone 'Asia/Shanghai')::date)
      and task.status <> 'cancelled'
      and (task.assigned_profile_id = p_profile_id or task.assigned_profile_id is null);

    select coalesce(sum(case when daily.late_minutes between 1 and 10 then v_perf.late_deduction_1_10
      when daily.late_minutes between 11 and 20 then v_perf.late_deduction_11_20
      when daily.late_minutes between 21 and 30 then v_perf.late_deduction_21_30
      when daily.late_minutes >= 31 then v_perf.late_deduction_31_plus else 0 end), 0)
    into v_late_deduction
    from public.attendance_daily_records daily
    where daily.profile_id = p_profile_id and daily.store_id = v_store.store_id
      and public.store_is_operating_on(daily.store_id,daily.attendance_date)
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
    v_open_attendance:=v_attendance_days;
    if exists(select 1 from public.store_business_closures c where c.store_id=v_store.store_id and c.closed_from<=p_as_of and (c.reopened_from is null or c.reopened_from>v_month)) then
    select count(distinct d.attendance_date) into v_open_attendance from public.attendance_daily_records d
      where d.profile_id=p_profile_id and d.is_attended and d.attendance_date between v_month and p_as_of
      and public.store_is_operating_on(v_store.store_id,d.attendance_date)
      ;
    end if;
    v_attendance_factor:=case when v_full_days>0 then least(v_open_attendance/v_full_days,1) else 0 end;
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
  if v_store_count=0 then
    v_final_override:=null;
    v_result:=v_result||jsonb_build_object('performanceReady',true,'dataIssues',coalesce((select jsonb_agg(x) from jsonb_array_elements_text(coalesce(v_result->'dataIssues','[]'::jsonb)) x where x not like '%绩效%' and x not like '%任务数据%'),'[]'::jsonb));
  elsif v_final_override is not null then v_new_amount:=v_final_override; end if;

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
        and public.store_is_operating_on(input.store_id,input.as_of_date)
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
        and public.store_is_operating_on(revenue.store_id,revenue.revenue_date)
        and revenue.revenue_date between date_trunc('month', p_as_of)::date and p_as_of
    ) daily on true
    where scope.rule_id = v_rule_id and public.store_has_operating_days(scope.store_id,date_trunc('month',p_as_of)::date,p_as_of)
      and exists(select 1 from public.profile_store_assignment_periods membership where membership.profile_id=p_profile_id and membership.store_id=scope.store_id and membership.effective_from <= p_as_of and (membership.effective_to is null or membership.effective_to>date_trunc('month',p_as_of)::date))
  )
  select count(*)::integer,
    coalesce(sum(amount), 0),
    coalesce(bool_and(ready), false),
    max(updated_at),
    min(effective_date)
  into v_required, v_revenue, v_ready, v_updated, v_effective_date
  from store_values;

  v_ready := (v_required>0 and v_ready and v_rate is not null) or (v_required=0 and exists(select 1 from public.payroll_employee_commission_stores s where s.rule_id=v_rule_id and not public.store_has_operating_days(s.store_id,date_trunc('month',p_as_of)::date,p_as_of)));
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
  v_result := jsonb_set(v_result, '{revenueCarriedForward}', to_jsonb(coalesce(v_ready and v_effective_date < p_as_of,false)), true);
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

notify pgrst, 'reload schema';

create or replace function public.admin_payroll_statistics_inputs(p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_result jsonb;
  v_revenues jsonb;
begin
  v_result := public.admin_payroll_statistics_inputs_before_manual_revenue(p_from, p_to);

  with month_segments as (
    select month_start::date,
      greatest(p_from, month_start::date) segment_from,
      least(p_to, (month_start + interval '1 month - 1 day')::date) segment_to
    from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') month_start
  ), store_segments as (
    select store.id store_id, segment.month_start, segment.segment_from, segment.segment_to
    from public.stores store cross join month_segments segment
    where store.is_active and public.has_store_access(store.id)
  ), resolved as (
    select segment.store_id,
      greatest(
        case when end_input.input_mode = 'manual' then coalesce(end_input.manual_cumulative_amount, 0)
          else coalesce(end_daily.amount, 0) end
        - case when segment.segment_from = segment.month_start then 0
          when start_input.input_mode = 'manual' then coalesce(start_input.manual_cumulative_amount, 0)
          else coalesce(start_daily.amount, 0) end,
        0
      ) amount
    from store_segments segment
    left join lateral (
      select input.input_mode, input.manual_cumulative_amount
      from public.payroll_store_revenue_inputs input
      where input.store_id = segment.store_id
        and public.store_is_operating_on(input.store_id,input.as_of_date)
        and input.as_of_date between segment.month_start and segment.segment_to
      order by input.as_of_date desc, input.updated_at desc limit 1
    ) end_input on true
    left join lateral (
      select coalesce(sum(revenue.confirmed_amount), 0) amount
      from public.payroll_store_revenues revenue
      where revenue.store_id = segment.store_id
        and public.store_is_operating_on(revenue.store_id,revenue.revenue_date)
        and revenue.revenue_date between segment.month_start and segment.segment_to
    ) end_daily on true
    left join lateral (
      select input.input_mode, input.manual_cumulative_amount
      from public.payroll_store_revenue_inputs input
      where input.store_id = segment.store_id
        and public.store_is_operating_on(input.store_id,input.as_of_date)
        and input.as_of_date between segment.month_start and segment.segment_from - 1
      order by input.as_of_date desc, input.updated_at desc limit 1
    ) start_input on true
    left join lateral (
      select coalesce(sum(revenue.confirmed_amount), 0) amount
      from public.payroll_store_revenues revenue
      where revenue.store_id = segment.store_id
        and public.store_is_operating_on(revenue.store_id,revenue.revenue_date)
        and revenue.revenue_date between segment.month_start and segment.segment_from - 1
    ) start_daily on true
  ), totals as (
    select store_id, round(sum(amount), 2) amount from resolved group by store_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('storeId', total.store_id, 'amount', total.amount) order by total.store_id), '[]'::jsonb)
  into v_revenues from totals total;

  return jsonb_set(v_result, '{revenues}', v_revenues, true);
end;
$$;

