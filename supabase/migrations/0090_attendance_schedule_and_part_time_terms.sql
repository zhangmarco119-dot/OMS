-- Administrator-controlled current-month attendance sync schedule and
-- user-facing part-time work terminology.

alter table private.attendance_automation_config
  add column if not exists sync_interval_minutes smallint not null default 60,
  add column if not exists sync_start_time time not null default '00:05',
  add column if not exists sync_end_time time not null default '23:55',
  add column if not exists last_dispatched_at timestamptz;

alter table private.attendance_automation_config
  drop constraint if exists attendance_automation_interval_check,
  add constraint attendance_automation_interval_check
    check (sync_interval_minutes in (30, 60, 120, 180, 360, 720)),
  drop constraint if exists attendance_automation_time_window_check,
  add constraint attendance_automation_time_window_check
    check (sync_start_time <= sync_end_time);

create or replace function private.dispatch_attendance_automation(p_mode text)
returns bigint language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_config private.attendance_automation_config%rowtype;
  v_request_id bigint;
  v_local_now timestamp := clock_timestamp() at time zone 'Asia/Shanghai';
  v_anchor timestamp;
  v_elapsed_minutes integer;
begin
  select * into v_config
  from private.attendance_automation_config
  where singleton
  for update;
  if not found then return null; end if;

  if p_mode <> 'history-queue' then
    if not v_config.enabled then return null; end if;
    if v_local_now::time < v_config.sync_start_time or v_local_now::time > v_config.sync_end_time then return null; end if;
    v_anchor := date_trunc('day', v_local_now) + v_config.sync_start_time;
    v_elapsed_minutes := floor(extract(epoch from (v_local_now - v_anchor)) / 60)::integer;
    if v_elapsed_minutes < 0 or mod(v_elapsed_minutes, v_config.sync_interval_minutes) >= 5 then return null; end if;
    if v_config.last_dispatched_at is not null
      and v_config.last_dispatched_at > clock_timestamp() - make_interval(mins => v_config.sync_interval_minutes - 2)
    then return null; end if;
    update private.attendance_automation_config set last_dispatched_at = clock_timestamp() where singleton;
  end if;

  select net.http_post(
    url := v_config.function_url,
    headers := jsonb_build_object('Content-Type','application/json','x-storehub-cron-secret',v_config.cron_token),
    body := jsonb_build_object('action','scheduled-sync','mode',p_mode),
    timeout_milliseconds := 25000
  ) into v_request_id;
  return v_request_id;
end;
$$;

create function public.get_attendance_automation_settings()
returns jsonb language plpgsql security definer set search_path = public, private stable as $$
declare v_config private.attendance_automation_config%rowtype;
begin
  if public.current_user_role() <> 'admin' then raise exception '需要管理员权限'; end if;
  select * into v_config from private.attendance_automation_config where singleton;
  return jsonb_build_object(
    'configured', v_config.singleton is not null,
    'enabled', coalesce(v_config.enabled, false),
    'intervalMinutes', coalesce(v_config.sync_interval_minutes, 60),
    'startTime', coalesce(to_char(v_config.sync_start_time, 'HH24:MI'), '00:05'),
    'endTime', coalesce(to_char(v_config.sync_end_time, 'HH24:MI'), '23:55'),
    'lastDispatchedAt', v_config.last_dispatched_at,
    'configuredAt', v_config.configured_at
  );
end;
$$;

create function public.admin_save_attendance_automation_settings(
  p_enabled boolean,
  p_interval_minutes smallint,
  p_start_time time,
  p_end_time time
)
returns jsonb language plpgsql security definer set search_path = public, private, cron as $$
declare v_issuer text; v_url text; v_token text;
begin
  if public.current_user_role() <> 'admin' then raise exception '需要管理员权限'; end if;
  if p_interval_minutes not in (30, 60, 120, 180, 360, 720) then raise exception '请选择有效的考勤同步周期'; end if;
  if p_start_time is null or p_end_time is null or p_start_time > p_end_time then raise exception '请选择正确的考勤同步时段'; end if;
  v_issuer := coalesce(auth.jwt()->>'iss','');
  if v_issuer !~ '^https://[a-z0-9-]+\.supabase\.co/auth/v1/?$' then raise exception '无法确认当前 Supabase 项目地址'; end if;
  v_url := regexp_replace(v_issuer, '/auth/v1/?$', '/functions/v1/dingtalk-attendance');
  select cron_token into v_token from private.attendance_automation_config where singleton;
  v_token := coalesce(v_token, gen_random_uuid()::text || gen_random_uuid()::text);
  insert into private.attendance_automation_config(
    singleton, function_url, cron_token, enabled, sync_interval_minutes,
    sync_start_time, sync_end_time, configured_by, configured_at
  ) values (
    true, v_url, v_token, p_enabled, p_interval_minutes,
    p_start_time, p_end_time, auth.uid(), now()
  ) on conflict(singleton) do update set
    function_url=excluded.function_url, enabled=excluded.enabled,
    sync_interval_minutes=excluded.sync_interval_minutes,
    sync_start_time=excluded.sync_start_time, sync_end_time=excluded.sync_end_time,
    configured_by=auth.uid(), configured_at=now();

  perform cron.unschedule('storehub-attendance-hourly') where exists(select 1 from cron.job where jobname='storehub-attendance-hourly');
  perform cron.unschedule('storehub-attendance-current-month') where exists(select 1 from cron.job where jobname='storehub-attendance-current-month');
  perform cron.unschedule('storehub-attendance-history-queue') where exists(select 1 from cron.job where jobname='storehub-attendance-history-queue');
  perform cron.schedule('storehub-attendance-current-month','*/5 * * * *', $cron$select private.dispatch_attendance_automation('hourly');$cron$);
  perform cron.schedule('storehub-attendance-history-queue','*/10 * * * *', $cron$select private.dispatch_attendance_automation('history-queue');$cron$);
  return public.get_attendance_automation_settings();
end;
$$;

create or replace function public.configure_attendance_automation()
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_config private.attendance_automation_config%rowtype;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator access required'; end if;
  select * into v_config from private.attendance_automation_config where singleton;
  if v_config.singleton is null then
    return public.admin_save_attendance_automation_settings(true, 60, '00:05', '23:55');
  end if;
  return public.get_attendance_automation_settings();
end;
$$;

revoke all on function public.get_attendance_automation_settings() from public, anon;
revoke all on function public.admin_save_attendance_automation_settings(boolean, smallint, time, time) from public, anon;
grant execute on function public.get_attendance_automation_settings() to authenticated;
grant execute on function public.admin_save_attendance_automation_settings(boolean, smallint, time, time) to authenticated;

do $$
begin
  if exists(select 1 from private.attendance_automation_config where singleton) then
    perform cron.unschedule('storehub-attendance-hourly') where exists(select 1 from cron.job where jobname='storehub-attendance-hourly');
    perform cron.unschedule('storehub-attendance-current-month') where exists(select 1 from cron.job where jobname='storehub-attendance-current-month');
    perform cron.unschedule('storehub-attendance-history-queue') where exists(select 1 from cron.job where jobname='storehub-attendance-history-queue');
    perform cron.schedule('storehub-attendance-current-month','*/5 * * * *', $cron$select private.dispatch_attendance_automation('hourly');$cron$);
    perform cron.schedule('storehub-attendance-history-queue','*/10 * * * *', $cron$select private.dispatch_attendance_automation('history-queue');$cron$);
  end if;
end;
$$;

create function public.payroll_work_term(p_profile_id uuid)
returns text language sql security definer set search_path = public stable as $$
  select case when employment_type = 'part_time' then '兼职工时' else '加班' end
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
      when p_requester_role='manager' and p_event='updated' then '店长修改了加班申请'
      when p_requester_role='manager' then '店长加班申请待审批'
      when p_event='updated' then requester.display_name||'修改了'||v_term||'申请'
      else requester.display_name||'的'||v_term||'待审批'
    end,
    requester.display_name||'申报 '||p_request.overtime_date||' '||v_term||' '||p_request.hours||' 小时',
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

create or replace function public.submit_payroll_overtime_request(p_store_id uuid,p_overtime_date date,p_hours numeric,p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_request public.payroll_overtime_requests; v_role text:=public.current_user_role(); v_today date:=(now() at time zone 'Asia/Shanghai')::date; v_term text:=public.payroll_work_term(auth.uid());
begin
  if v_role not in ('staff','manager') then raise exception '当前账号不能提交%申请',v_term; end if;
  if not public.has_store_access(p_store_id) then raise exception '没有该门店的操作权限'; end if;
  if p_overtime_date>v_today or p_overtime_date<v_today-5 then raise exception '%日期只能选择今天或过去 5 日内',v_term; end if;
  if p_hours<0 or p_hours>6 or mod(p_hours,0.5)<>0 then raise exception '%必须按 0.5 小时递增，且在 0 至 6 小时之间',v_term; end if;
  insert into public.payroll_overtime_requests(profile_id,store_id,overtime_date,hours,reason)
  values(auth.uid(),p_store_id,p_overtime_date,p_hours,trim(coalesce(p_reason,''))) returning * into v_request;
  perform public.notify_payroll_overtime_reviewers(v_request,v_role,'submitted');
  return to_jsonb(v_request);
exception when unique_violation then raise exception '所选门店和日期已有%申请，可在记录中修改',v_term;
end;
$$;

create or replace function public.update_payroll_overtime_request(p_request_id uuid,p_store_id uuid,p_overtime_date date,p_hours numeric,p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_request public.payroll_overtime_requests; v_role text:=public.current_user_role(); v_today date:=(now() at time zone 'Asia/Shanghai')::date; v_term text:=public.payroll_work_term(auth.uid());
begin
  select * into v_request from public.payroll_overtime_requests where id=p_request_id and profile_id=auth.uid() for update;
  if v_request.id is null then raise exception '未找到%申请',v_term; end if;
  if v_role not in ('staff','manager') then raise exception '当前账号不能修改%申请',v_term; end if;
  if (v_request.created_at at time zone 'Asia/Shanghai')::date<v_today-5 then raise exception '只能修改今天或过去 5 日内提交的%申请',v_term; end if;
  if not public.has_store_access(p_store_id) then raise exception '没有该门店的操作权限'; end if;
  if p_overtime_date>v_today or p_overtime_date<v_today-5 then raise exception '%日期只能选择今天或过去 5 日内',v_term; end if;
  if p_hours<0 or p_hours>6 or mod(p_hours,0.5)<>0 then raise exception '%必须按 0.5 小时递增，且在 0 至 6 小时之间',v_term; end if;
  update public.payroll_overtime_requests set store_id=p_store_id,overtime_date=p_overtime_date,hours=p_hours,reason=trim(coalesce(p_reason,'')),status='pending',approved_hourly_rate=null,reviewed_by=null,reviewed_at=null,review_note=null,updated_at=now()
  where id=p_request_id returning * into v_request;
  perform public.notify_payroll_overtime_reviewers(v_request,v_role,'updated');
  return to_jsonb(v_request);
exception when unique_violation then raise exception '所选门店和日期已有另一条%申请',v_term;
end;
$$;

create or replace function public.review_payroll_overtime_request(p_request_id uuid,p_action text,p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_request public.payroll_overtime_requests; v_requester_role text; v_reviewer_role text:=public.current_user_role(); v_rate numeric; v_term text;
begin
  select request.* into v_request from public.payroll_overtime_requests request where request.id=p_request_id for update;
  if v_request.id is null then raise exception '未找到工时申请'; end if;
  select role into v_requester_role from public.profiles where id=v_request.profile_id;
  v_term:=public.payroll_work_term(v_request.profile_id);
  if v_request.profile_id=auth.uid() then raise exception '不能审批自己的%申请',v_term; end if;
  if v_requester_role='staff' then
    if v_reviewer_role<>'manager' or not public.has_store_access(v_request.store_id) then raise exception '员工工时申请需要由对应门店的店长审批'; end if;
  elsif v_requester_role='manager' then
    if v_reviewer_role<>'admin' or not public.can_admin_manage_attendance_profile(v_request.profile_id) then raise exception '店长加班申请需要由管理员审批'; end if;
  else raise exception '不支持该账号提交工时申请'; end if;
  if v_request.status<>'pending' then raise exception '只能审批待审批的工时申请'; end if;
  if p_action not in ('approved','rejected') then raise exception '无效的审批操作'; end if;
  if p_action='rejected' and nullif(trim(coalesce(p_note,'')),'') is null then raise exception '驳回时必须填写原因'; end if;
  if p_action='approved' then
    select hourly_rate into v_rate from public.payroll_overtime_rates where effective_from<=v_request.overtime_date and (effective_to is null or effective_to>=v_request.overtime_date) order by effective_from desc limit 1;
    if v_rate is null then raise exception '尚未配置适用于该日期的计薪时薪'; end if;
  end if;
  update public.payroll_overtime_requests set status=p_action,approved_hourly_rate=case when p_action='approved' then v_rate else null end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(trim(coalesce(p_note,'')),'')
  where id=p_request_id returning * into v_request;
  insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
  values(v_request.profile_id,v_request.store_id,'payroll_overtime_'||p_action,
    v_term||'申请'||case when p_action='approved' then '已通过' else '已驳回' end,
    v_request.overtime_date||' · '||v_request.hours||' 小时'||case when p_action='rejected' then ' · '||coalesce(v_request.review_note,'') else '' end,
    'payroll_overtime',v_request.id,'overtime-reviewed:'||v_request.id||':'||p_action||':'||(extract(epoch from v_request.updated_at)*1000000)::bigint)
  on conflict(dedupe_key) do nothing;
  return to_jsonb(v_request);
end;
$$;

revoke all on function public.payroll_work_term(uuid) from public, anon, authenticated;
