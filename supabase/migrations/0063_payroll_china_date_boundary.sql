-- Supabase databases use UTC by default. Payroll cutoffs follow the operating
-- timezone so the current China calendar day must not be rejected after midnight.

alter function public.get_payroll_estimate(uuid, date)
  rename to calculate_payroll_estimate_internal;

alter function public.admin_payroll_estimates(date, uuid, text)
  rename to calculate_admin_payroll_estimates_internal;

revoke all on function public.calculate_payroll_estimate_internal(uuid, date),
  public.calculate_admin_payroll_estimates_internal(date, uuid, text) from public, authenticated;

create function public.get_payroll_estimate(
  p_profile_id uuid,
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date)
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('TimeZone', 'Asia/Shanghai', true);
  return public.calculate_payroll_estimate_internal(p_profile_id, p_as_of);
end;
$$;

create function public.admin_payroll_estimates(
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date),
  p_store_id uuid default null,
  p_search text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('TimeZone', 'Asia/Shanghai', true);
  return public.calculate_admin_payroll_estimates_internal(p_as_of, p_store_id, p_search);
end;
$$;

revoke all on function public.get_payroll_estimate(uuid, date),
  public.admin_payroll_estimates(date, uuid, text) from public;
grant execute on function public.get_payroll_estimate(uuid, date),
  public.admin_payroll_estimates(date, uuid, text) to authenticated;
