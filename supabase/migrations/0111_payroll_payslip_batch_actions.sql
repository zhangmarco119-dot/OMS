-- Allow an administrator to send or withdraw all eligible payslips for a
-- selected month in one atomic action.

create function public.admin_send_payroll_payslips(p_payslip_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  if public.current_user_role() <> 'admin' then
    raise exception '仅管理员可以批量发送工资单';
  end if;
  if coalesce(cardinality(p_payslip_ids), 0) = 0 then
    raise exception '没有待发送的工资单';
  end if;
  if cardinality(p_payslip_ids) > 500 then
    raise exception '单次最多处理 500 份工资单';
  end if;

  for v_id in select distinct id from unnest(p_payslip_ids) as ids(id) loop
    perform public.admin_send_payroll_payslip(v_id);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('processedCount', v_count);
end;
$$;

create function public.admin_withdraw_payroll_payslips(p_payslip_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  if public.current_user_role() <> 'admin' then
    raise exception '仅管理员可以批量撤回工资单';
  end if;
  if coalesce(cardinality(p_payslip_ids), 0) = 0 then
    raise exception '没有可撤回的工资单';
  end if;
  if cardinality(p_payslip_ids) > 500 then
    raise exception '单次最多处理 500 份工资单';
  end if;

  for v_id in select distinct id from unnest(p_payslip_ids) as ids(id) loop
    perform public.admin_withdraw_payroll_payslip(v_id);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('processedCount', v_count);
end;
$$;

revoke all on function public.admin_send_payroll_payslips(uuid[]) from public, anon;
revoke all on function public.admin_withdraw_payroll_payslips(uuid[]) from public, anon;
grant execute on function public.admin_send_payroll_payslips(uuid[]) to authenticated;
grant execute on function public.admin_withdraw_payroll_payslips(uuid[]) to authenticated;

comment on function public.admin_send_payroll_payslips(uuid[]) is
  'Atomically sends the selected draft payroll payslips and creates employee notifications.';
comment on function public.admin_withdraw_payroll_payslips(uuid[]) is
  'Atomically withdraws selected sent or confirmed payroll payslips and removes employee notifications.';
