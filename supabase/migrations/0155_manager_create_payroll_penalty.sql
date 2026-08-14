-- Store managers can issue penalties only to active staff in their own
-- stores. Each manager-issued penalty notifies the employee and the admins.

create or replace function public.manager_create_payroll_penalty(p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles;
  v_penalty public.payroll_penalties;
  v_level text;
  v_default numeric;
begin
  if public.current_user_role() <> 'manager' then
    raise exception 'store manager permission required' using errcode = '42501';
  end if;

  select * into v_target
  from public.profiles
  where id = (p_fields ->> 'profileId')::uuid;

  if v_target.id is null
    or v_target.role <> 'staff'
    or not v_target.is_active
    or v_target.deleted_at is not null
    or not public.has_store_access(v_target.store_id)
  then
    raise exception '只能给本店在职员工开罚单' using errcode = '42501';
  end if;

  v_level := coalesce(p_fields ->> 'eventLevel', 'warning');
  v_default := case v_level
    when 'reminder' then 0
    when 'warning' then 3
    when 'formal_warning' then 5
    when 'serious' then 10
    else null
  end;
  if v_default is null then
    raise exception 'invalid penalty event level' using errcode = '22023';
  end if;

  insert into public.payroll_penalties(
    profile_id, event_date, reason, amount, event_level,
    performance_deduction, created_by
  ) values (
    v_target.id,
    (p_fields ->> 'eventDate')::date,
    trim(p_fields ->> 'reason'),
    coalesce((p_fields ->> 'amount')::numeric, 0),
    v_level,
    coalesce(nullif(p_fields ->> 'performanceDeduction', '')::numeric, v_default),
    auth.uid()
  ) returning * into v_penalty;

  insert into public.notifications(
    recipient_user_id, store_id, type, title, body,
    entity_type, entity_id, dedupe_key
  ) values (
    v_target.id, v_target.store_id, 'payroll_penalty_created', '新的处罚记录',
    v_penalty.event_date || ' · ' || v_penalty.reason
      || case when v_penalty.amount > 0 then ' · 罚款 ' || v_penalty.amount || ' 元' else '' end,
    'payroll_penalty', v_penalty.id, 'payroll-penalty:' || v_penalty.id
  ) on conflict (dedupe_key) do nothing;

  insert into public.notifications(
    recipient_role, store_id, type, title, body,
    entity_type, entity_id, dedupe_key
  ) values (
    'admin', v_target.store_id, 'manager_penalty_created', '店长已给员工开罚单',
    coalesce(v_target.display_name, '员工') || ' · ' || v_penalty.event_date || ' · ' || v_penalty.reason,
    'payroll_penalty', v_penalty.id, 'manager-penalty-admin:' || v_penalty.id
  ) on conflict (dedupe_key) do nothing;

  return to_jsonb(v_penalty);
end;
$$;

revoke all on function public.manager_create_payroll_penalty(jsonb)
from public, anon, authenticated;
grant execute on function public.manager_create_payroll_penalty(jsonb)
to authenticated;
