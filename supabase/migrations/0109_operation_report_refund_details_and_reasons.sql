-- Preserve platform-facing refund details and provide a maintainable reason
-- catalogue for operation reports.

alter table public.pos_sales_tickets
  add column if not exists platform_sequence text,
  add column if not exists product_summary text,
  add column if not exists order_total_amount numeric(12,2);

create table if not exists public.operation_report_refund_reasons (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  normalized_label text generated always as (lower(btrim(label))) stored,
  display_order integer not null default 100 check (display_order >= 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(normalized_label)
);

alter table public.operation_report_refund_reasons enable row level security;

drop policy if exists operation_report_refund_reasons_read on public.operation_report_refund_reasons;
create policy operation_report_refund_reasons_read
on public.operation_report_refund_reasons for select to authenticated
using (is_active or public.current_user_role() = 'admin');

drop policy if exists operation_report_refund_reasons_admin_write on public.operation_report_refund_reasons;
create policy operation_report_refund_reasons_admin_write
on public.operation_report_refund_reasons for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

insert into public.operation_report_refund_reasons(label, display_order)
values
  ('1分钟内极速退款', 10),
  ('顾客点错要求退单', 20),
  ('门店漏装、错装', 30),
  ('顾客反馈有异物', 40),
  ('顾客反馈餐品不新鲜', 50),
  ('不符合顾客口味', 60),
  ('快递员拿错', 70),
  ('配送超时', 80),
  ('顾客没有拿到餐品', 90),
  ('优质顾客平台无理由通过退款', 100)
on conflict(normalized_label) do update
set is_active = true,
    display_order = excluded.display_order,
    updated_at = now();

create or replace function public.save_operation_report_refund_reason(p_label text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_reason public.operation_report_refund_reasons%rowtype;
  v_label text := btrim(coalesce(p_label, ''));
  v_order integer;
begin
  if public.current_user_role() not in ('staff','manager','admin') then
    raise exception '当前账号不能维护退款原因' using errcode='42501';
  end if;
  if char_length(v_label) not between 1 and 80 then
    raise exception '退款原因应为 1 至 80 个字';
  end if;

  select coalesce(max(display_order), 0) + 10
  into v_order
  from public.operation_report_refund_reasons;

  insert into public.operation_report_refund_reasons(label, display_order, is_active, created_by)
  values(v_label, v_order, true, auth.uid())
  on conflict(normalized_label) do update
  set is_active = true,
      updated_at = now()
  returning * into v_reason;

  return jsonb_build_object(
    'id', v_reason.id,
    'label', v_reason.label,
    'displayOrder', v_reason.display_order,
    'isActive', v_reason.is_active
  );
end $$;

create or replace function public.admin_update_operation_report_refund_reason(
  p_id uuid,
  p_label text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_reason public.operation_report_refund_reasons%rowtype;
  v_label text := btrim(coalesce(p_label, ''));
begin
  if public.current_user_role() <> 'admin' then
    raise exception '需要管理员权限' using errcode='42501';
  end if;
  if char_length(v_label) not between 1 and 80 then
    raise exception '退款原因应为 1 至 80 个字';
  end if;

  update public.operation_report_refund_reasons
  set label = v_label,
      updated_at = now()
  where id = p_id
  returning * into v_reason;
  if v_reason.id is null then raise exception '退款原因不存在'; end if;

  return jsonb_build_object(
    'id', v_reason.id,
    'label', v_reason.label,
    'displayOrder', v_reason.display_order,
    'isActive', v_reason.is_active
  );
exception
  when unique_violation then raise exception '已存在相同的退款原因';
end $$;

create or replace function public.admin_delete_operation_report_refund_reason(p_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if public.current_user_role() <> 'admin' then
    raise exception '需要管理员权限' using errcode='42501';
  end if;
  delete from public.operation_report_refund_reasons where id = p_id;
  if not found then raise exception '退款原因不存在'; end if;
end $$;

create or replace function public.get_operation_report_availability(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_template public.operation_report_templates%rowtype;
  v_reasons jsonb := '[]'::jsonb;
begin
  if not public.has_store_access(p_store_id) then raise exception '没有该门店的访问权限' using errcode='42501'; end if;
  select template.* into v_template from public.operation_report_templates template
  join public.pos_sales_integrations integration on integration.store_id=template.store_id and integration.provider='pospal'
  where template.store_id=p_store_id and template.enabled;
  if v_template.id is null then return jsonb_build_object('available',false); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', reason.id,
    'label', reason.label,
    'displayOrder', reason.display_order,
    'isActive', reason.is_active
  ) order by reason.display_order, reason.created_at), '[]'::jsonb)
  into v_reasons
  from public.operation_report_refund_reasons reason
  where reason.is_active or public.current_user_role() = 'admin';

  return jsonb_build_object(
    'available', true,
    'templateId', v_template.id,
    'title', v_template.title,
    'fields', v_template.fields,
    'refundNote', v_template.refund_note,
    'refundReasons', v_reasons
  );
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
    'platform', case when lower(coalesce(ticket.order_source,'')) similar to '%(美团|meituan)%' then 'meituan'
      when lower(coalesce(ticket.order_source,'')) similar to '%(饿了么|eleme)%' then 'eleme' else 'other' end,
    'platformSequence', coalesce(nullif(ticket.platform_sequence,''), '未提供'),
    'productSummary', coalesce(nullif(ticket.product_summary,''), '产品信息未提供'),
    'orderTotalAmount', coalesce(ticket.order_total_amount, abs(ticket.total_amount)),
    'orderNumber', coalesce(nullif(ticket.platform_sequence,''), '未提供'),
    'reason', '',
    'ticketId', ticket.id
  ) order by ticket.occurred_at), '[]'::jsonb)
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

grant select on public.operation_report_refund_reasons to authenticated;
revoke all on function public.save_operation_report_refund_reason(text) from public,anon;
revoke all on function public.admin_update_operation_report_refund_reason(uuid,text) from public,anon;
revoke all on function public.admin_delete_operation_report_refund_reason(uuid) from public,anon;
grant execute on function public.save_operation_report_refund_reason(text) to authenticated;
grant execute on function public.admin_update_operation_report_refund_reason(uuid,text) to authenticated;
grant execute on function public.admin_delete_operation_report_refund_reason(uuid) to authenticated;
