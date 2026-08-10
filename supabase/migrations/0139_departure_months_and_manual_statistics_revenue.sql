-- Include manually maintained month-to-date revenue in payroll statistics and
-- allow an administrator to exclude housing, performance and commission for
-- one or two consecutive departure months.

create table public.payroll_employee_departure_months (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  payroll_month date not null check (payroll_month = date_trunc('month', payroll_month)::date),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(profile_id, payroll_month)
);

alter table public.payroll_employee_departure_months enable row level security;

create policy payroll_employee_departure_months_admin_select
on public.payroll_employee_departure_months for select to authenticated
using(public.current_user_role() = 'admin' and public.can_admin_manage_attendance_profile(profile_id));

grant select on public.payroll_employee_departure_months to authenticated;

create or replace function public.admin_save_payroll_employee_rule_v2(
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
  v_departure_start date;
  v_departure_count integer := 0;
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

  if p_fields ? 'departureMonthStart' or p_fields ? 'departureMonthCount' then
    v_departure_start := date_trunc('month', nullif(p_fields->>'departureMonthStart', '')::date)::date;
    v_departure_count := coalesce(nullif(p_fields->>'departureMonthCount', '')::integer, 0);
    if v_departure_start is null and v_departure_count <> 0 then raise exception 'departure month is required'; end if;
    if v_departure_start is not null and v_departure_count not in (1, 2) then raise exception 'departure month count must be one or two'; end if;
  end if;

  v_rule_id := public.admin_save_payroll_employee_rule(
    p_profile_id, p_fields, coalesce(p_commission_store_ids, '{}'::uuid[])
  );
  delete from public.payroll_employee_performance_stores where rule_id = v_rule_id;
  insert into public.payroll_employee_performance_stores(rule_id, store_id, allocation_ratio)
  select v_rule_id, (entry->>'storeId')::uuid, (entry->>'allocationRatio')::numeric
  from jsonb_array_elements(coalesce(p_performance_stores, '[]'::jsonb)) entry;

  if p_fields ? 'departureMonthStart' or p_fields ? 'departureMonthCount' then
    delete from public.payroll_employee_departure_months where profile_id = p_profile_id;
    if v_departure_start is not null then
      insert into public.payroll_employee_departure_months(profile_id, payroll_month, updated_by)
      select p_profile_id, (v_departure_start + make_interval(months => offset_value))::date, auth.uid()
      from generate_series(0, v_departure_count - 1) offset_value;
    end if;
  end if;
  return v_rule_id;
end;
$$;

alter function public.calculate_payroll_estimate_before_estimated_individual_tax(uuid, date)
  rename to calculate_payroll_estimate_before_departure_month;

create function public.calculate_payroll_estimate_before_estimated_individual_tax(
  p_profile_id uuid,
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date)
)
returns jsonb language plpgsql security definer set search_path = public as $$
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

alter function public.admin_payroll_statistics_inputs(date, date)
  rename to admin_payroll_statistics_inputs_before_manual_revenue;

create function public.admin_payroll_statistics_inputs(p_from date, p_to date)
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
        and input.as_of_date between segment.month_start and segment.segment_to
      order by input.as_of_date desc, input.updated_at desc limit 1
    ) end_input on true
    left join lateral (
      select coalesce(sum(revenue.confirmed_amount), 0) amount
      from public.payroll_store_revenues revenue
      where revenue.store_id = segment.store_id
        and revenue.revenue_date between segment.month_start and segment.segment_to
    ) end_daily on true
    left join lateral (
      select input.input_mode, input.manual_cumulative_amount
      from public.payroll_store_revenue_inputs input
      where input.store_id = segment.store_id
        and input.as_of_date between segment.month_start and segment.segment_from - 1
      order by input.as_of_date desc, input.updated_at desc limit 1
    ) start_input on true
    left join lateral (
      select coalesce(sum(revenue.confirmed_amount), 0) amount
      from public.payroll_store_revenues revenue
      where revenue.store_id = segment.store_id
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

revoke all on table public.payroll_employee_departure_months from anon;
revoke insert, update, delete on table public.payroll_employee_departure_months from authenticated;
revoke all on function public.calculate_payroll_estimate_before_departure_month(uuid,date),
  public.calculate_payroll_estimate_before_estimated_individual_tax(uuid,date),
  public.admin_payroll_statistics_inputs_before_manual_revenue(date,date)
from public, anon, authenticated;
revoke all on function public.admin_payroll_statistics_inputs(date,date) from public, anon;
grant execute on function public.admin_payroll_statistics_inputs(date,date) to authenticated;

comment on table public.payroll_employee_departure_months is
  'One or two consecutive months in which housing, performance and commission are excluded for a departing employee.';
comment on function public.admin_payroll_statistics_inputs(date,date) is
  'Returns administrator payroll statistics using POS revenue or the effective manually maintained month-to-date revenue source.';
