-- Make the commission base explicitly month-to-date. Administrators can use
-- POS-derived daily revenue or set a manual cumulative amount for one cutoff
-- date without mixing the two sources.

create table public.payroll_store_revenue_inputs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  as_of_date date not null,
  input_mode text not null check (input_mode in ('pos_sync', 'manual')),
  manual_cumulative_amount numeric(14,2),
  note text not null default '',
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, as_of_date),
  check (
    (input_mode = 'manual' and manual_cumulative_amount is not null and manual_cumulative_amount >= 0)
    or (input_mode = 'pos_sync' and manual_cumulative_amount is null)
  )
);

create trigger payroll_store_revenue_inputs_touch_updated_at
before update on public.payroll_store_revenue_inputs
for each row execute function public.touch_updated_at();

alter table public.payroll_store_revenue_inputs enable row level security;
create policy payroll_store_revenue_inputs_admin_all
on public.payroll_store_revenue_inputs for all to authenticated
using (public.current_user_role() = 'admin' and public.has_store_access(store_id))
with check (public.current_user_role() = 'admin' and public.has_store_access(store_id));
grant select, insert, update, delete on public.payroll_store_revenue_inputs to authenticated;

create or replace function public.save_payroll_store_revenue_input(
  p_store_id uuid,
  p_as_of_date date,
  p_input_mode text,
  p_manual_cumulative_amount numeric default null,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input public.payroll_store_revenue_inputs%rowtype;
begin
  if public.current_user_role() <> 'admin' or not public.has_store_access(p_store_id) then
    raise exception 'administrator store access required' using errcode = '42501';
  end if;
  if p_as_of_date > (now() at time zone 'Asia/Shanghai')::date then
    raise exception 'revenue cutoff date cannot be in the future';
  end if;
  if p_input_mode not in ('pos_sync', 'manual') then
    raise exception 'invalid revenue input mode';
  end if;
  if p_input_mode = 'manual' and (p_manual_cumulative_amount is null or p_manual_cumulative_amount < 0) then
    raise exception 'manual cumulative revenue is required';
  end if;

  insert into public.payroll_store_revenue_inputs(
    store_id, as_of_date, input_mode, manual_cumulative_amount, note, updated_by
  ) values (
    p_store_id,
    p_as_of_date,
    p_input_mode,
    case when p_input_mode = 'manual' then p_manual_cumulative_amount else null end,
    coalesce(trim(p_note), ''),
    auth.uid()
  )
  on conflict(store_id, as_of_date) do update
  set input_mode = excluded.input_mode,
      manual_cumulative_amount = excluded.manual_cumulative_amount,
      note = excluded.note,
      updated_by = excluded.updated_by,
      updated_at = now()
  returning * into v_input;
  return to_jsonb(v_input);
end;
$$;
revoke all on function public.save_payroll_store_revenue_input(uuid,date,text,numeric,text) from public, anon;
grant execute on function public.save_payroll_store_revenue_input(uuid,date,text,numeric,text) to authenticated;

alter table public.pos_sales_sync_jobs add column sync_end_date date;
update public.pos_sales_sync_jobs set sync_end_date = sync_date where sync_end_date is null;
alter table public.pos_sales_sync_jobs alter column sync_end_date set not null;

create or replace function public.replace_pos_sales_range(
  p_integration_id uuid,
  p_sync_job_id uuid,
  p_start_date date,
  p_end_date date,
  p_tickets jsonb,
  p_api_call_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_integration public.pos_sales_integrations%rowtype;
  v_job public.pos_sales_sync_jobs%rowtype;
  v_revenue numeric(14,2);
  v_valid_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_tickets) <> 'array' then
    raise exception 'POS tickets must be an array';
  end if;
  if p_end_date < p_start_date
    or p_end_date - p_start_date > 30
    or date_trunc('month', p_start_date) <> date_trunc('month', p_end_date) then
    raise exception 'POS range must stay within one month and 31 days';
  end if;

  select * into v_integration
  from public.pos_sales_integrations
  where id = p_integration_id
  for update;
  select * into v_job
  from public.pos_sales_sync_jobs
  where id = p_sync_job_id and integration_id = p_integration_id
  for update;
  if v_integration.id is null or v_job.id is null then
    raise exception 'POS integration or sync job not found';
  end if;

  delete from public.pos_sales_tickets
  where integration_id = p_integration_id
    and revenue_date between p_start_date and p_end_date;

  insert into public.pos_sales_tickets(
    integration_id, store_id, sync_job_id, revenue_date, external_key,
    external_sn, occurred_at, source_updated_at, ticket_type, invalid,
    total_amount, order_source
  )
  select
    v_integration.id,
    v_integration.store_id,
    v_job.id,
    ((item->>'occurredAt')::timestamptz at time zone 'Asia/Shanghai')::date,
    item->>'externalKey',
    nullif(item->>'externalSn', ''),
    (item->>'occurredAt')::timestamptz,
    nullif(item->>'sourceUpdatedAt', '')::timestamptz,
    item->>'ticketType',
    coalesce((item->>'invalid')::boolean, false),
    (item->>'totalAmount')::numeric,
    nullif(item->>'orderSource', '')
  from jsonb_array_elements(p_tickets) item
  where ((item->>'occurredAt')::timestamptz at time zone 'Asia/Shanghai')::date
    between p_start_date and p_end_date;

  with days as (
    select generate_series(p_start_date, p_end_date, interval '1 day')::date revenue_date
  ), totals as (
    select ticket.revenue_date,
      coalesce(sum(case
        when ticket.invalid then 0
        when ticket.ticket_type = 'SELL_RETURN' then -abs(ticket.total_amount)
        else ticket.total_amount
      end), 0)::numeric(14,2) confirmed_amount
    from public.pos_sales_tickets ticket
    where ticket.integration_id = p_integration_id
      and ticket.revenue_date between p_start_date and p_end_date
    group by ticket.revenue_date
  )
  insert into public.payroll_store_revenues(
    store_id, revenue_date, confirmed_amount, note, updated_by,
    source, source_reference_id, source_updated_at
  )
  select
    v_integration.store_id,
    day.revenue_date,
    coalesce(total.confirmed_amount, 0),
    '银豹收银系统月累计同步',
    v_integration.configured_by,
    'pospal',
    v_job.id,
    now()
  from days day
  left join totals total using(revenue_date)
  on conflict(store_id, revenue_date) do update
  set confirmed_amount = excluded.confirmed_amount,
      note = excluded.note,
      updated_by = excluded.updated_by,
      source = excluded.source,
      source_reference_id = excluded.source_reference_id,
      source_updated_at = excluded.source_updated_at;

  select
    coalesce(sum(case
      when invalid then 0
      when ticket_type = 'SELL_RETURN' then -abs(total_amount)
      else total_amount
    end), 0),
    count(*) filter (where not invalid)
  into v_revenue, v_valid_count
  from public.pos_sales_tickets
  where integration_id = p_integration_id
    and revenue_date between p_start_date and p_end_date;

  update public.pos_sales_sync_jobs
  set status = 'succeeded',
      sync_end_date = p_end_date,
      api_call_count = p_api_call_count,
      page_count = p_api_call_count,
      fetched_count = jsonb_array_length(p_tickets),
      valid_count = v_valid_count,
      revenue_amount = v_revenue,
      error_message = null,
      finished_at = now()
  where id = v_job.id;

  update public.pos_sales_integrations
  set last_sync_at = now(),
      last_success_at = now(),
      last_error = null
  where id = v_integration.id;

  return jsonb_build_object(
    'syncDate', p_start_date,
    'syncEndDate', p_end_date,
    'ticketCount', jsonb_array_length(p_tickets),
    'validCount', v_valid_count,
    'revenueAmount', v_revenue,
    'apiCallCount', p_api_call_count
  );
end;
$$;
revoke all on function public.replace_pos_sales_range(uuid,uuid,date,date,jsonb,integer) from public, anon, authenticated;
grant execute on function public.replace_pos_sales_range(uuid,uuid,date,date,jsonb,integer) to service_role;

alter function public.get_payroll_estimate(uuid, date)
  rename to calculate_payroll_estimate_before_revenue_input;

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
begin
  v_result := public.calculate_payroll_estimate_before_revenue_input(p_profile_id, p_as_of);
  if not coalesce((v_result->>'commissionEnabled')::boolean, false)
    or nullif(v_result->>'ruleId', '') is null then
    return v_result;
  end if;

  v_rule_id := (v_result->>'ruleId')::uuid;
  v_rate := nullif(v_result->>'commissionRate', '')::numeric;

  with store_values as (
    select scope.store_id,
      case
        when input.input_mode = 'manual' then input.manual_cumulative_amount
        else coalesce(daily.amount, 0)
      end amount,
      case
        when input.input_mode = 'manual' then input.manual_cumulative_amount is not null
        else coalesce(daily.has_cutoff, false)
      end ready,
      greatest(input.updated_at, daily.updated_at) updated_at
    from public.payroll_employee_commission_stores scope
    left join public.payroll_store_revenue_inputs input
      on input.store_id = scope.store_id and input.as_of_date = p_as_of
    left join lateral (
      select coalesce(sum(revenue.confirmed_amount), 0) amount,
        bool_or(revenue.revenue_date = p_as_of) has_cutoff,
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
    max(updated_at)
  into v_required, v_revenue, v_ready, v_updated
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

revoke all on function public.calculate_payroll_estimate_before_revenue_input(uuid,date) from public, anon, authenticated;
revoke all on function public.get_payroll_estimate(uuid,date) from public, anon;
grant execute on function public.get_payroll_estimate(uuid,date) to authenticated;
