-- Re-saving a monthly tax register submits all populated rows. Avoid creating
-- new payslip revisions for employees whose registered amount did not change.

create or replace function public.admin_save_payroll_individual_tax_override(
  p_profile_id uuid,
  p_payroll_month date,
  p_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_payroll_month)::date;
  v_sync jsonb;
  v_previous numeric;
  v_has_previous boolean := false;
begin
  if public.current_user_role() <> 'admin' or not public.can_admin_manage_attendance_profile(p_profile_id) then
    raise exception 'payroll tax access denied';
  end if;
  if p_amount is null then
    delete from public.payroll_individual_tax_overrides
    where profile_id = p_profile_id and payroll_month = v_month;
    return jsonb_build_object('mode', 'automatic', 'amount', null, 'synced', false);
  end if;
  if p_amount < 0 then raise exception 'individual income tax must not be negative'; end if;

  select amount, true into v_previous, v_has_previous
  from public.payroll_individual_tax_overrides
  where profile_id = p_profile_id and payroll_month = v_month;
  if v_has_previous and round(v_previous, 2) = round(p_amount, 2) then
    return jsonb_build_object(
      'mode', 'registered', 'amount', round(p_amount, 2), 'unchanged', true,
      'payslip', jsonb_build_object('synced', false, 'reason', 'unchanged')
    );
  end if;

  insert into public.payroll_individual_tax_overrides(profile_id, payroll_month, amount, updated_by)
  values(p_profile_id, v_month, round(p_amount, 2), auth.uid())
  on conflict(profile_id, payroll_month) do update set
    amount = excluded.amount,
    updated_by = auth.uid(),
    updated_at = now();

  v_sync := public.sync_registered_tax_to_payroll_payslip(p_profile_id, v_month, round(p_amount, 2));
  return jsonb_build_object('mode', 'registered', 'amount', round(p_amount, 2), 'unchanged', false, 'payslip', v_sync);
end;
$$;
