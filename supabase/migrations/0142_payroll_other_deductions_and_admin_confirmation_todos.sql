-- Keep individual income tax separate from other deductions in the client, and
-- create a durable per-administrator read todo when an employee confirms a payslip.

create or replace function public.confirm_my_payroll_payslip(p_payslip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payroll_payslips;
  v_employee_name text;
begin
  update public.payroll_payslips
  set status = 'confirmed', confirmed_at = now()
  where id = p_payslip_id
    and profile_id = auth.uid()
    and status = 'issued'
  returning * into v_row;

  if v_row.id is null then
    raise exception '工资单不存在、已经确认或不属于当前账号';
  end if;

  select coalesce(nullif(btrim(profile.display_name), ''), '员工')
  into v_employee_name
  from public.profiles profile
  where profile.id = v_row.profile_id;

  update public.notifications
  set is_read = true, read_at = coalesce(read_at, now())
  where recipient_user_id = auth.uid()
    and entity_type = 'payroll_payslip'
    and entity_id = v_row.id;

  insert into public.notifications(
    recipient_user_id,
    store_id,
    type,
    title,
    body,
    entity_type,
    entity_id,
    dedupe_key
  )
  select
    admin_profile.id,
    v_row.store_id,
    'payroll_payslip_confirmed',
    v_employee_name || '已确认工资单',
    to_char(v_row.payroll_month, 'YYYY年MM月') || '工资单已于' || to_char(v_row.confirmed_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') || '确认，请阅读确认结果。',
    'payroll_payslip_confirmation',
    v_row.id,
    'payroll-payslip-confirmed:' || v_row.id::text || ':' || v_row.revision::text || ':' || admin_profile.id::text
  from public.profiles admin_profile
  where admin_profile.role = 'admin'
    and admin_profile.is_active
    and admin_profile.deleted_at is null
    and (
      v_row.store_id is null
      or admin_profile.store_id = v_row.store_id
      or exists (
        select 1
        from public.profile_store_access access
        where access.profile_id = admin_profile.id
          and access.store_id = v_row.store_id
      )
    )
  on conflict(dedupe_key) do nothing;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.expire_payroll_confirmation_todos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'confirmed' and new.status <> 'confirmed' then
    update public.notifications
    set is_read = true, read_at = coalesce(read_at, now())
    where entity_type = 'payroll_payslip_confirmation'
      and entity_id = new.id
      and not is_read;
  end if;
  return new;
end;
$$;

drop trigger if exists payroll_payslips_expire_confirmation_todos on public.payroll_payslips;
create trigger payroll_payslips_expire_confirmation_todos
after update of status on public.payroll_payslips
for each row
execute function public.expire_payroll_confirmation_todos();

revoke all on function public.confirm_my_payroll_payslip(uuid) from public, anon;
grant execute on function public.confirm_my_payroll_payslip(uuid) to authenticated;
revoke all on function public.expire_payroll_confirmation_todos() from public, anon, authenticated;

comment on function public.confirm_my_payroll_payslip(uuid) is
  'Confirms the current employee payslip, completes the employee notification, and creates one unread confirmation todo for each authorized administrator.';
comment on function public.expire_payroll_confirmation_todos() is
  'Marks prior administrator confirmation todos read when a confirmed payslip is revised or withdrawn.';
