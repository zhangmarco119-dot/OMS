-- Keep the existing time ledger and review permissions while using employment-specific wording.
create or replace function public.payroll_work_term(p_profile_id uuid)
returns text language sql security definer set search_path = public stable as $$
  select case when employment_type = 'part_time' then '兼职工时' else '自主延时工作登记' end
  from public.profiles where id = p_profile_id
$$;

create or replace function public.notify_payroll_overtime_reviewers(
  p_request public.payroll_overtime_requests,
  p_requester_role text,
  p_event text
)
returns void language plpgsql security definer set search_path = public as $$
declare v_term text := public.payroll_work_term(p_request.profile_id);
begin
  insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
  select reviewer.id,p_request.store_id,
    case when p_event='updated' then 'payroll_overtime_updated' else 'payroll_overtime_submitted' end,
    case
      when p_requester_role='manager' and p_event='updated' then '店长修改了'||v_term
      when p_requester_role='manager' then '店长'||v_term||'待审批'
      when p_event='updated' then requester.display_name||'修改了'||v_term
      else requester.display_name||'的'||v_term||'待审批'
    end,
    requester.display_name||'登记 '||p_request.overtime_date||' '||v_term||' '||p_request.hours||' 小时',
    'payroll_overtime',p_request.id,
    'overtime-'||p_event||':'||p_request.id||':'||reviewer.id||':'||(extract(epoch from p_request.updated_at)*1000000)::bigint
  from public.profiles reviewer cross join public.profiles requester
  where requester.id=p_request.profile_id and reviewer.id<>p_request.profile_id
    and reviewer.is_active and reviewer.deleted_at is null
    and ((p_requester_role='staff' and reviewer.role='manager' and (reviewer.store_id=p_request.store_id or exists(select 1 from public.profile_store_access access where access.profile_id=reviewer.id and access.store_id=p_request.store_id)))
      or (p_requester_role='manager' and reviewer.role='admin'))
  on conflict(dedupe_key) do nothing;
end;
$$;

create or replace function public.review_payroll_overtime_request(p_request_id uuid,p_action text,p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_request public.payroll_overtime_requests; v_requester_role text; v_reviewer_role text:=public.current_user_role(); v_rate numeric; v_term text; v_employment_type text;
begin
  select request.* into v_request from public.payroll_overtime_requests request where request.id=p_request_id for update;
  if v_request.id is null then raise exception '未找到工时申请'; end if;
  select role, employment_type into v_requester_role, v_employment_type from public.profiles where id=v_request.profile_id;
  v_term:=public.payroll_work_term(v_request.profile_id);
  if v_request.profile_id=auth.uid() then raise exception '不能审批自己的%记录',v_term; end if;
  if v_requester_role='staff' then
    if v_reviewer_role<>'manager' or not public.has_store_access(v_request.store_id) then raise exception '员工工时申请需要由对应门店的店长审批'; end if;
  elsif v_requester_role='manager' then
    if v_reviewer_role<>'admin' or not public.can_admin_manage_attendance_profile(v_request.profile_id) then raise exception '店长自主延时工作登记需要由管理员审批'; end if;
  else raise exception '不支持该账号提交工时申请'; end if;
  if v_request.status<>'pending' then raise exception '只能审批待审批的工时申请'; end if;
  if p_action not in ('approved','rejected') then raise exception '无效的审批操作'; end if;
  if p_action='rejected' and nullif(trim(coalesce(p_note,'')),'') is null then raise exception '驳回时必须填写原因'; end if;
  if p_action='approved' then
    if v_employment_type='part_time' then
      select hourly_rate into v_rate from public.payroll_overtime_rates where effective_from<=v_request.overtime_date and (effective_to is null or effective_to>=v_request.overtime_date) order by effective_from desc limit 1;
      if v_rate is null then raise exception '尚未配置适用于该日期的兼职计薪时薪'; end if;
    else
      v_rate := 25;
    end if;
  end if;
  update public.payroll_overtime_requests set status=p_action,approved_hourly_rate=case when p_action='approved' then v_rate else null end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(trim(coalesce(p_note,'')),'')
  where id=p_request_id returning * into v_request;
  insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
  values(v_request.profile_id,v_request.store_id,'payroll_overtime_'||p_action,
    v_term||case when p_action='approved' then '已通过' else '已驳回' end,
    v_request.overtime_date||' · '||v_request.hours||' 小时'||case when p_action='rejected' then ' · '||coalesce(v_request.review_note,'') else '' end,
    'payroll_overtime',v_request.id,'overtime-reviewed:'||v_request.id||':'||p_action||':'||(extract(epoch from v_request.updated_at)*1000000)::bigint)
  on conflict(dedupe_key) do nothing;
  return to_jsonb(v_request);
end;
$$;

create or replace function public.admin_record_payroll_overtime(
  p_profile_id uuid,
  p_store_id uuid,
  p_overtime_date date,
  p_hours numeric,
  p_reason text default ''
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles%rowtype;
  v_request public.payroll_overtime_requests%rowtype;
  v_rate numeric;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_reason text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), '管理员手动登记');
  v_term text;
begin
  if public.current_user_role() <> 'admin' then raise exception '仅管理员可以手动登记员工工时'; end if;
  if not public.has_store_access(p_store_id) then raise exception '没有该门店的管理权限'; end if;

  select * into v_profile from public.profiles
  where id = p_profile_id and is_active and deleted_at is null;
  if v_profile.id is null then raise exception '未找到有效员工账号'; end if;
  if v_profile.role not in ('staff', 'manager')
    or v_profile.employment_type not in ('full_time', 'part_time') then
    raise exception '只能为员工、店长或兼职员工登记工时';
  end if;
  if not (v_profile.store_id = p_store_id or exists (
    select 1 from public.profile_store_access access
    where access.profile_id = p_profile_id and access.store_id = p_store_id
  )) then raise exception '该员工未关联所选门店'; end if;
  if p_overtime_date is null or p_overtime_date > v_today then raise exception '登记日期不能晚于今天'; end if;
  if p_hours is null or p_hours <= 0 or p_hours > 6 or mod(p_hours, 0.5) <> 0 then
    raise exception '工时必须按 0.5 小时递增，且在 0.5 至 6 小时之间';
  end if;

  if v_profile.employment_type = 'part_time' then
    select hourly_rate into v_rate from public.payroll_overtime_rates
    where effective_from <= p_overtime_date and (effective_to is null or effective_to >= p_overtime_date)
    order by effective_from desc limit 1;
    if v_rate is null then raise exception '尚未配置适用于该日期的兼职计薪时薪'; end if;
  else
    v_rate := 25;
  end if;
  v_term := public.payroll_work_term(v_profile.id);

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
    recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key
  ) values (
    v_request.profile_id, v_request.store_id, 'payroll_overtime_admin_recorded',
    '管理员已记录' || v_term,
    v_request.overtime_date || ' · ' || v_request.hours || ' 小时 · ' || v_reason,
    'payroll_overtime', v_request.id,
    'overtime-admin-recorded:' || v_request.id || ':' || (extract(epoch from v_request.updated_at) * 1000000)::bigint
  ) on conflict (dedupe_key) do nothing;

  return to_jsonb(v_request);
end;
$$;

-- Historical system-generated notifications can still appear in a user's notification center.
update public.notifications
set title = replace(title, '加班', '自主延时工作登记'),
    body = replace(body, '加班', '自主延时工作登记')
where type like 'payroll_overtime_%' and (title like '%加班%' or body like '%加班%');

-- Align this month's already approved full-time records with the 25 yuan subsidy.
update public.payroll_overtime_requests request
set approved_hourly_rate = 25
from public.profiles profile
where profile.id = request.profile_id
  and profile.employment_type = 'full_time'
  and request.status = 'approved'
  and request.overtime_date >= date_trunc('month', now() at time zone 'Asia/Shanghai')::date
  and request.approved_hourly_rate is distinct from 25;

update public.payroll_overtime_rates
set change_reason = replace(change_reason, '加班', '工时')
where created_by is null and change_reason like '%加班%';

update public.v2_system_documents
set content_html = replace(
      replace(
        replace(
          replace(
            replace(content_html, '加班工资', '延时工作补贴'),
            '加班工时', '自主延时工作登记时长'
          ),
          '加班', '自主延时工作登记'
        ),
        '填报自主延时工作登记', '自主延时工作登记'
      ),
      '自主延时工作登记时薪可配置', '全职延时工作补贴按 25 元/小时计入；兼职工时计薪时薪可配置'
    ),
    document_version = '3.0.33'
where slug in ('staff-manager-guide', 'admin-guide') and content_html like '%加班%';

revoke all on function public.payroll_work_term(uuid),
  public.notify_payroll_overtime_reviewers(public.payroll_overtime_requests,text,text),
  public.review_payroll_overtime_request(uuid,text,text),
  public.admin_record_payroll_overtime(uuid,uuid,date,numeric,text)
from public, anon, authenticated;
grant execute on function public.review_payroll_overtime_request(uuid,text,text),
  public.admin_record_payroll_overtime(uuid,uuid,date,numeric,text) to authenticated;
