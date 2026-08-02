-- Submit an arrival report and create all unmatched-product review requests in
-- one database transaction. This prevents a submitted report from being left
-- without its associated review requests when request validation fails.

create or replace function public.request_arrival_product_creation(
  p_report_id uuid,
  p_requests jsonb
)
returns setof public.product_creation_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.arrival_reports%rowtype;
  v_entry jsonb;
  v_item public.arrival_report_items%rowtype;
  v_request public.product_creation_requests%rowtype;
  v_spec text;
begin
  select * into v_report
  from public.arrival_reports
  where id = p_report_id;

  if v_report.id is null
    or v_report.reported_by <> auth.uid()
    or v_report.status not in ('submitted', 'viewed') then
    raise exception '只能为本人已提交的到货上报申请新增货品'
      using errcode = '42501';
  end if;

  for v_entry in
    select value from jsonb_array_elements(coalesce(p_requests, '[]'::jsonb))
  loop
    select * into v_item
    from public.arrival_report_items
    where id = (v_entry ->> 'arrival_item_id')::uuid
      and report_id = v_report.id
      and is_unmatched_product;

    if v_item.id is null then
      raise exception '未匹配的到货明细不存在'
        using errcode = '22023';
    end if;

    -- Accept the original SQL key and the frontend model key so old and new
    -- clients can retry safely during a rolling deployment.
    v_spec := coalesce(v_entry ->> 'spec', v_entry ->> 'specification');
    if nullif(btrim(v_entry ->> 'name'), '') is null then
      raise exception '请填写货品名称' using errcode = '22023';
    end if;
    if nullif(btrim(v_spec), '') is null then
      raise exception '请填写货品规格' using errcode = '22023';
    end if;
    if nullif(btrim(v_entry ->> 'count_unit'), '') is null then
      raise exception '请填写货品最小单位' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.product_categories
      where code = v_entry ->> 'category_code'
    ) then
      raise exception '请选择有效的货品分类' using errcode = '22023';
    end if;

    insert into public.product_creation_requests (
      store_id,
      report_id,
      arrival_item_id,
      requested_by,
      name,
      spec,
      count_unit,
      category_code
    ) values (
      v_report.store_id,
      v_report.id,
      v_item.id,
      auth.uid(),
      btrim(v_entry ->> 'name'),
      btrim(v_spec),
      btrim(v_entry ->> 'count_unit'),
      v_entry ->> 'category_code'
    )
    on conflict (report_id, arrival_item_id) do update
      set updated_at = public.product_creation_requests.updated_at
    returning * into v_request;

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
      'product_creation_requested',
      '到货货品待新增审核',
      v_request.name,
      'product_creation_request',
      v_request.id,
      'product-create-request:' || v_request.id || ':admin'
    ) on conflict (dedupe_key) do nothing;

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
      'manager',
      v_report.store_id,
      'product_creation_requested',
      '到货货品待新增审核',
      v_request.name,
      'product_creation_request',
      v_request.id,
      'product-create-request:' || v_request.id || ':manager'
    ) on conflict (dedupe_key) do nothing;

    return next v_request;
  end loop;
end;
$$;

create or replace function public.submit_arrival_report_with_product_requests(
  p_report_id uuid,
  p_expected_version integer,
  p_idempotency_key text,
  p_requests jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report jsonb;
begin
  v_report := public.submit_arrival_report(
    p_report_id,
    p_expected_version,
    p_idempotency_key
  );

  if jsonb_array_length(coalesce(p_requests, '[]'::jsonb)) > 0 then
    perform *
    from public.request_arrival_product_creation(p_report_id, p_requests);
  end if;

  return v_report;
end;
$$;

revoke all on function public.request_arrival_product_creation(uuid, jsonb) from public, anon;
revoke all on function public.submit_arrival_report_with_product_requests(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.request_arrival_product_creation(uuid, jsonb) to authenticated;
grant execute on function public.submit_arrival_report_with_product_requests(uuid, integer, text, jsonb) to authenticated;
