create unique index arrival_reports_one_draft_per_reporter_idx
on public.arrival_reports (store_id, reported_by)
where status = 'draft';

create or replace function public.save_arrival_draft(
  p_report_id uuid,
  p_expected_version integer,
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
  v_item jsonb;
  v_product_id uuid;
  v_summary text;
begin
  if coalesce(jsonb_typeof(p_fields), 'null') <> 'object' then
    raise exception 'arrival draft fields must be an object' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_items), 'null') <> 'array' then
    raise exception 'arrival draft items must be an array' using errcode = '22023';
  end if;

  select * into v_report
  from public.arrival_reports
  where id = p_report_id
  for update;

  if v_report.id is null then
    raise exception 'arrival report not found' using errcode = 'P0002';
  end if;
  if not public.can_edit_arrival_report(p_report_id) then
    raise exception 'arrival draft update denied' using errcode = '42501';
  end if;
  if v_report.version <> p_expected_version then
    raise exception 'arrival report version conflict' using errcode = '40001';
  end if;

  delete from public.arrival_report_items
  where report_id = p_report_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'arrival draft item must be an object' using errcode = '22023';
    end if;

    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    insert into public.arrival_report_items (
      id,
      report_id,
      product_id,
      product_name_snapshot,
      quantity,
      unit,
      note,
      is_unmatched_product,
      sort_order
    ) values (
      (v_item ->> 'id')::uuid,
      p_report_id,
      v_product_id,
      btrim(v_item ->> 'product_name_snapshot'),
      (v_item ->> 'quantity')::numeric,
      btrim(v_item ->> 'unit'),
      nullif(btrim(v_item ->> 'note'), ''),
      v_product_id is null,
      (v_item ->> 'sort_order')::integer
    );
  end loop;

  v_summary := public.generate_arrival_summary(p_report_id);

  update public.arrival_reports
  set arrival_date = (p_fields ->> 'arrival_date')::date,
      arrival_time = nullif(p_fields ->> 'arrival_time', '')::time,
      carrier_name = nullif(btrim(p_fields ->> 'carrier_name'), ''),
      tracking_no = nullif(btrim(p_fields ->> 'tracking_no'), ''),
      note = nullif(btrim(p_fields ->> 'note'), ''),
      generated_summary = v_summary
  where id = p_report_id
  returning * into v_report;

  return to_jsonb(v_report);
end;
$$;

revoke all on function public.save_arrival_draft(uuid, integer, jsonb, jsonb) from public;
grant execute on function public.save_arrival_draft(uuid, integer, jsonb, jsonb) to authenticated;

revoke update, delete on public.arrival_reports from authenticated;
revoke insert, update, delete on public.arrival_report_items from authenticated;
