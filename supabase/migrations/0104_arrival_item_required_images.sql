-- Associate unpacked-goods photos with one concrete arrival item. Existing
-- submitted reports may contain legacy report-level goods photos, so the new
-- constraint is intentionally NOT VALID: it protects every new upload without
-- invalidating historical records.

alter table public.arrival_report_images
add column arrival_item_id uuid;

create index arrival_report_images_item_idx
on public.arrival_report_images (arrival_item_id, created_at)
where arrival_item_id is not null;

alter table public.arrival_report_images
add constraint arrival_report_images_item_scope_check
check (
  (image_type = 'waybill' and arrival_item_id is null)
  or (image_type = 'goods' and arrival_item_id is not null)
) not valid;

create or replace function public.validate_arrival_report_image()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_store_id uuid;
  v_report_status text;
  v_item_report_id uuid;
  v_expected_prefix text;
begin
  select store_id, status into v_report_store_id, v_report_status
  from public.arrival_reports
  where id = new.report_id;

  if v_report_store_id is null or v_report_store_id <> new.store_id then
    raise exception 'arrival image store must match the report store'
      using errcode = '23514';
  end if;

  if new.image_type = 'waybill' and new.arrival_item_id is not null then
    raise exception 'waybill image cannot be linked to an arrival item'
      using errcode = '23514';
  end if;

  if new.image_type = 'goods' then
    if new.arrival_item_id is null then
      raise exception 'goods image must be linked to an arrival item'
        using errcode = '23514';
    end if;

    select report_id into v_item_report_id
    from public.arrival_report_items
    where id = new.arrival_item_id;

    -- A newly added product can receive its photo before the debounced draft
    -- save inserts the item row. The stable client-generated UUID is validated
    -- again by submit_arrival_report once all items have been saved.
    if v_item_report_id is not null and v_item_report_id <> new.report_id then
      raise exception 'goods image item must belong to the same arrival report'
        using errcode = '23514';
    end if;
    if v_item_report_id is null and v_report_status <> 'draft' then
      raise exception 'goods image item does not exist in this arrival report'
        using errcode = '23514';
    end if;
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
  v_item_count integer;
  v_items_without_image integer;
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

  select count(*)::integer into v_waybill_count
  from public.arrival_report_images
  where report_id = p_report_id
    and image_type = 'waybill';

  select count(*)::integer into v_items_without_image
  from public.arrival_report_items item
  where item.report_id = p_report_id
    and not exists (
      select 1
      from public.arrival_report_images image
      where image.report_id = p_report_id
        and image.image_type = 'goods'
        and image.arrival_item_id = item.id
    );

  if v_item_count < 1 then
    raise exception 'arrival report requires at least one item' using errcode = '23514';
  end if;
  if v_waybill_count < 1 then
    raise exception 'arrival report requires at least one waybill image' using errcode = '23514';
  end if;
  if v_items_without_image > 0 then
    raise exception 'each arrival report item requires at least one goods image'
      using errcode = '23514';
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
      'idempotency_key', v_key,
      'item_count', v_item_count
    )
  );

  return to_jsonb(v_report);
end;
$$;

revoke all on function public.validate_arrival_report_image() from public;
revoke all on function public.submit_arrival_report(uuid, integer, text) from public;
grant execute on function public.submit_arrival_report(uuid, integer, text) to authenticated;
