create sequence public.arrival_report_number_seq;

create or replace function public.generate_arrival_report_no()
returns text
language sql
security definer
set search_path = public
volatile
as $$
  select 'ARR-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' ||
    lpad(nextval('public.arrival_report_number_seq')::text, 8, '0')
$$;

create table public.arrival_reports (
  id uuid primary key default gen_random_uuid(),
  report_no text not null unique default public.generate_arrival_report_no(),
  store_id uuid not null references public.stores(id),
  reported_by uuid not null references public.profiles(id),
  store_name_snapshot text not null default '',
  reporter_name_snapshot text not null default '',
  arrival_date date not null default current_date,
  arrival_time time,
  carrier_name text,
  tracking_no text,
  generated_summary text not null default '',
  note text,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'viewed', 'voided')),
  submission_key text,
  submitted_at timestamptz,
  viewed_at timestamptz,
  viewed_by uuid references public.profiles(id),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'draft') = (submitted_at is null)),
  check ((status = 'draft') = (submission_key is null)),
  check (status <> 'viewed' or (viewed_at is not null and viewed_by is not null)),
  check (
    status <> 'voided'
    or (
      voided_at is not null
      and voided_by is not null
      and nullif(btrim(void_reason), '') is not null
    )
  ),
  check (nullif(btrim(store_name_snapshot), '') is not null),
  check (nullif(btrim(reporter_name_snapshot), '') is not null),
  check (submission_key is null or char_length(submission_key) between 8 and 128)
);

create table public.arrival_report_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.arrival_reports(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name_snapshot text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit text not null,
  note text,
  is_unmatched_product boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (nullif(btrim(product_name_snapshot), '') is not null),
  check (nullif(btrim(unit), '') is not null),
  check ((product_id is null) or not is_unmatched_product)
);

create table public.arrival_report_images (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.arrival_reports(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  image_type text not null check (image_type in ('waybill', 'goods')),
  bucket text not null default 'arrival-report-images'
    check (bucket = 'arrival-report-images'),
  object_path text not null unique,
  file_name text not null,
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (nullif(btrim(file_name), '') is not null),
  check (nullif(btrim(object_path), '') is not null)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references public.profiles(id) on delete cascade,
  recipient_role text check (recipient_role in ('staff', 'manager', 'admin')),
  store_id uuid references public.stores(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  entity_type text not null,
  entity_id uuid not null,
  dedupe_key text unique,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (recipient_user_id is not null or recipient_role is not null),
  check ((is_read and read_at is not null) or (not is_read and read_at is null)),
  check (nullif(btrim(type), '') is not null),
  check (nullif(btrim(title), '') is not null),
  check (nullif(btrim(body), '') is not null),
  check (nullif(btrim(entity_type), '') is not null)
);

create unique index arrival_reports_submission_key_idx
on public.arrival_reports (submission_key)
where submission_key is not null;

create index arrival_reports_store_date_idx
on public.arrival_reports (store_id, arrival_date desc, arrival_time desc);

create index arrival_reports_store_status_submitted_idx
on public.arrival_reports (store_id, status, submitted_at desc);

create index arrival_reports_reporter_status_updated_idx
on public.arrival_reports (reported_by, status, updated_at desc);

create index arrival_report_items_report_sort_idx
on public.arrival_report_items (report_id, sort_order, created_at);

create index arrival_report_items_product_idx
on public.arrival_report_items (product_id)
where product_id is not null;

create index arrival_report_images_report_type_idx
on public.arrival_report_images (report_id, image_type, created_at);

create index arrival_report_images_store_idx
on public.arrival_report_images (store_id, created_at desc);

create index notifications_user_unread_idx
on public.notifications (recipient_user_id, is_read, created_at desc)
where recipient_user_id is not null;

create index notifications_role_store_unread_idx
on public.notifications (recipient_role, store_id, is_read, created_at desc)
where recipient_role is not null;

create or replace function public.set_arrival_report_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_name text;
  v_reporter_name text;
begin
  select store.name, profile.display_name
  into v_store_name, v_reporter_name
  from public.stores store
  join public.profiles profile on profile.id = new.reported_by
  where store.id = new.store_id
    and store.is_active = true
    and profile.store_id = new.store_id
    and profile.is_active = true
    and profile.deleted_at is null
    and profile.role in ('staff', 'manager');

  if v_store_name is null or v_reporter_name is null then
    raise exception 'active staff or manager must report for the current store'
      using errcode = '42501';
  end if;

  new.store_name_snapshot := v_store_name;
  new.reporter_name_snapshot := v_reporter_name;
  return new;
end;
$$;

create trigger arrival_reports_set_snapshots
before insert or update of store_id, reported_by
on public.arrival_reports
for each row execute function public.set_arrival_report_snapshots();

create or replace function public.touch_arrival_report()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger arrival_reports_touch_updated_at
before update on public.arrival_reports
for each row execute function public.touch_arrival_report();

create trigger arrival_report_items_touch_updated_at
before update on public.arrival_report_items
for each row execute function public.touch_updated_at();

create or replace function public.validate_arrival_report_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_store_id uuid;
  v_product_store_id uuid;
begin
  select store_id into v_report_store_id
  from public.arrival_reports
  where id = new.report_id;

  if v_report_store_id is null then
    raise exception 'arrival report not found' using errcode = '23503';
  end if;

  if new.product_id is not null then
    select store_id into v_product_store_id
    from public.products
    where id = new.product_id;

    if v_product_store_id is null or v_product_store_id <> v_report_store_id then
      raise exception 'arrival item product must belong to the report store'
        using errcode = '23514';
    end if;
  end if;

  new.product_name_snapshot := btrim(new.product_name_snapshot);
  new.unit := btrim(new.unit);
  return new;
end;
$$;

create trigger arrival_report_items_validate
before insert or update on public.arrival_report_items
for each row execute function public.validate_arrival_report_item();

create or replace function public.validate_arrival_report_image()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_store_id uuid;
  v_expected_prefix text;
begin
  select store_id into v_report_store_id
  from public.arrival_reports
  where id = new.report_id;

  if v_report_store_id is null or v_report_store_id <> new.store_id then
    raise exception 'arrival image store must match the report store'
      using errcode = '23514';
  end if;

  v_expected_prefix := new.store_id::text || '/' || new.report_id::text || '/' ||
    new.image_type || '/';

  if new.object_path not like v_expected_prefix || '%' then
    raise exception 'arrival image object path does not match its report'
      using errcode = '23514';
  end if;

  if new.object_path !~* '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$' then
    raise exception 'arrival image object path must use a unique image filename'
      using errcode = '23514';
  end if;

  new.file_name := btrim(new.file_name);
  return new;
end;
$$;

create trigger arrival_report_images_validate
before insert or update on public.arrival_report_images
for each row execute function public.validate_arrival_report_image();

create or replace function public.can_operate_arrival_modules(target_store_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() in ('staff', 'manager')
    and public.current_user_store_id() = target_store_id
    and public.has_store_access(target_store_id)
$$;

create or replace function public.can_read_arrival_report(target_report_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.arrival_reports report
    join public.profiles profile on profile.id = auth.uid()
    where report.id = target_report_id
      and profile.is_active = true
      and profile.deleted_at is null
      and public.has_store_access(report.store_id)
      and (
        profile.role = 'admin'
        or (
          profile.role in ('staff', 'manager')
          and report.store_id = public.current_user_store_id()
          and (report.status <> 'draft' or report.reported_by = auth.uid())
        )
      )
  )
$$;

create or replace function public.can_edit_arrival_report(target_report_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.arrival_reports report
    where report.id = target_report_id
      and report.status = 'draft'
      and report.reported_by = auth.uid()
      and public.can_operate_arrival_modules(report.store_id)
  )
$$;

alter table public.arrival_reports enable row level security;
alter table public.arrival_report_items enable row level security;
alter table public.arrival_report_images enable row level security;
alter table public.notifications enable row level security;

create policy arrival_reports_select_allowed
on public.arrival_reports for select
to authenticated
using (public.can_read_arrival_report(id));

create policy arrival_reports_insert_own_draft
on public.arrival_reports for insert
to authenticated
with check (
  status = 'draft'
  and reported_by = auth.uid()
  and public.can_operate_arrival_modules(store_id)
);

create policy arrival_reports_update_own_draft
on public.arrival_reports for update
to authenticated
using (public.can_edit_arrival_report(id))
with check (
  status = 'draft'
  and reported_by = auth.uid()
  and public.can_operate_arrival_modules(store_id)
);

create policy arrival_reports_delete_own_draft
on public.arrival_reports for delete
to authenticated
using (public.can_edit_arrival_report(id));

create policy arrival_report_items_select_allowed
on public.arrival_report_items for select
to authenticated
using (public.can_read_arrival_report(report_id));

create policy arrival_report_items_insert_own_draft
on public.arrival_report_items for insert
to authenticated
with check (public.can_edit_arrival_report(report_id));

create policy arrival_report_items_update_own_draft
on public.arrival_report_items for update
to authenticated
using (public.can_edit_arrival_report(report_id))
with check (public.can_edit_arrival_report(report_id));

create policy arrival_report_items_delete_own_draft
on public.arrival_report_items for delete
to authenticated
using (public.can_edit_arrival_report(report_id));

create policy arrival_report_images_select_allowed
on public.arrival_report_images for select
to authenticated
using (public.can_read_arrival_report(report_id));

create policy arrival_report_images_insert_own_draft
on public.arrival_report_images for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and public.can_edit_arrival_report(report_id)
);

create policy arrival_report_images_delete_own_draft
on public.arrival_report_images for delete
to authenticated
using (
  uploaded_by = auth.uid()
  and public.can_edit_arrival_report(report_id)
);

create policy notifications_select_recipient
on public.notifications for select
to authenticated
using (
  recipient_user_id = auth.uid()
  or (
    recipient_role = public.current_user_role()
    and (store_id is null or public.has_store_access(store_id))
  )
);

create or replace function public.generate_arrival_summary(target_report_id uuid)
returns text
language plpgsql
set search_path = public
stable
as $$
declare
  v_count integer;
  v_summary text;
begin
  select count(*)::integer,
    case
      when count(*) = 1 then
        max(item.product_name_snapshot) || '到货 ' ||
        max(to_char(item.quantity, 'FM999999999990.###')) || ' ' ||
        max(item.unit) || '。'
      when count(*) > 1 then
        '本次到货：' || string_agg(
          item.product_name_snapshot || ' ' ||
          to_char(item.quantity, 'FM999999999990.###') || ' ' || item.unit,
          '，' order by item.sort_order, item.created_at, item.id
        ) || '。'
      else ''
    end
  into v_count, v_summary
  from public.arrival_report_items item
  where item.report_id = target_report_id;

  if v_count = 0 then
    return '';
  end if;

  return v_summary;
end;
$$;

create or replace function public.submit_arrival_report(
  p_report_id uuid,
  p_expected_version integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.arrival_reports%rowtype;
  v_summary text;
  v_waybill_count integer;
  v_goods_count integer;
  v_item_count integer;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
begin
  if char_length(v_key) < 8 or char_length(v_key) > 128 then
    raise exception 'invalid arrival submission idempotency key'
      using errcode = '22023';
  end if;

  select * into v_report
  from public.arrival_reports
  where id = p_report_id
  for update;

  if v_report.id is null then
    raise exception 'arrival report not found' using errcode = 'P0002';
  end if;

  if v_report.reported_by <> auth.uid()
    or not public.can_operate_arrival_modules(v_report.store_id) then
    raise exception 'arrival report submission denied' using errcode = '42501';
  end if;

  if v_report.status <> 'draft' then
    if v_report.submission_key = v_key then
      return to_jsonb(v_report);
    end if;
    raise exception 'arrival report has already been submitted'
      using errcode = '55000';
  end if;

  if not public.can_edit_arrival_report(p_report_id) then
    raise exception 'arrival report submission denied' using errcode = '42501';
  end if;

  if v_report.version <> p_expected_version then
    raise exception 'arrival report version conflict' using errcode = '40001';
  end if;

  select count(*)::integer into v_item_count
  from public.arrival_report_items
  where report_id = p_report_id;

  select
    count(*) filter (where image_type = 'waybill')::integer,
    count(*) filter (where image_type = 'goods')::integer
  into v_waybill_count, v_goods_count
  from public.arrival_report_images
  where report_id = p_report_id;

  if v_item_count < 1 then
    raise exception 'arrival report requires at least one item' using errcode = '23514';
  end if;
  if v_waybill_count < 1 then
    raise exception 'arrival report requires at least one waybill image' using errcode = '23514';
  end if;
  if v_goods_count < 1 then
    raise exception 'arrival report requires at least one goods image' using errcode = '23514';
  end if;

  v_summary := public.generate_arrival_summary(p_report_id);

  update public.arrival_reports
  set status = 'submitted',
      submission_key = v_key,
      generated_summary = v_summary,
      submitted_at = now()
  where id = p_report_id
  returning * into v_report;

  insert into public.notifications (
    recipient_role,
    store_id,
    type,
    title,
    body,
    entity_type,
    entity_id,
    dedupe_key
  ) values (
    'admin',
    v_report.store_id,
    'arrival_submitted',
    v_report.store_name_snapshot || '提交到货上报',
    v_report.generated_summary,
    'arrival_report',
    v_report.id,
    'arrival-submitted:' || v_report.id::text
  ) on conflict (dedupe_key) do nothing;

  insert into public.audit_logs (
    store_id,
    actor_id,
    action,
    entity_table,
    entity_id,
    metadata
  ) values (
    v_report.store_id,
    auth.uid(),
    'arrival_report_submitted',
    'arrival_reports',
    v_report.id,
    jsonb_build_object(
      'report_no', v_report.report_no,
      'version', v_report.version,
      'idempotency_key', v_key
    )
  );

  return to_jsonb(v_report);
end;
$$;

create or replace function public.mark_arrival_viewed(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.arrival_reports%rowtype;
begin
  select * into v_report
  from public.arrival_reports
  where id = p_report_id
  for update;

  if v_report.id is null then
    raise exception 'arrival report not found' using errcode = 'P0002';
  end if;
  if public.current_user_role() <> 'admin'
    or not public.has_store_access(v_report.store_id) then
    raise exception 'administrator store access required' using errcode = '42501';
  end if;
  if v_report.status = 'viewed' then
    return to_jsonb(v_report);
  end if;
  if v_report.status <> 'submitted' then
    raise exception 'only submitted arrivals can be marked viewed' using errcode = '55000';
  end if;

  update public.arrival_reports
  set status = 'viewed',
      viewed_at = now(),
      viewed_by = auth.uid()
  where id = p_report_id
  returning * into v_report;

  update public.notifications
  set is_read = true,
      read_at = now()
  where entity_type = 'arrival_report'
    and entity_id = p_report_id
    and recipient_role = 'admin'
    and not is_read;

  insert into public.audit_logs (
    store_id, actor_id, action, entity_table, entity_id, metadata
  ) values (
    v_report.store_id,
    auth.uid(),
    'arrival_report_viewed',
    'arrival_reports',
    v_report.id,
    jsonb_build_object('report_no', v_report.report_no)
  );

  return to_jsonb(v_report);
end;
$$;

create or replace function public.void_arrival_report(
  p_report_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.arrival_reports%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_reason = '' then
    raise exception 'void reason is required' using errcode = '22023';
  end if;

  select * into v_report
  from public.arrival_reports
  where id = p_report_id
  for update;

  if v_report.id is null then
    raise exception 'arrival report not found' using errcode = 'P0002';
  end if;
  if public.current_user_role() <> 'admin'
    or not public.has_store_access(v_report.store_id) then
    raise exception 'administrator store access required' using errcode = '42501';
  end if;
  if v_report.status = 'voided' then
    return to_jsonb(v_report);
  end if;
  if v_report.status not in ('submitted', 'viewed') then
    raise exception 'only submitted arrivals can be voided' using errcode = '55000';
  end if;

  update public.arrival_reports
  set status = 'voided',
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = v_reason
  where id = p_report_id
  returning * into v_report;

  insert into public.audit_logs (
    store_id, actor_id, action, entity_table, entity_id, metadata
  ) values (
    v_report.store_id,
    auth.uid(),
    'arrival_report_voided',
    'arrival_reports',
    v_report.id,
    jsonb_build_object('report_no', v_report.report_no, 'reason', v_reason)
  );

  return to_jsonb(v_report);
end;
$$;

create view public.arrival_daily_detail_view
with (security_invoker = true)
as
select
  report.id as report_id,
  report.report_no,
  report.store_id,
  report.store_name_snapshot,
  report.reported_by,
  report.reporter_name_snapshot,
  report.arrival_date,
  report.arrival_time,
  report.status,
  report.submitted_at,
  item.id as item_id,
  item.product_id,
  item.product_name_snapshot,
  item.quantity,
  item.unit,
  item.is_unmatched_product,
  item.sort_order
from public.arrival_reports report
join public.arrival_report_items item on item.report_id = report.id
where report.status in ('submitted', 'viewed');

create view public.arrival_daily_product_summary_view
with (security_invoker = true)
as
select
  report.arrival_date,
  report.store_id,
  report.store_name_snapshot,
  item.product_name_snapshot,
  item.unit,
  sum(item.quantity) as total_quantity,
  count(distinct report.id)::bigint as report_count
from public.arrival_reports report
join public.arrival_report_items item on item.report_id = report.id
where report.status in ('submitted', 'viewed')
group by
  report.arrival_date,
  report.store_id,
  report.store_name_snapshot,
  item.product_name_snapshot,
  item.unit;

create or replace function public.can_read_arrival_image_object(p_object_name text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_parts text[] := string_to_array(p_object_name, '/');
  v_store_id uuid;
  v_report_id uuid;
begin
  if array_length(v_parts, 1) <> 4
    or v_parts[3] not in ('waybill', 'goods')
    or v_parts[4] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$' then
    return false;
  end if;

  begin
    v_store_id := v_parts[1]::uuid;
    v_report_id := v_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return exists (
    select 1
    from public.arrival_reports report
    join public.arrival_report_images image
      on image.report_id = report.id
      and image.object_path = p_object_name
    where report.id = v_report_id
      and report.store_id = v_store_id
      and public.can_read_arrival_report(report.id)
  );
end;
$$;

create or replace function public.can_write_arrival_image_object(p_object_name text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_parts text[] := string_to_array(p_object_name, '/');
  v_store_id uuid;
  v_report_id uuid;
begin
  if array_length(v_parts, 1) <> 4
    or v_parts[3] not in ('waybill', 'goods')
    or v_parts[4] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$' then
    return false;
  end if;

  begin
    v_store_id := v_parts[1]::uuid;
    v_report_id := v_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return exists (
    select 1
    from public.arrival_reports report
    where report.id = v_report_id
      and report.store_id = v_store_id
      and public.can_edit_arrival_report(report.id)
  );
end;
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'arrival-report-images',
  'arrival-report-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy arrival_images_storage_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'arrival-report-images'
  and public.can_read_arrival_image_object(name)
);

create policy arrival_images_storage_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'arrival-report-images'
  and public.can_write_arrival_image_object(name)
);

create policy arrival_images_storage_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'arrival-report-images'
  and public.can_write_arrival_image_object(name)
);

revoke all on function public.generate_arrival_report_no() from public;
revoke all on function public.set_arrival_report_snapshots() from public;
revoke all on function public.validate_arrival_report_item() from public;
revoke all on function public.validate_arrival_report_image() from public;
revoke all on function public.can_operate_arrival_modules(uuid) from public;
revoke all on function public.can_read_arrival_report(uuid) from public;
revoke all on function public.can_edit_arrival_report(uuid) from public;
revoke all on function public.generate_arrival_summary(uuid) from public;
revoke all on function public.submit_arrival_report(uuid, integer, text) from public;
revoke all on function public.mark_arrival_viewed(uuid) from public;
revoke all on function public.void_arrival_report(uuid, text) from public;
revoke all on function public.can_read_arrival_image_object(text) from public;
revoke all on function public.can_write_arrival_image_object(text) from public;

grant execute on function public.generate_arrival_report_no() to authenticated;
grant execute on function public.can_operate_arrival_modules(uuid) to authenticated;
grant execute on function public.can_read_arrival_report(uuid) to authenticated;
grant execute on function public.can_edit_arrival_report(uuid) to authenticated;
grant execute on function public.generate_arrival_summary(uuid) to authenticated;
grant execute on function public.submit_arrival_report(uuid, integer, text) to authenticated;
grant execute on function public.mark_arrival_viewed(uuid) to authenticated;
grant execute on function public.void_arrival_report(uuid, text) to authenticated;
grant execute on function public.can_read_arrival_image_object(text) to authenticated;
grant execute on function public.can_write_arrival_image_object(text) to authenticated;

grant select, insert, update, delete on public.arrival_reports to authenticated;
grant select, insert, update, delete on public.arrival_report_items to authenticated;
grant select, insert, delete on public.arrival_report_images to authenticated;
grant select on public.notifications to authenticated;
grant select on public.arrival_daily_detail_view to authenticated;
grant select on public.arrival_daily_product_summary_view to authenticated;
