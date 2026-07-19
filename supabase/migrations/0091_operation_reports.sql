-- Xizhimen operation reports: configurable templates, fresh POS/attendance
-- snapshots, photo evidence and submitted reports for managers/admins.

alter table public.pos_sales_tickets
  add column if not exists web_order_no text,
  add column if not exists external_order_no text,
  add column if not exists order_no text,
  add column if not exists remark text,
  add column if not exists sell_ticket_uid text;

create table public.operation_report_templates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores(id) on delete cascade,
  title text not null default '每日营运报告',
  fields jsonb not null,
  refund_note text not null default '极速退款无需填写原因；出现异物、漏送、超时、缺货等问题，在对应订单后写明原因',
  enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (nullif(btrim(title), '') is not null),
  check (jsonb_typeof(fields) = 'array')
);

create table public.operation_reports (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  report_date date not null,
  status text not null default 'draft' check (status in ('draft','submitted')),
  title_snapshot text not null,
  field_config_snapshot jsonb not null,
  computed_data jsonb not null default '{}'::jsonb,
  manual_values jsonb not null default '{}'::jsonb,
  refund_entries jsonb not null default '[]'::jsonb,
  refund_note_snapshot text not null default '',
  text_report text,
  sales_sync_job_id uuid references public.pos_sales_sync_jobs(id) on delete set null,
  attendance_sync_job_id uuid references public.attendance_sync_jobs(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, report_date),
  check (jsonb_typeof(field_config_snapshot) = 'array'),
  check (jsonb_typeof(computed_data) = 'object'),
  check (jsonb_typeof(manual_values) = 'object'),
  check (jsonb_typeof(refund_entries) = 'array'),
  check ((status = 'submitted') = (submitted_at is not null))
);

create table public.operation_report_images (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.operation_reports(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  field_id text not null,
  bucket text not null default 'operation-report-images' check (bucket = 'operation-report-images'),
  object_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (report_id, field_id),
  check (nullif(btrim(field_id), '') is not null)
);

create index operation_reports_store_date_idx on public.operation_reports(store_id, report_date desc);
create index operation_report_images_report_idx on public.operation_report_images(report_id, created_at);

create trigger operation_report_templates_touch before update on public.operation_report_templates
for each row execute function public.touch_updated_at();
create trigger operation_reports_touch before update on public.operation_reports
for each row execute function public.touch_updated_at();

alter table public.operation_report_templates enable row level security;
alter table public.operation_reports enable row level security;
alter table public.operation_report_images enable row level security;

create policy operation_report_templates_read on public.operation_report_templates
for select to authenticated using (public.has_store_access(store_id));
create policy operation_report_templates_admin_write on public.operation_report_templates
for all to authenticated using (public.current_user_role() = 'admin' and public.has_store_access(store_id))
with check (public.current_user_role() = 'admin' and public.has_store_access(store_id));

create policy operation_reports_read on public.operation_reports
for select to authenticated using (
  public.has_store_access(store_id)
  and (created_by = auth.uid() or public.current_user_role() in ('manager','admin'))
);
create policy operation_reports_draft_write on public.operation_reports
for all to authenticated using (
  public.has_store_access(store_id) and created_by = auth.uid() and status = 'draft'
) with check (
  public.has_store_access(store_id) and created_by = auth.uid() and status = 'draft'
);

create policy operation_report_images_read on public.operation_report_images
for select to authenticated using (
  exists(select 1 from public.operation_reports report where report.id = report_id
    and public.has_store_access(report.store_id)
    and (report.created_by = auth.uid() or public.current_user_role() in ('manager','admin')))
);
create policy operation_report_images_write on public.operation_report_images
for all to authenticated using (
  uploaded_by = auth.uid() and exists(select 1 from public.operation_reports report
    where report.id = report_id and report.status = 'draft' and report.created_by = auth.uid())
) with check (
  uploaded_by = auth.uid() and public.has_store_access(store_id)
  and exists(select 1 from public.operation_reports report
    where report.id = report_id and report.store_id = store_id and report.status = 'draft' and report.created_by = auth.uid())
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('operation-report-images','operation-report-images',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy operation_report_storage_read on storage.objects for select to authenticated
using (bucket_id = 'operation-report-images' and exists(
  select 1 from public.operation_report_images image
  join public.operation_reports report on report.id=image.report_id
  where image.object_path=name and public.has_store_access(report.store_id)
    and (report.created_by=auth.uid() or public.current_user_role() in ('manager','admin'))
));
create policy operation_report_storage_insert on storage.objects for insert to authenticated
with check (bucket_id='operation-report-images' and public.has_store_access(((storage.foldername(name))[1])::uuid));
create policy operation_report_storage_delete on storage.objects for delete to authenticated
using (bucket_id='operation-report-images' and exists(
  select 1 from public.operation_report_images image
  join public.operation_reports report on report.id=image.report_id
  where image.object_path=name and image.uploaded_by=auth.uid() and report.status='draft'
));

insert into public.operation_report_templates(store_id,title,fields,enabled)
select integration.store_id, '每日营运报告',
  '[{"id":"store_name","label":"门店名称","kind":"computed","enabled":true},{"id":"report_date","label":"日期","kind":"computed","enabled":true},{"id":"sales_amount","label":"今日销售额","kind":"computed","enabled":true},{"id":"transaction_count","label":"全天交易次数（TC）","kind":"computed","enabled":true},{"id":"full_time_partner_count","label":"门店全职伙伴数量","kind":"computed","enabled":true},{"id":"total_work_hours","label":"当日工时总和（小时）","kind":"computed","enabled":true},{"id":"spmh","label":"门店生产力（SPMH）","kind":"computed","enabled":true},{"id":"product_inventory","label":"产品与库存","kind":"manual","enabled":true,"required":true,"requiresPhoto":true,"unit":""},{"id":"yogurt_reserve","label":"酸奶储备","kind":"manual","enabled":true,"required":true,"requiresPhoto":true,"unit":"批"},{"id":"milk_powder_remaining","label":"乳粉剩余","kind":"manual","enabled":true,"required":true,"requiresPhoto":true,"unit":"箱"},{"id":"milk_remaining","label":"牛奶剩余","kind":"manual","enabled":true,"required":true,"requiresPhoto":true,"unit":"箱"},{"id":"sorbet_remaining","label":"雪酪剩余数量","kind":"manual","enabled":true,"required":true,"requiresPhoto":true,"unit":"包"},{"id":"waste_materials","label":"当日报废物料","kind":"manual","enabled":true,"required":true,"requiresPhoto":true,"unit":""}]'::jsonb,
  true
from public.pos_sales_integrations integration
where integration.provider='pospal'
on conflict(store_id) do nothing;

create or replace function public.get_operation_report_availability(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare v_template public.operation_report_templates%rowtype;
begin
  if not public.has_store_access(p_store_id) then raise exception '没有该门店的访问权限' using errcode='42501'; end if;
  select template.* into v_template from public.operation_report_templates template
  join public.pos_sales_integrations integration on integration.store_id=template.store_id and integration.provider='pospal'
  where template.store_id=p_store_id and template.enabled;
  if v_template.id is null then return jsonb_build_object('available',false); end if;
  return jsonb_build_object('available',true,'templateId',v_template.id,'title',v_template.title,
    'fields',v_template.fields,'refundNote',v_template.refund_note);
end $$;

create or replace function public.prepare_operation_report(
  p_store_id uuid, p_report_date date, p_sales_sync_job_id uuid, p_attendance_sync_job_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_template public.operation_report_templates%rowtype;
  v_store public.stores%rowtype;
  v_report public.operation_reports%rowtype;
  v_sales numeric := 0; v_tc integer := 0; v_people integer := 0; v_minutes numeric := 0;
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
  select count(distinct daily.profile_id)::integer,
    coalesce(sum(case when daily.actual_on_at is not null and daily.actual_off_at>daily.actual_on_at
      then extract(epoch from (daily.actual_off_at-daily.actual_on_at))/60 else 0 end),0)
  into v_people,v_minutes
  from public.attendance_daily_records daily join public.profiles profile on profile.id=daily.profile_id
  where daily.store_id=p_store_id and daily.attendance_date=p_report_date and daily.is_attended
    and daily.actual_on_at is not null and daily.actual_off_at is not null and profile.employment_type='full_time';

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
    computed_data,refund_entries,refund_note_snapshot,sales_sync_job_id,attendance_sync_job_id,created_by)
  values(p_store_id,p_report_date,'draft',v_template.title,v_template.fields,
    jsonb_build_object('store_name',v_store.name,'report_date',p_report_date,'sales_amount',v_sales,
      'transaction_count',v_tc,'full_time_partner_count',v_people,'total_work_hours',round(v_minutes/60,2),
      'spmh',case when v_minutes>0 then round(v_sales/(v_minutes/60),2) else 0 end),
    v_refunds,v_template.refund_note,p_sales_sync_job_id,p_attendance_sync_job_id,auth.uid())
  on conflict(store_id,report_date) do update set
    title_snapshot=excluded.title_snapshot,field_config_snapshot=excluded.field_config_snapshot,
    computed_data=excluded.computed_data,refund_entries=excluded.refund_entries,
    refund_note_snapshot=excluded.refund_note_snapshot,sales_sync_job_id=excluded.sales_sync_job_id,
    attendance_sync_job_id=excluded.attendance_sync_job_id,created_by=auth.uid(),updated_at=now()
  where operation_reports.status='draft'
  returning * into v_report;
  if v_report.id is null then select * into v_report from public.operation_reports where store_id=p_store_id and report_date=p_report_date; end if;
  return to_jsonb(v_report);
end $$;

create or replace function public.submit_operation_report(
  p_report_id uuid, p_manual_values jsonb, p_refund_entries jsonb, p_text_report text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_report public.operation_reports%rowtype; v_field jsonb; v_missing text[] := '{}';
begin
  select * into v_report from public.operation_reports where id=p_report_id for update;
  if v_report.id is null or v_report.created_by<>auth.uid() or v_report.status<>'draft' then
    raise exception '运营报告不可提交' using errcode='42501';
  end if;
  for v_field in select value from jsonb_array_elements(v_report.field_config_snapshot) loop
    if coalesce((v_field->>'enabled')::boolean,true) and v_field->>'kind'='manual' then
      if coalesce((v_field->>'required')::boolean,false) and nullif(btrim(p_manual_values->>(v_field->>'id')),'') is null then
        v_missing:=array_append(v_missing,v_field->>'label');
      end if;
      if coalesce((v_field->>'requiresPhoto')::boolean,false) and not exists(
        select 1 from public.operation_report_images image where image.report_id=p_report_id and image.field_id=v_field->>'id') then
        v_missing:=array_append(v_missing,(v_field->>'label')||'照片');
      end if;
    end if;
  end loop;
  if cardinality(v_missing)>0 then raise exception '请完善：%',array_to_string(v_missing,'、'); end if;
  if nullif(btrim(p_text_report),'') is null then raise exception '报告正文不能为空'; end if;
  update public.operation_reports set status='submitted',manual_values=p_manual_values,
    refund_entries=p_refund_entries,text_report=p_text_report,submitted_at=now(),updated_at=now()
  where id=p_report_id returning * into v_report;
  insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
  select profile.id,v_report.store_id,'operation_report_submitted','新的每日营运报告',
    v_report.report_date::text||' · '||v_report.title_snapshot,'operation_report',v_report.id,
    'operation-report:'||v_report.id||':'||profile.id
  from public.profiles profile join public.profile_store_access access on access.profile_id=profile.id
  where access.store_id=v_report.store_id and profile.role in ('manager','admin') and profile.is_active and profile.deleted_at is null
    and profile.id<>auth.uid() on conflict(dedupe_key) do nothing;
  return to_jsonb(v_report);
end $$;

create or replace function public.admin_save_operation_report_template(
  p_store_id uuid,p_title text,p_fields jsonb,p_refund_note text,p_enabled boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result public.operation_report_templates%rowtype;
begin
  if public.current_user_role()<>'admin' or not public.has_store_access(p_store_id) then raise exception '管理员权限不足' using errcode='42501'; end if;
  if jsonb_typeof(p_fields)<>'array' or jsonb_array_length(p_fields)=0 then raise exception '报告字段不能为空'; end if;
  insert into public.operation_report_templates(store_id,title,fields,refund_note,enabled,updated_by)
  values(p_store_id,btrim(p_title),p_fields,coalesce(p_refund_note,''),p_enabled,auth.uid())
  on conflict(store_id) do update set title=excluded.title,fields=excluded.fields,refund_note=excluded.refund_note,
    enabled=excluded.enabled,updated_by=auth.uid(),updated_at=now() returning * into v_result;
  return to_jsonb(v_result);
end $$;

grant select,insert,update,delete on public.operation_report_templates,public.operation_reports,public.operation_report_images to authenticated;
revoke all on function public.get_operation_report_availability(uuid) from public,anon;
revoke all on function public.prepare_operation_report(uuid,date,uuid,uuid) from public,anon;
revoke all on function public.submit_operation_report(uuid,jsonb,jsonb,text) from public,anon;
revoke all on function public.admin_save_operation_report_template(uuid,text,jsonb,text,boolean) from public,anon;
grant execute on function public.get_operation_report_availability(uuid),public.prepare_operation_report(uuid,date,uuid,uuid),
  public.submit_operation_report(uuid,jsonb,jsonb,text),public.admin_save_operation_report_template(uuid,text,jsonb,text,boolean) to authenticated;
