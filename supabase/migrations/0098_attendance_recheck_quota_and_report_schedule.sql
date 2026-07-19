-- Recheck historical attendance exceptions, allow a current-day API budget
-- override, and calculate operation-report labour from schedules rather than
-- completed punches.

create table private.dingtalk_api_limit_overrides (
  limit_date date primary key,
  daily_limit smallint not null check (daily_limit between 1 and 300),
  configured_by uuid references public.profiles(id) on delete set null,
  configured_at timestamptz not null default now()
);
revoke all on private.dingtalk_api_limit_overrides from public, anon, authenticated;

create or replace function public.reserve_dingtalk_api_call(p_corp_id text, p_endpoint text, p_action text)
returns integer language plpgsql security definer set search_path = public, private as $$
declare
  v_date date := (clock_timestamp() at time zone 'Asia/Shanghai')::date;
  v_count integer;
  v_limit integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('storehub-dingtalk-api-budget-' || v_date::text));
  select coalesce((select daily_limit from private.dingtalk_api_limit_overrides where limit_date=v_date), 150)
  into v_limit;
  select count(*)::integer into v_count from public.dingtalk_api_calls where usage_date = v_date;
  if v_count >= v_limit then
    raise exception 'DINGTALK_DAILY_API_LIMIT: 今日钉钉接口调用已达到安全上限 % 次', v_limit;
  end if;
  insert into public.dingtalk_api_calls(usage_date, corp_id, endpoint, action)
  values(v_date, btrim(p_corp_id), left(btrim(p_endpoint), 240), left(btrim(p_action), 80));
  return v_count + 1;
end $$;

create or replace function public.get_dingtalk_api_usage()
returns jsonb language plpgsql security definer set search_path = public, private stable as $$
declare
  v_date date := (now() at time zone 'Asia/Shanghai')::date;
  v_used integer;
  v_limit integer;
begin
  if public.current_user_role() <> 'admin' then raise exception '需要管理员权限' using errcode = '42501'; end if;
  select count(*)::integer into v_used from public.dingtalk_api_calls where usage_date = v_date;
  select coalesce((select daily_limit from private.dingtalk_api_limit_overrides where limit_date=v_date), 150)
  into v_limit;
  return jsonb_build_object('date', v_date, 'used', v_used, 'limit', v_limit,
    'remaining', greatest(v_limit - v_used, 0),
    'temporaryOverride', exists(select 1 from private.dingtalk_api_limit_overrides where limit_date=v_date));
end $$;

create function public.admin_set_dingtalk_api_daily_limit(p_limit smallint)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_date date := (clock_timestamp() at time zone 'Asia/Shanghai')::date;
begin
  if public.current_user_role() <> 'admin' then raise exception '需要管理员权限' using errcode = '42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 300 then raise exception '当日调用限额应为 1 至 300 次'; end if;
  insert into private.dingtalk_api_limit_overrides(limit_date,daily_limit,configured_by,configured_at)
  values(v_date,p_limit,auth.uid(),now())
  on conflict(limit_date) do update set daily_limit=excluded.daily_limit,configured_by=auth.uid(),configured_at=now();
  return public.get_dingtalk_api_usage();
end $$;

create or replace function public.prepare_operation_report(
  p_store_id uuid, p_report_date date, p_sales_sync_job_id uuid, p_attendance_sync_job_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_template public.operation_report_templates%rowtype;
  v_store public.stores%rowtype;
  v_report public.operation_reports%rowtype;
  v_sales numeric := 0; v_tc integer := 0; v_people integer := 0;
  v_scheduled_minutes numeric := 0; v_overtime_hours numeric := 0; v_total_hours numeric := 0;
  v_attendance_synced_at timestamptz;
  v_refunds jsonb := '[]'::jsonb;
begin
  if public.current_user_role() not in ('staff','manager','admin') or not public.has_store_access(p_store_id) then
    raise exception '没有该门店的运营报告权限' using errcode='42501';
  end if;
  select * into v_store from public.stores where id=p_store_id and is_active;
  select template.* into v_template from public.operation_report_templates template
    join public.pos_sales_integrations integration on integration.store_id=template.store_id and integration.provider='pospal'
    where template.store_id=p_store_id and template.enabled;
  if v_template.id is null then raise exception '该门店尚未启用运营报告'; end if;
  if not exists(select 1 from public.pos_sales_sync_jobs where id=p_sales_sync_job_id and store_id=p_store_id
      and sync_date=p_report_date and coalesce(sync_end_date,sync_date)=p_report_date and status='succeeded' and initiated_by=auth.uid()) then
    raise exception '请先完成当日收银数据同步';
  end if;

  select coalesce(revenue_amount,0) into v_sales from public.pos_sales_sync_jobs where id=p_sales_sync_job_id;
  select count(*)::integer into v_tc from public.pos_sales_tickets where store_id=p_store_id and revenue_date=p_report_date
    and not invalid and ticket_type='SELL';

  -- A partner is included from the persisted schedule even when no punch has
  -- occurred. Multiple enterprise rows for the same partner/day use the
  -- longest scheduled duration to avoid duplicate labour hours.
  with scheduled as (
    select daily.profile_id,
      max(case when daily.planned_on_at is not null and daily.planned_off_at > daily.planned_on_at
        then extract(epoch from (daily.planned_off_at-daily.planned_on_at))/60 else 0 end) as minutes,
      max(daily.last_synced_at) as synced_at
    from public.attendance_daily_records daily
    join public.profiles profile on profile.id=daily.profile_id
    where daily.store_id=p_store_id and daily.attendance_date=p_report_date
      and daily.planned_on_at is not null and daily.planned_off_at is not null
      and profile.employment_type='full_time' and profile.is_active and profile.deleted_at is null
    group by daily.profile_id
  )
  select coalesce(sum(minutes),0), max(synced_at)
  into v_scheduled_minutes,v_attendance_synced_at from scheduled;

  select count(distinct profile_id)::integer into v_people from (
    select daily.profile_id
    from public.attendance_daily_records daily
    join public.profiles profile on profile.id=daily.profile_id
    where daily.store_id=p_store_id and daily.attendance_date=p_report_date
      and daily.planned_on_at is not null and daily.planned_off_at is not null
      and profile.employment_type='full_time' and profile.is_active and profile.deleted_at is null
    union
    select request.profile_id
    from public.payroll_overtime_requests request
    join public.profiles profile on profile.id=request.profile_id
    where request.store_id=p_store_id and request.overtime_date=p_report_date and request.status='approved'
      and profile.employment_type='full_time' and profile.is_active and profile.deleted_at is null
  ) scheduled_or_overtime;

  if v_attendance_synced_at is null then
    select max(last_synced_at) into v_attendance_synced_at
    from public.attendance_sync_day_states where store_id=p_store_id and sync_date=p_report_date;
  end if;

  select coalesce(sum(request.hours),0) into v_overtime_hours
  from public.payroll_overtime_requests request
  where request.store_id=p_store_id and request.overtime_date=p_report_date and request.status='approved';
  v_total_hours := round(v_scheduled_minutes/60 + v_overtime_hours, 2);

  select coalesce(jsonb_agg(jsonb_build_object(
    'platform',case when lower(coalesce(ticket.order_source,'')) similar to '%(美团|meituan)%' then 'meituan'
      when lower(coalesce(ticket.order_source,'')) similar to '%(饿了么|eleme)%' then 'eleme' else 'other' end,
    'orderNumber',coalesce(nullif(ticket.web_order_no,''),nullif(ticket.external_order_no,''),nullif(ticket.order_no,''),nullif(ticket.external_sn,''),'未提供'),
    'reason',coalesce(ticket.remark,''),'ticketId',ticket.id) order by ticket.occurred_at),'[]'::jsonb)
  into v_refunds from public.pos_sales_tickets ticket
  where ticket.store_id=p_store_id and ticket.revenue_date=p_report_date
    and (ticket.ticket_type='SELL_RETURN' or ticket.invalid)
    and coalesce(ticket.order_source,ticket.web_order_no,ticket.external_order_no,ticket.order_no,'')<>'';

  insert into public.operation_reports(store_id,report_date,status,title_snapshot,field_config_snapshot,
    computed_data,refund_entries,refund_note_snapshot,sales_sync_job_id,attendance_sync_job_id,created_by,source_synced_at,refresh_started_at)
  values(p_store_id,p_report_date,'draft',v_template.title,v_template.fields,
    jsonb_build_object('store_name',v_store.name,'report_date',p_report_date,'sales_amount',v_sales,
      'transaction_count',v_tc,'full_time_partner_count',v_people,'total_work_hours',v_total_hours,
      'spmh',case when v_total_hours>0 then round(v_sales/v_total_hours,2) else 0 end,
      'attendance_data_synced_at',v_attendance_synced_at),
    v_refunds,v_template.refund_note,p_sales_sync_job_id,null,auth.uid(),clock_timestamp(),null)
  on conflict(store_id,report_date) do update set
    title_snapshot=excluded.title_snapshot,field_config_snapshot=excluded.field_config_snapshot,
    computed_data=excluded.computed_data,refund_entries=excluded.refund_entries,
    refund_note_snapshot=excluded.refund_note_snapshot,sales_sync_job_id=excluded.sales_sync_job_id,
    attendance_sync_job_id=null,source_synced_at=clock_timestamp(),
    refresh_started_at=null,updated_at=clock_timestamp()
  where operation_reports.status='draft' and operation_reports.created_by=auth.uid()
  returning * into v_report;
  if v_report.id is null then select * into v_report from public.operation_reports where store_id=p_store_id and report_date=p_report_date; end if;
  return to_jsonb(v_report);
end $$;

revoke all on function public.reserve_dingtalk_api_call(text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_dingtalk_api_call(text,text,text) to service_role;
revoke all on function public.admin_set_dingtalk_api_daily_limit(smallint) from public,anon;
grant execute on function public.admin_set_dingtalk_api_daily_limit(smallint) to authenticated;
