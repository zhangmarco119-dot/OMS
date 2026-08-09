-- Allow store users to deliberately start a fresh arrival draft and add an
-- auditable correction workflow for already submitted arrivals.

create table public.arrival_report_correction_requests (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.arrival_reports(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  requested_by uuid not null references public.profiles(id),
  requester_role text not null check (requester_role in ('staff', 'manager')),
  original_version integer not null check (original_version > 0),
  proposed_fields jsonb not null check (jsonb_typeof(proposed_fields) = 'object'),
  proposed_items jsonb not null check (jsonb_typeof(proposed_items) = 'array'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
  )
);

create unique index arrival_corrections_one_pending_per_report_idx
on public.arrival_report_correction_requests(report_id)
where status = 'pending';

create index arrival_corrections_store_status_created_idx
on public.arrival_report_correction_requests(store_id, status, created_at desc);

create index arrival_corrections_requester_created_idx
on public.arrival_report_correction_requests(requested_by, created_at desc);

create trigger arrival_report_corrections_touch_updated_at
before update on public.arrival_report_correction_requests
for each row execute function public.touch_updated_at();

alter table public.arrival_report_correction_requests enable row level security;

create policy arrival_corrections_select_allowed
on public.arrival_report_correction_requests for select
to authenticated
using (
  requested_by = auth.uid()
  or (
    public.current_user_role() = 'admin'
    and public.has_store_access(store_id)
  )
  or (
    public.current_user_role() = 'manager'
    and requester_role = 'staff'
    and public.can_manage_store(store_id)
  )
);

revoke all on public.arrival_report_correction_requests from public;
grant select on public.arrival_report_correction_requests to authenticated;

create or replace function public.reset_arrival_draft(
  p_report_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.arrival_reports%rowtype;
  v_now timestamp := timezone('Asia/Shanghai', now());
begin
  select * into v_report
  from public.arrival_reports
  where id = p_report_id
  for update;

  if v_report.id is null then
    raise exception 'arrival report not found' using errcode = 'P0002';
  end if;
  if not public.can_edit_arrival_report(p_report_id) then
    raise exception 'arrival draft reset denied' using errcode = '42501';
  end if;
  if v_report.version <> p_expected_version then
    raise exception 'arrival report version conflict' using errcode = '40001';
  end if;
  if exists (select 1 from public.arrival_report_images where report_id = p_report_id) then
    raise exception 'arrival draft images must be removed before reset' using errcode = '55000';
  end if;

  delete from public.arrival_report_items where report_id = p_report_id;

  update public.arrival_reports
  set arrival_date = v_now::date,
      arrival_time = v_now::time(0),
      carrier_name = null,
      tracking_no = null,
      generated_summary = '',
      note = null
  where id = p_report_id
  returning * into v_report;

  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values (
    v_report.store_id,
    auth.uid(),
    'arrival_draft_reset',
    'arrival_reports',
    v_report.id,
    jsonb_build_object('report_no', v_report.report_no, 'version', v_report.version)
  );

  return to_jsonb(v_report);
end;
$$;

revoke all on function public.reset_arrival_draft(uuid, integer) from public;
grant execute on function public.reset_arrival_draft(uuid, integer) to authenticated;

create or replace function public.submit_arrival_correction_request(
  p_report_id uuid,
  p_fields jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.arrival_reports%rowtype;
  v_role text := public.current_user_role();
  v_item jsonb;
  v_product_id uuid;
  v_normalized_items jsonb := '[]'::jsonb;
  v_request public.arrival_report_correction_requests%rowtype;
begin
  if coalesce(jsonb_typeof(p_fields), 'null') <> 'object' then
    raise exception 'arrival correction fields must be an object' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_items), 'null') <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception 'arrival correction requires at least one item' using errcode = '22023';
  end if;
  if v_role not in ('staff', 'manager') then
    raise exception 'arrival correction requester role denied' using errcode = '42501';
  end if;

  select * into v_report
  from public.arrival_reports
  where id = p_report_id
  for update;

  if v_report.id is null then
    raise exception 'arrival report not found' using errcode = 'P0002';
  end if;
  if v_report.status not in ('submitted', 'viewed') then
    raise exception 'only effective arrivals can be corrected' using errcode = '55000';
  end if;
  if not public.has_store_access(v_report.store_id)
    or public.current_user_store_id() <> v_report.store_id
    or (v_role = 'staff' and v_report.reported_by <> auth.uid()) then
    raise exception 'arrival correction request denied' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.arrival_report_correction_requests
    where report_id = p_report_id and status = 'pending'
  ) then
    raise exception 'arrival report already has a pending correction' using errcode = '55000';
  end if;

  perform (p_fields ->> 'arrival_date')::date;
  if nullif(p_fields ->> 'arrival_time', '') is not null then
    perform (p_fields ->> 'arrival_time')::time;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or nullif(btrim(v_item ->> 'product_name_snapshot'), '') is null
      or nullif(btrim(v_item ->> 'unit'), '') is null
      or (v_item ->> 'quantity')::numeric <= 0
      or (v_item ->> 'sort_order')::integer < 0 then
      raise exception 'invalid arrival correction item' using errcode = '22023';
    end if;

    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    if v_product_id is not null and not exists (
      select 1 from public.products product
      where product.id = v_product_id
        and product.store_id = v_report.store_id
        and product.is_active = true
    ) then
      raise exception 'arrival correction product does not belong to this store' using errcode = '23514';
    end if;

    v_normalized_items := v_normalized_items || jsonb_build_array(jsonb_build_object(
      'id', (v_item ->> 'id')::uuid,
      'product_id', v_product_id,
      'product_name_snapshot', btrim(v_item ->> 'product_name_snapshot'),
      'quantity', (v_item ->> 'quantity')::numeric,
      'unit', btrim(v_item ->> 'unit'),
      'note', nullif(btrim(v_item ->> 'note'), ''),
      'is_unmatched_product', v_product_id is null,
      'sort_order', (v_item ->> 'sort_order')::integer
    ));
  end loop;

  insert into public.arrival_report_correction_requests(
    report_id, store_id, requested_by, requester_role, original_version,
    proposed_fields, proposed_items
  ) values (
    v_report.id,
    v_report.store_id,
    auth.uid(),
    v_role,
    v_report.version,
    jsonb_build_object(
      'arrival_date', (p_fields ->> 'arrival_date')::date,
      'arrival_time', nullif(p_fields ->> 'arrival_time', '')::time,
      'carrier_name', nullif(btrim(p_fields ->> 'carrier_name'), ''),
      'tracking_no', nullif(btrim(p_fields ->> 'tracking_no'), ''),
      'note', nullif(btrim(p_fields ->> 'note'), '')
    ),
    v_normalized_items
  ) returning * into v_request;

  if v_role = 'staff' then
    insert into public.notifications(recipient_role, store_id, type, title, body, entity_type, entity_id, dedupe_key)
    values (
      'manager', v_report.store_id, 'arrival_correction_requested', '到货信息待审核',
      v_report.report_no || ' 由员工提交了更正申请。', 'arrival_correction', v_request.id,
      'arrival-correction-requested:' || v_request.id || ':manager'
    ) on conflict(dedupe_key) do nothing;
  end if;

  insert into public.notifications(recipient_role, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  values (
    'admin', v_report.store_id, 'arrival_correction_requested', '到货信息待审核',
    v_report.report_no || case when v_role = 'manager' then ' 由店长提交了更正申请。' else ' 由员工提交了更正申请。' end,
    'arrival_correction', v_request.id,
    'arrival-correction-requested:' || v_request.id || ':admin'
  ) on conflict(dedupe_key) do nothing;

  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values (
    v_report.store_id, auth.uid(), 'arrival_correction_requested',
    'arrival_report_correction_requests', v_request.id,
    jsonb_build_object('report_id', v_report.id, 'report_no', v_report.report_no, 'requester_role', v_role)
  );

  return to_jsonb(v_request);
end;
$$;

revoke all on function public.submit_arrival_correction_request(uuid, jsonb, jsonb) from public;
grant execute on function public.submit_arrival_correction_request(uuid, jsonb, jsonb) to authenticated;

create or replace function public.review_arrival_correction_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.arrival_report_correction_requests%rowtype;
  v_report public.arrival_reports%rowtype;
  v_role text := public.current_user_role();
  v_item jsonb;
begin
  select * into v_request
  from public.arrival_report_correction_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'arrival correction request not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'arrival correction request already reviewed' using errcode = '55000';
  end if;
  if v_role = 'admin' then
    if not public.has_store_access(v_request.store_id) then
      raise exception 'administrator store access required' using errcode = '42501';
    end if;
  elsif v_role = 'manager' then
    if v_request.requester_role <> 'staff'
      or v_request.requested_by = auth.uid()
      or not public.can_manage_store(v_request.store_id) then
      raise exception 'manager cannot review this arrival correction' using errcode = '42501';
    end if;
  else
    raise exception 'arrival correction review denied' using errcode = '42501';
  end if;

  select * into v_report
  from public.arrival_reports
  where id = v_request.report_id
  for update;

  if p_approve then
    if v_report.status not in ('submitted', 'viewed') then
      raise exception 'arrival report is no longer correctable' using errcode = '55000';
    end if;
    if v_report.version <> v_request.original_version then
      raise exception 'arrival report changed after this request; reject it and submit a new correction' using errcode = '40001';
    end if;

    delete from public.arrival_report_items where report_id = v_report.id;
    for v_item in select value from jsonb_array_elements(v_request.proposed_items)
    loop
      insert into public.arrival_report_items(
        id, report_id, product_id, product_name_snapshot, quantity, unit,
        note, is_unmatched_product, sort_order
      ) values (
        (v_item ->> 'id')::uuid,
        v_report.id,
        nullif(v_item ->> 'product_id', '')::uuid,
        v_item ->> 'product_name_snapshot',
        (v_item ->> 'quantity')::numeric,
        v_item ->> 'unit',
        nullif(v_item ->> 'note', ''),
        (v_item ->> 'is_unmatched_product')::boolean,
        (v_item ->> 'sort_order')::integer
      );
    end loop;

    update public.arrival_reports
    set arrival_date = (v_request.proposed_fields ->> 'arrival_date')::date,
        arrival_time = nullif(v_request.proposed_fields ->> 'arrival_time', '')::time,
        carrier_name = nullif(v_request.proposed_fields ->> 'carrier_name', ''),
        tracking_no = nullif(v_request.proposed_fields ->> 'tracking_no', ''),
        note = nullif(v_request.proposed_fields ->> 'note', ''),
        generated_summary = public.generate_arrival_summary(v_report.id)
    where id = v_report.id;
  end if;

  update public.arrival_report_correction_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      review_note = nullif(btrim(coalesce(p_note, '')), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = v_request.id
  returning * into v_request;

  update public.notifications
  set is_read = true, read_at = now()
  where entity_type = 'arrival_correction'
    and entity_id = v_request.id
    and not is_read;

  insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  values (
    v_request.requested_by,
    v_request.store_id,
    'arrival_correction_reviewed',
    case when p_approve then '到货更正已通过' else '到货更正未通过' end,
    case when p_approve then '更正内容已经写入到货记录。' else coalesce(nullif(btrim(coalesce(p_note, '')), ''), '请查看原到货记录后重新提交更正。') end,
    'arrival_correction',
    v_request.id,
    'arrival-correction-reviewed:' || v_request.id
  ) on conflict(dedupe_key) do nothing;

  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values (
    v_request.store_id,
    auth.uid(),
    case when p_approve then 'arrival_correction_approved' else 'arrival_correction_rejected' end,
    'arrival_report_correction_requests',
    v_request.id,
    jsonb_build_object('report_id', v_request.report_id, 'review_note', v_request.review_note)
  );

  return to_jsonb(v_request);
end;
$$;

revoke all on function public.review_arrival_correction_request(uuid, boolean, text) from public;
grant execute on function public.review_arrival_correction_request(uuid, boolean, text) to authenticated;
