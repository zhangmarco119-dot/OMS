-- Keep using the latest available commission base inside the selected month.
-- A new cutoff date no longer makes payroll incomplete merely because today's
-- POS sync has not run yet. Manual bases remain persistent until the
-- administrator switches the store back to POS sync.

alter function public.get_payroll_estimate(uuid, date)
  rename to calculate_payroll_estimate_before_revenue_carry_forward;

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
$$;

revoke all on function public.calculate_payroll_estimate_before_revenue_carry_forward(uuid,date) from public, anon, authenticated;
revoke all on function public.get_payroll_estimate(uuid,date) from public, anon;
grant execute on function public.get_payroll_estimate(uuid,date) to authenticated;
