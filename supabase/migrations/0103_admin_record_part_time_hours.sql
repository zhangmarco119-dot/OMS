-- Allow administrators to directly record approved working hours for both
-- full-time employees and part-time employees. Part-time records continue to
-- use payroll_overtime_requests as the shared time ledger, while all visible
-- wording and payroll calculation follow the employee's employment type.

create or replace function public.admin_record_payroll_overtime(
  p_profile_id uuid,
  p_store_id uuid,
  p_overtime_date date,
  p_hours numeric,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_request public.payroll_overtime_requests%rowtype;
  v_rate numeric;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_reason text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), '管理员手动登记');
  v_term text;
begin
  if public.current_user_role() <> 'admin' then
    raise exception '仅管理员可以手动登记员工工时';
  end if;
  if not public.has_store_access(p_store_id) then
    raise exception '没有该门店的管理权限';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_profile_id and is_active and deleted_at is null;
  if v_profile.id is null then raise exception '未找到有效员工账号'; end if;
  if v_profile.role not in ('staff', 'manager')
    or v_profile.employment_type not in ('full_time', 'part_time') then
    raise exception '只能为员工、店长或兼职员工登记工时';
  end if;
  if not (
    v_profile.store_id = p_store_id
    or exists (
      select 1 from public.profile_store_access access
      where access.profile_id = p_profile_id and access.store_id = p_store_id
    )
  ) then
    raise exception '该员工未关联所选门店';
  end if;
  if p_overtime_date is null or p_overtime_date > v_today then
    raise exception '登记日期不能晚于今天';
  end if;
  if p_hours is null or p_hours <= 0 or p_hours > 6 or mod(p_hours, 0.5) <> 0 then
    raise exception '工时必须按 0.5 小时递增，且在 0.5 至 6 小时之间';
  end if;

  select hourly_rate into v_rate
  from public.payroll_overtime_rates
  where effective_from <= p_overtime_date
    and (effective_to is null or effective_to >= p_overtime_date)
  order by effective_from desc
  limit 1;
  if v_rate is null then raise exception '尚未配置适用于该日期的计薪时薪'; end if;

  v_term := case when v_profile.employment_type = 'part_time' then '兼职工时' else '加班工时' end;

  insert into public.payroll_overtime_requests(
    profile_id, store_id, overtime_date, hours, reason, status,
    approved_hourly_rate, reviewed_by, reviewed_at, review_note
  ) values (
    p_profile_id, p_store_id, p_overtime_date, p_hours, v_reason, 'approved',
    v_rate, auth.uid(), now(), '管理员手动登记'
  )
  on conflict (profile_id, store_id, overtime_date) do update set
    hours = excluded.hours,
    reason = excluded.reason,
    status = 'approved',
    approved_hourly_rate = excluded.approved_hourly_rate,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    review_note = '管理员手动登记或更新',
    updated_at = now()
  returning * into v_request;

  insert into public.notifications(
    recipient_user_id, store_id, type, title, body,
    entity_type, entity_id, dedupe_key
  ) values (
    v_request.profile_id,
    v_request.store_id,
    'payroll_overtime_admin_recorded',
    '管理员已登记' || v_term,
    v_request.overtime_date || ' · ' || v_request.hours || ' 小时 · ' || v_reason,
    'payroll_overtime',
    v_request.id,
    'overtime-admin-recorded:' || v_request.id || ':' || (extract(epoch from v_request.updated_at) * 1000000)::bigint
  )
  on conflict (dedupe_key) do nothing;

  return to_jsonb(v_request);
end;
$$;

revoke all on function public.admin_record_payroll_overtime(uuid, uuid, date, numeric, text)
from public, anon, authenticated;
grant execute on function public.admin_record_payroll_overtime(uuid, uuid, date, numeric, text)
to authenticated;
