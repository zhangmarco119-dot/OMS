-- Overtime revisions, optional descriptions, five-day submission window,
-- and role-based approval: staff -> manager, manager -> administrator.

alter table public.payroll_overtime_requests
  drop constraint if exists payroll_overtime_requests_reason_check;
alter table public.payroll_overtime_requests
  alter column reason set default '';

create or replace function public.notify_payroll_overtime_reviewers(
  p_request public.payroll_overtime_requests,
  p_requester_role text,
  p_event text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications(
    recipient_user_id, store_id, type, title, body,
    entity_type, entity_id, dedupe_key
  )
  select
    reviewer.id,
    p_request.store_id,
    case when p_event = 'updated' then 'payroll_overtime_updated' else 'payroll_overtime_submitted' end,
    case
      when p_requester_role = 'manager' and p_event = 'updated' then '店长修改了加班申请'
      when p_requester_role = 'manager' then '店长加班申请待审批'
      when p_event = 'updated' then '员工修改了加班申请'
      else '加班申请待审批'
    end,
    requester.display_name || '申报 ' || p_request.overtime_date || ' 加班 ' || p_request.hours || ' 小时',
    'payroll_overtime',
    p_request.id,
    'overtime-' || p_event || ':' || p_request.id || ':' || reviewer.id || ':'
      || (extract(epoch from p_request.updated_at) * 1000000)::bigint
  from public.profiles reviewer
  cross join public.profiles requester
  where requester.id = p_request.profile_id
    and reviewer.id <> p_request.profile_id
    and reviewer.is_active
    and reviewer.deleted_at is null
    and (
      (
        p_requester_role = 'staff'
        and reviewer.role = 'manager'
        and (
          reviewer.store_id = p_request.store_id
          or exists (
            select 1
            from public.profile_store_access access
            where access.profile_id = reviewer.id
              and access.store_id = p_request.store_id
          )
        )
      )
      or (p_requester_role = 'manager' and reviewer.role = 'admin')
    )
  on conflict (dedupe_key) do nothing;
end;
$$;

create or replace function public.submit_payroll_overtime_request(
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
  v_request public.payroll_overtime_requests;
  v_requester_role text := public.current_user_role();
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if v_requester_role not in ('staff', 'manager') then
    raise exception '仅员工和店长可以提交加班申请';
  end if;
  if not public.has_store_access(p_store_id) then
    raise exception '没有该门店的操作权限';
  end if;
  if p_overtime_date > v_today or p_overtime_date < v_today - 5 then
    raise exception '加班日期只能选择今天或过去 5 日内';
  end if;
  if p_hours < 0.5 or p_hours > 16 or mod(p_hours, 0.5) <> 0 then
    raise exception '加班小时必须按 0.5 小时递增，且在 0.5 至 16 小时之间';
  end if;

  insert into public.payroll_overtime_requests(
    profile_id, store_id, overtime_date, hours, reason
  ) values (
    auth.uid(), p_store_id, p_overtime_date, p_hours, trim(coalesce(p_reason, ''))
  )
  returning * into v_request;

  perform public.notify_payroll_overtime_reviewers(v_request, v_requester_role, 'submitted');
  return to_jsonb(v_request);
exception
  when unique_violation then
    raise exception '该员工在所选门店和日期已有加班申请，可在加班记录中修改';
end;
$$;

create or replace function public.update_payroll_overtime_request(
  p_request_id uuid,
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
  v_request public.payroll_overtime_requests;
  v_requester_role text := public.current_user_role();
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  select *
  into v_request
  from public.payroll_overtime_requests
  where id = p_request_id
    and profile_id = auth.uid()
  for update;

  if v_request.id is null then
    raise exception '未找到加班申请';
  end if;
  if v_requester_role not in ('staff', 'manager') then
    raise exception '仅员工和店长可以修改加班申请';
  end if;
  if (v_request.created_at at time zone 'Asia/Shanghai')::date < v_today - 5 then
    raise exception '只能修改今天或过去 5 日内提交的加班申请';
  end if;
  if not public.has_store_access(p_store_id) then
    raise exception '没有该门店的操作权限';
  end if;
  if p_overtime_date > v_today or p_overtime_date < v_today - 5 then
    raise exception '加班日期只能选择今天或过去 5 日内';
  end if;
  if p_hours < 0.5 or p_hours > 16 or mod(p_hours, 0.5) <> 0 then
    raise exception '加班小时必须按 0.5 小时递增，且在 0.5 至 16 小时之间';
  end if;

  update public.payroll_overtime_requests
  set store_id = p_store_id,
      overtime_date = p_overtime_date,
      hours = p_hours,
      reason = trim(coalesce(p_reason, '')),
      status = 'pending',
      approved_hourly_rate = null,
      reviewed_by = null,
      reviewed_at = null,
      review_note = null,
      updated_at = now()
  where id = p_request_id
  returning * into v_request;

  perform public.notify_payroll_overtime_reviewers(v_request, v_requester_role, 'updated');
  return to_jsonb(v_request);
exception
  when unique_violation then
    raise exception '该员工在所选门店和日期已有另一条加班申请';
end;
$$;

create or replace function public.review_payroll_overtime_request(
  p_request_id uuid,
  p_action text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.payroll_overtime_requests;
  v_requester_role text;
  v_reviewer_role text := public.current_user_role();
  v_rate numeric;
begin
  select request.*
  into v_request
  from public.payroll_overtime_requests request
  where request.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception '未找到加班申请';
  end if;

  select role
  into v_requester_role
  from public.profiles
  where id = v_request.profile_id;

  if v_request.profile_id = auth.uid() then
    raise exception '不能审批自己的加班申请';
  end if;
  if v_requester_role = 'staff' then
    if v_reviewer_role <> 'manager' or not public.has_store_access(v_request.store_id) then
      raise exception '员工加班申请需要由对应门店的店长审批';
    end if;
  elsif v_requester_role = 'manager' then
    if v_reviewer_role <> 'admin'
      or not public.can_admin_manage_attendance_profile(v_request.profile_id) then
      raise exception '店长加班申请需要由管理员审批';
    end if;
  else
    raise exception '不支持该账号角色提交加班申请';
  end if;
  if v_request.status <> 'pending' then
    raise exception '只能审批待审批的加班申请';
  end if;
  if p_action not in ('approved', 'rejected') then
    raise exception '无效的审批操作';
  end if;
  if p_action = 'rejected' and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception '驳回时必须填写原因';
  end if;

  if p_action = 'approved' then
    select hourly_rate
    into v_rate
    from public.payroll_overtime_rates
    where effective_from <= v_request.overtime_date
      and (effective_to is null or effective_to >= v_request.overtime_date)
    order by effective_from desc
    limit 1;

    if v_rate is null then
      raise exception '尚未配置适用于该日期的加班时薪';
    end if;
  end if;

  update public.payroll_overtime_requests
  set status = p_action,
      approved_hourly_rate = case when p_action = 'approved' then v_rate else null end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_request_id
  returning * into v_request;

  insert into public.notifications(
    recipient_user_id, store_id, type, title, body,
    entity_type, entity_id, dedupe_key
  ) values (
    v_request.profile_id,
    v_request.store_id,
    'payroll_overtime_' || p_action,
    case when p_action = 'approved' then '加班申请已通过' else '加班申请已驳回' end,
    v_request.overtime_date || ' · ' || v_request.hours || ' 小时'
      || case when p_action = 'rejected' then ' · ' || coalesce(v_request.review_note, '') else '' end,
    'payroll_overtime',
    v_request.id,
    'overtime-reviewed:' || v_request.id || ':' || p_action || ':'
      || (extract(epoch from v_request.updated_at) * 1000000)::bigint
  )
  on conflict (dedupe_key) do nothing;

  return to_jsonb(v_request);
end;
$$;

create or replace function public.payroll_overtime_todo_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.payroll_overtime_requests request
  join public.profiles requester on requester.id = request.profile_id
  where request.status = 'pending'
    and request.profile_id <> auth.uid()
    and (
      (
        public.current_user_role() = 'manager'
        and requester.role = 'staff'
        and public.has_store_access(request.store_id)
      )
      or (
        public.current_user_role() = 'admin'
        and requester.role = 'manager'
        and public.can_admin_manage_attendance_profile(request.profile_id)
      )
    );
$$;

revoke all on function public.notify_payroll_overtime_reviewers(public.payroll_overtime_requests, text, text),
  public.update_payroll_overtime_request(uuid, uuid, date, numeric, text),
  public.payroll_overtime_todo_count() from public;

grant execute on function public.update_payroll_overtime_request(uuid, uuid, date, numeric, text),
  public.payroll_overtime_todo_count() to authenticated;
