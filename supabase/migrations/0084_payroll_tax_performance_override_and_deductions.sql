-- Add administrator performance overrides, payslip individual income tax and
-- itemized deduction details for both employees and administrators.

alter table public.payroll_employee_rules
  add column performance_override_enabled boolean not null default false,
  add column performance_override_amount numeric(12,2) not null default 0,
  add constraint payroll_employee_rules_performance_override_amount_check
    check (performance_override_amount >= 0);

alter function public.admin_save_payroll_employee_rule(uuid, jsonb, uuid[])
  rename to admin_save_payroll_employee_rule_before_performance_override;

create function public.admin_save_payroll_employee_rule(
  p_profile_id uuid,
  p_fields jsonb,
  p_store_ids uuid[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_rule_id uuid;
  v_override_enabled boolean := coalesce((p_fields->>'performanceOverrideEnabled')::boolean, false);
  v_override_amount numeric := coalesce(nullif(p_fields->>'performanceOverrideAmount', '')::numeric, 0);
begin
  if v_override_amount < 0 then raise exception 'performance override amount must not be negative'; end if;
  v_rule_id := public.admin_save_payroll_employee_rule_before_performance_override(p_profile_id, p_fields, p_store_ids);
  update public.payroll_employee_rules
  set performance_override_enabled = v_override_enabled,
      performance_override_amount = v_override_amount
  where id = v_rule_id;
  return v_rule_id;
end;
$$;

create function public.get_payroll_deduction_items(
  p_profile_id uuid,
  p_from date,
  p_to date
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_items jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception 'invalid payroll deduction range'; end if;
  if p_profile_id <> auth.uid() and not public.can_admin_manage_attendance_profile(p_profile_id) then
    raise exception 'payroll deduction access denied';
  end if;

  with deduction_rows as (
    select
      'late:' || daily.id::text item_id,
      daily.attendance_date event_date,
      daily.created_at,
      'late'::text item_type,
      '迟到罚款'::text title,
      ('迟到 ' || daily.late_minutes || ' 分钟')::text reason,
      (case when daily.late_minutes between 1 and 10 then 20
            when daily.late_minutes between 11 and 20 then 50
            when daily.late_minutes between 21 and 30 then 100
            when daily.late_minutes >= 31 then 200 else 0 end)::numeric amount,
      0::numeric performance_deduction
    from public.attendance_daily_records daily
    where daily.profile_id = p_profile_id
      and daily.attendance_date between p_from and p_to
      and daily.late_minutes > 0
    union all
    select
      'penalty:' || penalty.id::text,
      penalty.event_date,
      penalty.created_at,
      'penalty'::text,
      '其他罚款'::text,
      penalty.reason,
      penalty.amount,
      penalty.performance_deduction
    from public.payroll_penalties penalty
    where penalty.profile_id = p_profile_id
      and penalty.event_date between p_from and p_to
      and penalty.status = 'active'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item_id,
    'date', event_date,
    'createdAt', created_at,
    'type', item_type,
    'title', title,
    'reason', reason,
    'amount', amount,
    'performanceDeduction', performance_deduction
  ) order by event_date desc, created_at desc), '[]'::jsonb)
  into v_items
  from deduction_rows
  where amount > 0;

  return v_items;
end;
$$;

alter function public.get_payroll_estimate(uuid, date)
  rename to calculate_payroll_estimate_before_override_and_deductions;

create function public.get_payroll_estimate(
  p_profile_id uuid,
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date)
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb;
  v_rule_id uuid;
  v_override_enabled boolean := false;
  v_override_amount numeric := 0;
  v_performance_enabled boolean := false;
  v_auto_performance numeric := 0;
  v_delta numeric := 0;
  v_known numeric := 0;
  v_complete boolean := false;
  v_issues jsonb := '[]'::jsonb;
  v_deductions jsonb := '[]'::jsonb;
begin
  v_result := public.calculate_payroll_estimate_before_override_and_deductions(p_profile_id, p_as_of);
  if nullif(v_result->>'ruleId', '') is not null then
    v_rule_id := (v_result->>'ruleId')::uuid;
    select rule.performance_enabled, rule.performance_override_enabled, rule.performance_override_amount
      into v_performance_enabled, v_override_enabled, v_override_amount
    from public.payroll_employee_rules rule
    where rule.id = v_rule_id;
  end if;

  if coalesce(v_performance_enabled, false) and coalesce(v_override_enabled, false) then
    v_auto_performance := coalesce(nullif(v_result->>'accruedPerformance', '')::numeric, 0);
    v_delta := coalesce(v_override_amount, 0) - v_auto_performance;
    v_known := round(coalesce((v_result->>'knownEstimatedPayable')::numeric, 0) + v_delta, 2);

    select coalesce(jsonb_agg(issue), '[]'::jsonb)
      into v_issues
    from jsonb_array_elements_text(coalesce(v_result->'dataIssues', '[]'::jsonb)) issue
    where issue not like '%绩效%';

    v_complete := nullif(v_result->>'ruleId', '') is not null
      and coalesce((v_result->>'ruleConfirmed')::boolean, false)
      and coalesce((v_result->>'commissionReady')::boolean, false);
    v_result := v_result || jsonb_build_object(
      'performanceOverrideEnabled', true,
      'performanceOverrideAmount', round(coalesce(v_override_amount, 0), 2),
      'performanceCalculationMode', 'override',
      'performanceReady', true,
      'accruedPerformance', round(coalesce(v_override_amount, 0), 2),
      'incomeSubtotalKnown', round(coalesce((v_result->>'incomeSubtotalKnown')::numeric, 0) + v_delta, 2),
      'knownEstimatedPayable', v_known,
      'estimatedPayable', case when v_complete then v_known else null end,
      'dataComplete', v_complete,
      'dataIssues', v_issues
    );
  else
    v_result := v_result || jsonb_build_object(
      'performanceOverrideEnabled', false,
      'performanceOverrideAmount', round(coalesce(v_override_amount, 0), 2),
      'performanceCalculationMode', 'automatic'
    );
  end if;

  v_deductions := public.get_payroll_deduction_items(
    p_profile_id,
    date_trunc('month', p_as_of)::date,
    p_as_of
  );
  v_result := v_result || jsonb_build_object(
    'deductionItems', v_deductions,
    'individualIncomeTax', 0,
    'deductionTotal', coalesce((v_result->>'fineTotal')::numeric, 0)
  );
  return v_result;
end;
$$;

alter function public.admin_update_payroll_payslip(uuid, jsonb)
  rename to admin_update_payroll_payslip_before_individual_tax;

create function public.admin_update_payroll_payslip(p_payslip_id uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb;
  v_tax numeric := coalesce(nullif(p_fields->>'individualIncomeTax', '')::numeric, 0);
  v_row public.payroll_payslips;
  v_known numeric;
  v_estimated numeric;
begin
  if v_tax < 0 then raise exception 'individual income tax must not be negative'; end if;
  v_result := public.admin_update_payroll_payslip_before_individual_tax(p_payslip_id, p_fields);
  select * into v_row from public.payroll_payslips where id = p_payslip_id for update;
  v_known := coalesce((v_row.estimate_snapshot->>'knownEstimatedPayable')::numeric, 0) - v_tax;
  v_estimated := coalesce((v_row.estimate_snapshot->>'estimatedPayable')::numeric, v_known + v_tax) - v_tax;
  update public.payroll_payslips as payslip set estimate_snapshot = payslip.estimate_snapshot || jsonb_build_object(
    'individualIncomeTax', round(v_tax, 2),
    'deductionTotal', round(coalesce((payslip.estimate_snapshot->>'fineTotal')::numeric, 0) + v_tax, 2),
    'knownEstimatedPayable', round(v_known, 2),
    'estimatedPayable', round(v_estimated, 2)
  ) where payslip.id = p_payslip_id returning to_jsonb(payslip.*) into v_result;
  return v_result;
end;
$$;

revoke all on function public.admin_save_payroll_employee_rule_before_performance_override(uuid,jsonb,uuid[]) from public,anon,authenticated;
revoke all on function public.calculate_payroll_estimate_before_override_and_deductions(uuid,date) from public,anon,authenticated;
revoke all on function public.admin_update_payroll_payslip_before_individual_tax(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.get_payroll_deduction_items(uuid,date,date), public.get_payroll_estimate(uuid,date), public.admin_save_payroll_employee_rule(uuid,jsonb,uuid[]), public.admin_update_payroll_payslip(uuid,jsonb) from public,anon;
grant execute on function public.get_payroll_deduction_items(uuid,date,date), public.get_payroll_estimate(uuid,date), public.admin_save_payroll_employee_rule(uuid,jsonb,uuid[]), public.admin_update_payroll_payslip(uuid,jsonb) to authenticated;
