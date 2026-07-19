-- Incremental DingTalk attendance sync, administrator-controlled daily sync
-- times, and operation reports that only consume persisted attendance data.

create table public.attendance_sync_day_states (
  corp_id text not null,
  store_id uuid not null references public.stores(id) on delete cascade,
  sync_date date not null,
  last_sync_job_id uuid references public.attendance_sync_jobs(id) on delete set null,
  last_synced_at timestamptz not null default now(),
  primary key (corp_id, store_id, sync_date)
);

alter table public.attendance_sync_day_states enable row level security;
create policy attendance_sync_day_states_admin_read on public.attendance_sync_day_states
  for select to authenticated using (public.current_user_role() = 'admin');
grant select on public.attendance_sync_day_states to authenticated;

-- Existing daily rows prove that the corresponding enterprise/store/date was
-- already fetched. This avoids a full historical re-fetch after deployment.
insert into public.attendance_sync_day_states(corp_id, store_id, sync_date, last_synced_at)
select corp_id, store_id, attendance_date, max(last_synced_at)
from public.attendance_daily_records
group by corp_id, store_id, attendance_date
on conflict(corp_id, store_id, sync_date) do update
set last_synced_at = greatest(attendance_sync_day_states.last_synced_at, excluded.last_synced_at);

-- Successful jobs also cover dates without schedules or punches; recording
-- those empty dates is essential to prevent them from being fetched forever.
insert into public.attendance_sync_day_states(corp_id, store_id, sync_date, last_sync_job_id, last_synced_at)
select corp_id, store_id, sync_date, job_id, synced_at
from (
  select distinct on (binding.corp_id, binding.store_id, day::date)
    binding.corp_id, binding.store_id, day::date as sync_date, job.id as job_id,
    coalesce(job.finished_at, job.updated_at, job.created_at) as synced_at
  from public.attendance_sync_jobs job
  join public.dingtalk_employee_bindings binding
    on binding.binding_status = 'active'
    and (job.store_id is null or job.store_id = binding.store_id)
    and (job.profile_id is null or job.profile_id = binding.profile_id)
    and (job.corp_id = 'multi-enterprise' or job.corp_id = binding.corp_id)
  cross join lateral generate_series(job.range_start::timestamp, job.range_end::timestamp, interval '1 day') day
  where job.status = 'succeeded' and job.range_start is not null and job.range_end is not null
  order by binding.corp_id, binding.store_id, day::date,
    coalesce(job.finished_at, job.updated_at, job.created_at) desc
) latest_jobs
on conflict(corp_id, store_id, sync_date) do update
set last_sync_job_id = excluded.last_sync_job_id,
    last_synced_at = greatest(attendance_sync_day_states.last_synced_at, excluded.last_synced_at);

alter table private.attendance_automation_config
  add column if not exists sync_times time[] not null default array['10:00'::time, '14:00'::time, '22:00'::time],
  add column if not exists last_dispatched_slot timestamptz;

create or replace function private.dispatch_attendance_automation(p_mode text)
returns bigint language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_config private.attendance_automation_config%rowtype;
  v_local_now timestamp := clock_timestamp() at time zone 'Asia/Shanghai';
  v_sync_time time;
  v_slot_local timestamp;
  v_slot_at timestamptz;
  v_request_id bigint;
begin
  if p_mode <> 'incremental' then return null; end if;
  select * into v_config from private.attendance_automation_config where singleton for update;
  if not found or not v_config.enabled then return null; end if;

  foreach v_sync_time in array v_config.sync_times loop
    v_slot_local := date_trunc('day', v_local_now) + v_sync_time;
    if v_local_now >= v_slot_local and v_local_now < v_slot_local + interval '2 minutes' then
      v_slot_at := v_slot_local at time zone 'Asia/Shanghai';
      if v_config.last_dispatched_slot is not null and v_config.last_dispatched_slot >= v_slot_at then
        return null;
      end if;
      update private.attendance_automation_config
      set last_dispatched_at = clock_timestamp(), last_dispatched_slot = v_slot_at
      where singleton;
      select net.http_post(
        url := v_config.function_url,
        headers := jsonb_build_object('Content-Type','application/json','x-storehub-cron-secret',v_config.cron_token),
        body := jsonb_build_object('action','scheduled-sync','mode','incremental'),
        timeout_milliseconds := 25000
      ) into v_request_id;
      return v_request_id;
    end if;
  end loop;
  return null;
end $$;

create or replace function public.get_attendance_incremental_schedule()
returns jsonb language plpgsql security definer set search_path = public, private stable as $$
declare v_config private.attendance_automation_config%rowtype;
begin
  if public.current_user_role() <> 'admin' then raise exception '需要管理员权限'; end if;
  select * into v_config from private.attendance_automation_config where singleton;
  return jsonb_build_object(
    'configured', v_config.singleton is not null,
    'enabled', coalesce(v_config.enabled, false),
    'times', coalesce((select jsonb_agg(to_char(value, 'HH24:MI') order by value) from unnest(v_config.sync_times) value), '[]'::jsonb),
    'lastDispatchedAt', v_config.last_dispatched_at,
    'configuredAt', v_config.configured_at
  );
end $$;

create or replace function public.admin_save_attendance_incremental_schedule(
  p_enabled boolean,
  p_times time[]
)
returns jsonb language plpgsql security definer set search_path = public, private, cron as $$
declare
  v_issuer text;
  v_url text;
  v_token text;
  v_times time[];
  v_job record;
begin
  if public.current_user_role() <> 'admin' then raise exception '需要管理员权限'; end if;
  select array_agg(value order by value) into v_times
  from (select distinct unnest(p_times) as value) values_set;
  if coalesce(cardinality(v_times), 0) < 1 or cardinality(v_times) > 8 then
    raise exception '请设置 1 至 8 个每日同步时间';
  end if;

  v_issuer := coalesce(auth.jwt()->>'iss','');
  if v_issuer !~ '^https://[a-z0-9-]+\.supabase\.co/auth/v1/?$' then raise exception '无法确认当前 Supabase 项目地址'; end if;
  v_url := regexp_replace(v_issuer, '/auth/v1/?$', '/functions/v1/dingtalk-attendance');
  select cron_token into v_token from private.attendance_automation_config where singleton;
  v_token := coalesce(v_token, gen_random_uuid()::text || gen_random_uuid()::text);

  insert into private.attendance_automation_config(
    singleton, function_url, cron_token, enabled, sync_times, configured_by, configured_at
  ) values (true, v_url, v_token, p_enabled, v_times, auth.uid(), now())
  on conflict(singleton) do update set
    function_url = excluded.function_url,
    enabled = excluded.enabled,
    sync_times = excluded.sync_times,
    configured_by = auth.uid(),
    configured_at = now(),
    last_dispatched_slot = null;

  for v_job in select jobid from cron.job where jobname in (
    'storehub-attendance-hourly', 'storehub-attendance-current-month',
    'storehub-attendance-history-queue', 'storehub-attendance-incremental'
  ) loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  -- pg_cron uses the database timezone. The dispatcher compares Shanghai local
  -- time, so this lightweight minute tick supports arbitrary administrator
  -- selected minutes without making an external request except at a match.
  perform cron.schedule('storehub-attendance-incremental', '* * * * *',
    $cron$select private.dispatch_attendance_automation('incremental');$cron$);
  return public.get_attendance_incremental_schedule();
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

  select count(distinct daily.profile_id)::integer,
    coalesce(sum(case when daily.planned_on_at is not null and daily.planned_off_at > daily.planned_on_at
      then extract(epoch from (daily.planned_off_at-daily.planned_on_at))/60 else 0 end),0),
    max(daily.last_synced_at)
  into v_people,v_scheduled_minutes,v_attendance_synced_at
  from public.attendance_daily_records daily join public.profiles profile on profile.id=daily.profile_id
  where daily.store_id=p_store_id and daily.attendance_date=p_report_date
    and daily.planned_on_at is not null and daily.actual_on_at is not null
    and profile.employment_type='full_time' and profile.is_active and profile.deleted_at is null;

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

revoke all on function private.dispatch_attendance_automation(text) from public, anon, authenticated;
revoke all on function public.get_attendance_incremental_schedule(), public.admin_save_attendance_incremental_schedule(boolean,time[]) from public, anon;
grant execute on function public.get_attendance_incremental_schedule(), public.admin_save_attendance_incremental_schedule(boolean,time[]) to authenticated;
