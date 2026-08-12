-- Allow an administrator to send one prepared payslip to an eligible store manager
-- for offline employee verification and delegated confirmation.

alter table public.payroll_payslips
  add column if not exists confirmation_target text not null default 'employee',
  add column if not exists confirmation_assignee_id uuid references public.profiles(id) on delete set null,
  add column if not exists delegated_at timestamptz,
  add column if not exists delegated_by uuid references public.profiles(id) on delete set null,
  add column if not exists confirmed_by uuid references public.profiles(id) on delete set null;

alter table public.payroll_payslips
  drop constraint if exists payroll_payslips_confirmation_target_check;
alter table public.payroll_payslips
  add constraint payroll_payslips_confirmation_target_check
  check (confirmation_target in ('employee', 'manager'));

create index if not exists payroll_payslips_manager_confirmation_idx
  on public.payroll_payslips(confirmation_assignee_id, issued_at desc)
  where confirmation_target = 'manager' and status = 'issued';

drop policy if exists payroll_payslips_select on public.payroll_payslips;
create policy payroll_payslips_select on public.payroll_payslips
for select to authenticated using (
  (profile_id = auth.uid() and confirmation_target = 'employee' and status in ('issued', 'confirmed'))
  or (
    confirmation_target = 'manager'
    and confirmation_assignee_id = auth.uid()
    and public.current_user_role() = 'manager'
    and status in ('issued', 'confirmed')
  )
  or (public.current_user_role() = 'admin' and public.can_admin_manage_attendance_profile(profile_id))
);

create or replace function public.normalize_payroll_confirmation_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'draft' then
    new.confirmation_target := 'employee';
    new.confirmation_assignee_id := null;
    new.delegated_at := null;
    new.delegated_by := null;
    new.confirmed_by := null;
  elsif new.status <> 'confirmed' then
    new.confirmed_by := null;
  end if;

  if new.confirmation_target = 'employee' then
    new.confirmation_assignee_id := null;
    new.delegated_at := null;
    new.delegated_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists payroll_payslips_normalize_confirmation_assignment on public.payroll_payslips;
create trigger payroll_payslips_normalize_confirmation_assignment
before insert or update on public.payroll_payslips
for each row execute function public.normalize_payroll_confirmation_assignment();

create or replace function public.reconcile_payroll_confirmation_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_name text;
begin
  select coalesce(nullif(btrim(display_name), ''), '员工')
  into v_employee_name
  from public.profiles
  where id = new.profile_id;

  if new.status = 'issued' and new.confirmation_target = 'manager' and new.confirmation_assignee_id is not null then
    delete from public.notifications
    where entity_type = 'payroll_payslip'
      and entity_id = new.id
      and recipient_user_id = new.profile_id;

    delete from public.notifications
    where type = 'payroll_payslip_manager_confirmation'
      and entity_type = 'payroll_payslip'
      and entity_id = new.id
      and recipient_user_id <> new.confirmation_assignee_id;

    insert into public.notifications(
      recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key
    ) values (
      new.confirmation_assignee_id,
      new.store_id,
      'payroll_payslip_manager_confirmation',
      v_employee_name || '的工资单待确认',
      '请先在线下与该员工核对工资明细，确认无误后再在系统中点击确认薪资。',
      'payroll_payslip',
      new.id,
      'payroll-payslip-manager:' || new.id::text || ':' || new.revision::text || ':' || new.confirmation_assignee_id::text
    ) on conflict(dedupe_key) do update set
      title = excluded.title,
      body = excluded.body,
      is_read = false,
      read_at = null,
      created_at = now();
  elsif new.status = 'issued' and new.confirmation_target = 'employee' then
    delete from public.notifications
    where type = 'payroll_payslip_manager_confirmation'
      and entity_type = 'payroll_payslip'
      and entity_id = new.id;
  else
    update public.notifications
    set is_read = true, read_at = coalesce(read_at, now())
    where type = 'payroll_payslip_manager_confirmation'
      and entity_type = 'payroll_payslip'
      and entity_id = new.id
      and not is_read;
  end if;
  return new;
end;
$$;

drop trigger if exists payroll_payslips_reconcile_confirmation_notification on public.payroll_payslips;
create constraint trigger payroll_payslips_reconcile_confirmation_notification
after insert or update of status, confirmation_target, confirmation_assignee_id, revision
on public.payroll_payslips
deferrable initially deferred
for each row execute function public.reconcile_payroll_confirmation_notification();

create or replace function public.create_admin_payroll_confirmation_todos(
  p_payslip_id uuid,
  p_confirmer_name text,
  p_delegated boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payroll_payslips;
  v_employee_name text;
begin
  select * into v_row from public.payroll_payslips where id = p_payslip_id;
  select coalesce(nullif(btrim(display_name), ''), '员工') into v_employee_name
  from public.profiles where id = v_row.profile_id;

  insert into public.notifications(
    recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key
  )
  select
    admin_profile.id,
    v_row.store_id,
    'payroll_payslip_confirmed',
    case when p_delegated then v_employee_name || '的工资单已由店长确认' else v_employee_name || '已确认工资单' end,
    case when p_delegated
      then coalesce(nullif(btrim(p_confirmer_name), ''), '店长') || '已在线下核对后，于' || to_char(v_row.confirmed_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') || '代为确认。'
      else to_char(v_row.payroll_month, 'YYYY年FM月') || '工资单已于' || to_char(v_row.confirmed_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') || '由员工本人确认，请阅读确认结果。'
    end,
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
        select 1 from public.profile_store_access access
        where access.profile_id = admin_profile.id and access.store_id = v_row.store_id
      )
    )
  on conflict(dedupe_key) do nothing;
end;
$$;

create or replace function public.list_available_payroll_confirmation_managers(p_payslip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payroll_payslips;
begin
  select * into v_row from public.payroll_payslips where id = p_payslip_id;
  if v_row.id is null or public.current_user_role() <> 'admin'
    or not public.can_admin_manage_attendance_profile(v_row.profile_id) then
    raise exception '没有该工资单的操作权限';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', manager.id,
      'displayName', manager.display_name,
      'username', manager.username,
      'storeName', store.name
    ) order by manager.display_name)
    from public.profiles manager
    left join public.stores store on store.id = manager.store_id
    where manager.role = 'manager'
      and manager.is_active
      and manager.deleted_at is null
      and (
        v_row.store_id is null
        or manager.store_id = v_row.store_id
        or exists (
          select 1 from public.profile_store_access access
          where access.profile_id = manager.id and access.store_id = v_row.store_id
        )
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_send_payroll_payslip_to_manager(
  p_payslip_id uuid,
  p_manager_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payroll_payslips;
  v_manager public.profiles;
begin
  select * into v_row from public.payroll_payslips where id = p_payslip_id for update;
  if v_row.id is null or public.current_user_role() <> 'admin'
    or not public.can_admin_manage_attendance_profile(v_row.profile_id) then
    raise exception '没有该工资单的操作权限';
  end if;
  if v_row.status <> 'draft' then raise exception '只有待发送工资单可以交给店长确认'; end if;

  select * into v_manager from public.profiles
  where id = p_manager_id and role = 'manager' and is_active and deleted_at is null;
  if v_manager.id is null or not (
    v_row.store_id is null
    or v_manager.store_id = v_row.store_id
    or exists (
      select 1 from public.profile_store_access access
      where access.profile_id = v_manager.id and access.store_id = v_row.store_id
    )
  ) then
    raise exception '所选店长不能确认该门店的工资单';
  end if;

  update public.payroll_payslips set
    status = 'issued',
    issued_at = now(),
    issued_by = auth.uid(),
    withdrawn_at = null,
    withdrawn_by = null,
    confirmation_target = 'manager',
    confirmation_assignee_id = p_manager_id,
    delegated_at = now(),
    delegated_by = auth.uid(),
    confirmed_by = null
  where id = v_row.id returning * into v_row;

  return to_jsonb(v_row) || jsonb_build_object('managerDisplayName', v_manager.display_name);
end;
$$;

create or replace function public.confirm_delegated_payroll_payslip(p_payslip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payroll_payslips;
  v_manager_name text;
begin
  update public.payroll_payslips set
    status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid()
  where id = p_payslip_id
    and confirmation_target = 'manager'
    and confirmation_assignee_id = auth.uid()
    and public.current_user_role() = 'manager'
    and status = 'issued'
  returning * into v_row;

  if v_row.id is null then
    raise exception '工资单不存在、已经确认或未指派给当前店长';
  end if;

  select display_name into v_manager_name from public.profiles where id = auth.uid();
  update public.notifications set is_read = true, read_at = coalesce(read_at, now())
  where recipient_user_id = auth.uid() and entity_type = 'payroll_payslip' and entity_id = v_row.id;
  perform public.create_admin_payroll_confirmation_todos(v_row.id, v_manager_name, true);
  return to_jsonb(v_row);
end;
$$;

create or replace function public.confirm_my_payroll_payslip(p_payslip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payroll_payslips;
begin
  update public.payroll_payslips set
    status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid()
  where id = p_payslip_id
    and profile_id = auth.uid()
    and confirmation_target = 'employee'
    and status = 'issued'
  returning * into v_row;

  if v_row.id is null then
    raise exception '工资单不存在、已经确认或不属于当前账号';
  end if;

  update public.notifications set is_read = true, read_at = coalesce(read_at, now())
  where recipient_user_id = auth.uid() and entity_type = 'payroll_payslip' and entity_id = v_row.id;
  perform public.create_admin_payroll_confirmation_todos(v_row.id, null, false);
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.normalize_payroll_confirmation_assignment() from public, anon, authenticated;
revoke all on function public.reconcile_payroll_confirmation_notification() from public, anon, authenticated;
revoke all on function public.create_admin_payroll_confirmation_todos(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.list_available_payroll_confirmation_managers(uuid) from public, anon;
revoke all on function public.admin_send_payroll_payslip_to_manager(uuid, uuid) from public, anon;
revoke all on function public.confirm_delegated_payroll_payslip(uuid) from public, anon;
revoke all on function public.confirm_my_payroll_payslip(uuid) from public, anon;
grant execute on function public.list_available_payroll_confirmation_managers(uuid) to authenticated;
grant execute on function public.admin_send_payroll_payslip_to_manager(uuid, uuid) to authenticated;
grant execute on function public.confirm_delegated_payroll_payslip(uuid) to authenticated;
grant execute on function public.confirm_my_payroll_payslip(uuid) to authenticated;

comment on function public.admin_send_payroll_payslip_to_manager(uuid, uuid) is
  'Issues one prepared payslip to an eligible store manager for offline employee verification.';
comment on function public.confirm_delegated_payroll_payslip(uuid) is
  'Lets only the assigned manager confirm a delegated payslip and notifies authorized administrators.';
