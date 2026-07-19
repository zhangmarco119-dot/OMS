-- Persist operation-report drafts, throttle source refreshes, calculate scheduled
-- attendance correctly, and enforce a hard DingTalk API budget below 150 calls/day.

alter table public.operation_reports
  add column if not exists source_synced_at timestamptz,
  add column if not exists refresh_started_at timestamptz;

create table public.dingtalk_api_calls (
  id bigint generated always as identity primary key,
  usage_date date not null default ((now() at time zone 'Asia/Shanghai')::date),
  corp_id text not null,
  endpoint text not null,
  action text not null,
  created_at timestamptz not null default now(),
  check (nullif(btrim(corp_id), '') is not null),
  check (nullif(btrim(endpoint), '') is not null),
  check (nullif(btrim(action), '') is not null)
);

create index dingtalk_api_calls_usage_idx
  on public.dingtalk_api_calls(usage_date, created_at desc);

alter table public.dingtalk_api_calls enable row level security;
create policy dingtalk_api_calls_admin_read on public.dingtalk_api_calls
for select to authenticated using (public.current_user_role() = 'admin');

create function public.reserve_dingtalk_api_call(p_corp_id text, p_endpoint text, p_action text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_date date := (clock_timestamp() at time zone 'Asia/Shanghai')::date;
  v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('storehub-dingtalk-api-budget-' || v_date::text));
  select count(*)::integer into v_count from public.dingtalk_api_calls where usage_date = v_date;
  if v_count >= 149 then
    raise exception 'DINGTALK_DAILY_API_LIMIT: 今日钉钉接口调用已达到安全上限 149 次';
  end if;
  insert into public.dingtalk_api_calls(usage_date, corp_id, endpoint, action)
  values(v_date, btrim(p_corp_id), left(btrim(p_endpoint), 240), left(btrim(p_action), 80));
  return v_count + 1;
end $$;

create function public.get_dingtalk_api_usage()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_date date := (now() at time zone 'Asia/Shanghai')::date;
  v_used integer;
begin
  if public.current_user_role() <> 'admin' then raise exception '需要管理员权限' using errcode = '42501'; end if;
  select count(*)::integer into v_used from public.dingtalk_api_calls where usage_date = v_date;
  return jsonb_build_object('date', v_date, 'used', v_used, 'limit', 149, 'remaining', greatest(149 - v_used, 0));
end $$;

create function public.begin_operation_report_refresh(p_store_id uuid, p_report_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_report public.operation_reports%rowtype;
  v_template public.operation_report_templates%rowtype;
begin
  if public.current_user_role() not in ('staff','manager','admin') or not public.has_store_access(p_store_id) then
    raise exception '没有该门店的运营报告权限' using errcode = '42501';
  end if;
  select * into v_report from public.operation_reports
  where store_id = p_store_id and report_date = p_report_date for update;
  if v_report.id is not null then
    if v_report.status = 'submitted' then
      return jsonb_build_object('mode','submitted','report',to_jsonb(v_report));
    end if;
    if v_report.created_by <> auth.uid() then
      raise exception '该日期已有其他员工正在填写运营报告';
    end if;
    if v_report.source_synced_at >= clock_timestamp() - interval '5 minutes' then
      return jsonb_build_object('mode','cached','report',to_jsonb(v_report),'cachedAt',v_report.source_synced_at);
    end if;
    if v_report.refresh_started_at >= clock_timestamp() - interval '30 seconds' then
      return jsonb_build_object('mode','throttled','retryAfterSeconds',30);
    end if;
    update public.operation_reports set refresh_started_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_report.id returning * into v_report;
    return jsonb_build_object('mode','refresh','report',to_jsonb(v_report));
  end if;

  select template.* into v_template from public.operation_report_templates template
  join public.pos_sales_integrations integration
    on integration.store_id = template.store_id and integration.provider = 'pospal'
  where template.store_id = p_store_id and template.enabled;
  if v_template.id is null then raise exception '该门店尚未启用运营报告'; end if;
  insert into public.operation_reports(
    store_id, report_date, status, title_snapshot, field_config_snapshot,
    refund_note_snapshot, created_by, refresh_started_at
  ) values (
    p_store_id, p_report_date, 'draft', v_template.title, v_template.fields,
    v_template.refund_note, auth.uid(), clock_timestamp()
  ) returning * into v_report;
  return jsonb_build_object('mode','refresh','report',to_jsonb(v_report));
end $$;

create function public.release_operation_report_refresh(p_report_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.operation_reports set refresh_started_at = null, updated_at = clock_timestamp()
  where id = p_report_id and status = 'draft' and created_by = auth.uid();
end $$;

create function public.save_operation_report_draft(
  p_report_id uuid, p_manual_values jsonb, p_refund_entries jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_report public.operation_reports%rowtype;
begin
  if jsonb_typeof(p_manual_values) <> 'object' or jsonb_typeof(p_refund_entries) <> 'array' then
    raise exception '运营报告草稿格式不正确';
  end if;
  update public.operation_reports set manual_values = p_manual_values,
    refund_entries = p_refund_entries, updated_at = clock_timestamp()
  where id = p_report_id and status = 'draft' and created_by = auth.uid()
  returning * into v_report;
  if v_report.id is null then raise exception '运营报告草稿不存在或无权修改' using errcode = '42501'; end if;
  return to_jsonb(v_report);
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
  if not exists(select 1 from public.attendance_sync_jobs where id=p_attendance_sync_job_id and store_id=p_store_id
      and range_start=p_report_date and range_end=p_report_date and status in ('succeeded','partial') and initiated_by=auth.uid()) then
    raise exception '请先完成当日考勤数据同步';
  end if;

  select coalesce(revenue_amount,0) into v_sales from public.pos_sales_sync_jobs where id=p_sales_sync_job_id;
  select count(*)::integer into v_tc from public.pos_sales_tickets where store_id=p_store_id and revenue_date=p_report_date
    and not invalid and ticket_type='SELL';

  -- A scheduled full-time partner is counted after an on-duty punch appears.
  -- Scheduled hours are used even before the off-duty punch, while approved
  -- overtime is added separately to the store's total labour hours.
  select count(distinct daily.profile_id)::integer,
    coalesce(sum(case when daily.planned_on_at is not null and daily.planned_off_at > daily.planned_on_at
      then extract(epoch from (daily.planned_off_at-daily.planned_on_at))/60 else 0 end),0)
  into v_people,v_scheduled_minutes
  from public.attendance_daily_records daily join public.profiles profile on profile.id=daily.profile_id
  where daily.store_id=p_store_id and daily.attendance_date=p_report_date
    and daily.planned_on_at is not null and daily.actual_on_at is not null
    and profile.employment_type='full_time' and profile.is_active and profile.deleted_at is null;

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
      'spmh',case when v_total_hours>0 then round(v_sales/v_total_hours,2) else 0 end),
    v_refunds,v_template.refund_note,p_sales_sync_job_id,p_attendance_sync_job_id,auth.uid(),clock_timestamp(),null)
  on conflict(store_id,report_date) do update set
    title_snapshot=excluded.title_snapshot,field_config_snapshot=excluded.field_config_snapshot,
    computed_data=excluded.computed_data,refund_entries=excluded.refund_entries,
    refund_note_snapshot=excluded.refund_note_snapshot,sales_sync_job_id=excluded.sales_sync_job_id,
    attendance_sync_job_id=excluded.attendance_sync_job_id,source_synced_at=clock_timestamp(),
    refresh_started_at=null,updated_at=clock_timestamp()
  where operation_reports.status='draft' and operation_reports.created_by=auth.uid()
  returning * into v_report;
  if v_report.id is null then select * into v_report from public.operation_reports where store_id=p_store_id and report_date=p_report_date; end if;
  return to_jsonb(v_report);
end $$;

-- The previous history and automatic queues caused repeated broad synchronisation.
-- Keep only explicit, purpose-scoped manual/report requests.
do $$
begin
  perform cron.unschedule('storehub-attendance-hourly') where exists(select 1 from cron.job where jobname='storehub-attendance-hourly');
  perform cron.unschedule('storehub-attendance-current-month') where exists(select 1 from cron.job where jobname='storehub-attendance-current-month');
  perform cron.unschedule('storehub-attendance-history-queue') where exists(select 1 from cron.job where jobname='storehub-attendance-history-queue');
exception when undefined_table then null;
end $$;

update private.attendance_automation_config set enabled=false where singleton;
update public.attendance_sync_jobs set status='failed', error_summary='同步队列已停用，请按实际需要手动同步', finished_at=now()
where status='queued';

grant select on public.dingtalk_api_calls to authenticated;
revoke all on function public.reserve_dingtalk_api_call(text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_dingtalk_api_call(text,text,text) to service_role;
revoke all on function public.get_dingtalk_api_usage(),
  public.begin_operation_report_refresh(uuid,date), public.release_operation_report_refresh(uuid),
  public.save_operation_report_draft(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.get_dingtalk_api_usage(),
  public.begin_operation_report_refresh(uuid,date), public.release_operation_report_refresh(uuid),
  public.save_operation_report_draft(uuid,jsonb,jsonb) to authenticated;
