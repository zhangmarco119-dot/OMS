-- Enforce one product name per store, dynamically match recent unmatched
-- arrivals, and support administrator-reviewed bulk product recommendations.

create or replace function public.normalize_product_name(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
$$;

-- Consolidate historical duplicates before installing the normalized unique
-- index. The active, oldest row is retained and all live foreign keys follow it.
do $$
declare
  v_group record;
  v_duplicate uuid;
begin
  for v_group in
    select
      store_id,
      public.normalize_product_name(name) as normalized_name,
      (array_agg(id order by is_active desc, created_at, id))[1] as canonical_id,
      array_agg(id order by is_active desc, created_at, id) as product_ids
    from public.products
    group by store_id, public.normalize_product_name(name)
    having count(*) > 1
  loop
    foreach v_duplicate in array v_group.product_ids
    loop
      if v_duplicate = v_group.canonical_id then
        continue;
      end if;

      update public.task_items set product_id = v_group.canonical_id where product_id = v_duplicate;
      update public.product_feedback set product_id = v_group.canonical_id where product_id = v_duplicate;
      update public.arrival_report_items set product_id = v_group.canonical_id, is_unmatched_product = false where product_id = v_duplicate;
      update public.product_creation_requests set product_id = v_group.canonical_id where product_id = v_duplicate;
      delete from public.products where id = v_duplicate;
    end loop;
  end loop;

  update public.products
  set name = btrim(name), spec = btrim(spec), count_unit = btrim(count_unit)
  where name is distinct from btrim(name)
     or spec is distinct from btrim(spec)
     or count_unit is distinct from btrim(count_unit);
end $$;

create unique index products_store_normalized_name_uidx
  on public.products(store_id, public.normalize_product_name(name));

create or replace function public.validate_unique_product_name()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_existing_name text;
begin
  new.name := btrim(new.name);
  new.spec := btrim(new.spec);
  new.count_unit := btrim(new.count_unit);

  if public.normalize_product_name(new.name) = '' then
    raise exception '请填写货品名称' using errcode = '22023';
  end if;
  if new.spec = '' then
    raise exception '请填写货品规格' using errcode = '22023';
  end if;
  if new.count_unit = '' then
    raise exception '请填写货品单位' using errcode = '22023';
  end if;

  select product.name into v_existing_name
  from public.products product
  where product.store_id = new.store_id
    and product.id <> new.id
    and public.normalize_product_name(product.name) = public.normalize_product_name(new.name)
  limit 1;

  if v_existing_name is not null then
    raise exception '货品列表中已有货品“%”，不可以重复新增。', v_existing_name
      using errcode = '23505', constraint = 'products_store_normalized_name_uidx';
  end if;

  return new;
end;
$$;

create trigger products_validate_unique_name
before insert or update of store_id, name, spec, count_unit on public.products
for each row execute function public.validate_unique_product_name();

create or replace function public.validate_extra_task_item_product_name()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_name text;
  v_existing_name text;
begin
  if not new.is_extra_item or new.product_id is not null then
    return new;
  end if;
  v_name := new.product_snapshot ->> 'name';
  select product.name into v_existing_name
  from public.products product
  where product.store_id = new.store_id
    and public.normalize_product_name(product.name) = public.normalize_product_name(v_name)
  limit 1;
  if v_existing_name is not null then
    raise exception '货品列表中已有货品“%”，不可以重复新增。', v_existing_name using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger task_items_validate_extra_product_name
before insert or update of store_id, product_id, product_snapshot, is_extra_item on public.task_items
for each row execute function public.validate_extra_task_item_product_name();

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.product_matching_settings (
  singleton boolean primary key default true check (singleton),
  history_match_days smallint not null default 30 check (history_match_days between 1 and 365),
  recommendation_days smallint not null default 30 check (recommendation_days between 1 and 365),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into private.product_matching_settings(singleton)
values (true)
on conflict (singleton) do nothing;

revoke all on private.product_matching_settings from public, anon, authenticated;

create index arrival_report_items_unmatched_normalized_name_idx
  on public.arrival_report_items(public.normalize_product_name(product_name_snapshot))
  where is_unmatched_product and product_id is null;

create or replace function public.match_recent_arrival_items_for_product(p_product_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_days smallint;
  v_count integer := 0;
begin
  select * into v_product from public.products where id = p_product_id;
  if v_product.id is null or not v_product.is_active then
    return 0;
  end if;

  select history_match_days into v_days
  from private.product_matching_settings
  where singleton;

  with matched as (
    update public.arrival_report_items item
    set product_id = v_product.id,
        is_unmatched_product = false,
        product_name_snapshot = v_product.name,
        updated_at = now()
    from public.arrival_reports report
    where report.id = item.report_id
      and report.store_id = v_product.store_id
      and report.status in ('submitted', 'viewed')
      and report.arrival_date >= (timezone('Asia/Shanghai', now())::date - (coalesce(v_days, 30) - 1))
      and item.product_id is null
      and item.is_unmatched_product
      and public.normalize_product_name(item.product_name_snapshot) = public.normalize_product_name(v_product.name)
    returning item.id
  ), resolved_requests as (
    update public.product_creation_requests request
    set status = 'approved',
        product_id = v_product.id,
        reviewed_at = coalesce(request.reviewed_at, now()),
        review_note = coalesce(request.review_note, '货品新增后由系统自动匹配'),
        updated_at = now()
    where request.status = 'pending'
      and request.arrival_item_id in (select id from matched)
    returning request.id
  ), deleted_notifications as (
    delete from public.notifications notification
    where notification.entity_type = 'product_creation_request'
      and notification.entity_id in (select id from resolved_requests)
    returning notification.id
  )
  select count(*)::integer into v_count from matched;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.match_recent_arrivals_after_product_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.match_recent_arrival_items_for_product(new.id);
  return new;
end;
$$;

create trigger products_match_recent_arrivals
after insert or update of store_id, name, is_active on public.products
for each row execute function public.match_recent_arrivals_after_product_change();

create or replace function public.get_product_matching_settings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings private.product_matching_settings%rowtype;
begin
  if public.current_user_role() <> 'admin' then
    raise exception '仅管理员可以查看货品匹配设置' using errcode = '42501';
  end if;
  select * into v_settings from private.product_matching_settings where singleton;
  return jsonb_build_object(
    'historyMatchDays', coalesce(v_settings.history_match_days, 30),
    'recommendationDays', coalesce(v_settings.recommendation_days, 30),
    'updatedAt', v_settings.updated_at
  );
end;
$$;

create or replace function public.admin_save_product_matching_settings(
  p_history_match_days smallint,
  p_recommendation_days smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'admin' then
    raise exception '仅管理员可以修改货品匹配设置' using errcode = '42501';
  end if;
  if p_history_match_days not between 1 and 365 or p_recommendation_days not between 1 and 365 then
    raise exception '匹配和推荐天数必须在 1 至 365 天之间' using errcode = '22023';
  end if;

  insert into private.product_matching_settings(
    singleton, history_match_days, recommendation_days, updated_by, updated_at
  ) values (
    true, p_history_match_days, p_recommendation_days, auth.uid(), now()
  )
  on conflict (singleton) do update set
    history_match_days = excluded.history_match_days,
    recommendation_days = excluded.recommendation_days,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  return public.get_product_matching_settings();
end;
$$;

create or replace function public.list_recommended_product_additions(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days smallint;
  v_result jsonb;
begin
  if public.current_user_role() <> 'admin' or not public.has_store_access(p_store_id) then
    raise exception '没有权限查看此门店的推荐货品' using errcode = '42501';
  end if;
  select recommendation_days into v_days from private.product_matching_settings where singleton;

  with source as (
    select
      item.id as item_id,
      item.created_at,
      btrim(item.product_name_snapshot) as name,
      public.normalize_product_name(item.product_name_snapshot) as normalized_name,
      btrim(item.unit) as unit,
      item.quantity,
      report.id as report_id,
      report.arrival_date,
      request.spec as requested_spec,
      request.count_unit as requested_unit,
      request.category_code as requested_category,
      request.updated_at as request_updated_at
    from public.arrival_report_items item
    join public.arrival_reports report on report.id = item.report_id
    left join lateral (
      select creation.spec, creation.count_unit, creation.category_code, creation.updated_at
      from public.product_creation_requests creation
      where creation.arrival_item_id = item.id
      order by creation.updated_at desc
      limit 1
    ) request on true
    where report.store_id = p_store_id
      and report.status in ('submitted', 'viewed')
      and report.arrival_date >= (timezone('Asia/Shanghai', now())::date - (coalesce(v_days, 30) - 1))
      and item.product_id is null
      and item.is_unmatched_product
      and not exists (
        select 1 from public.products product
        where product.store_id = report.store_id
          and public.normalize_product_name(product.name) = public.normalize_product_name(item.product_name_snapshot)
      )
  ), grouped as (
    select
      normalized_name,
      (array_agg(name order by arrival_date desc, created_at desc))[1] as name,
      coalesce(
        (array_agg(nullif(btrim(requested_spec), '') order by request_updated_at desc nulls last)
          filter (where nullif(btrim(requested_spec), '') is not null))[1],
        ''
      ) as spec,
      coalesce(
        (array_agg(nullif(btrim(requested_unit), '') order by request_updated_at desc nulls last)
          filter (where nullif(btrim(requested_unit), '') is not null))[1],
        mode() within group (order by nullif(unit, '')),
        ''
      ) as count_unit,
      (array_agg(requested_category order by request_updated_at desc nulls last)
        filter (where requested_category is not null))[1] as category_code,
      count(*)::integer as report_item_count,
      count(distinct report_id)::integer as report_count,
      coalesce(sum(quantity), 0) as total_quantity,
      min(arrival_date) as first_arrival_date,
      max(arrival_date) as last_arrival_date,
      count(requested_spec)::integer as request_count
    from source
    group by normalized_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', normalized_name,
    'name', name,
    'spec', spec,
    'countUnit', count_unit,
    'categoryCode', coalesce(category_code, public.infer_product_category(name, spec)),
    'reportItemCount', report_item_count,
    'reportCount', report_count,
    'totalQuantity', total_quantity,
    'firstArrivalDate', first_arrival_date,
    'lastArrivalDate', last_arrival_date,
    'requestCount', request_count
  ) order by report_item_count desc, last_arrival_date desc, name), '[]'::jsonb)
  into v_result
  from grouped;

  return v_result;
end;
$$;

create or replace function public.admin_create_recommended_products(
  p_store_id uuid,
  p_products jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry jsonb;
  v_product public.products%rowtype;
  v_category text;
  v_created jsonb := '[]'::jsonb;
  v_created_count integer := 0;
  v_matched_count integer := 0;
  v_names text[] := '{}';
  v_normalized text;
begin
  if public.current_user_role() <> 'admin' or not public.has_store_access(p_store_id) then
    raise exception '没有权限批量新增此门店货品' using errcode = '42501';
  end if;
  if jsonb_typeof(p_products) <> 'array' or jsonb_array_length(p_products) < 1 or jsonb_array_length(p_products) > 100 then
    raise exception '请选择 1 至 100 个推荐货品' using errcode = '22023';
  end if;

  for v_entry in select value from jsonb_array_elements(p_products)
  loop
    v_normalized := public.normalize_product_name(v_entry ->> 'name');
    v_category := v_entry ->> 'category_code';
    if v_normalized = '' or nullif(btrim(v_entry ->> 'spec'), '') is null or nullif(btrim(v_entry ->> 'count_unit'), '') is null then
      raise exception '所选推荐货品的名称、规格和单位均为必填项' using errcode = '22023';
    end if;
    if not exists (select 1 from public.product_categories where code = v_category) then
      raise exception '请选择有效的货品分类' using errcode = '22023';
    end if;
    if v_normalized = any(v_names) then
      raise exception '勾选的推荐货品中存在重复名称“%”', btrim(v_entry ->> 'name') using errcode = '23505';
    end if;
    v_names := array_append(v_names, v_normalized);

    insert into public.products(store_id, name, spec, count_unit, category_code, sort_order, is_active)
    values(
      p_store_id,
      btrim(v_entry ->> 'name'),
      btrim(v_entry ->> 'spec'),
      btrim(v_entry ->> 'count_unit'),
      v_category,
      (select coalesce(max(sort_order), 0) + 10 from public.products where store_id = p_store_id),
      true
    )
    returning * into v_product;

    v_created_count := v_created_count + 1;
    select count(*)::integer into v_matched_count
    from public.arrival_report_items
    where product_id = v_product.id;
    v_created := v_created || jsonb_build_array(jsonb_build_object(
      'id', v_product.id,
      'name', v_product.name,
      'matchedArrivalItems', v_matched_count
    ));
  end loop;

  return jsonb_build_object(
    'createdCount', v_created_count,
    'matchedArrivalItems', coalesce((select sum((entry ->> 'matchedArrivalItems')::integer) from jsonb_array_elements(v_created) entry), 0),
    'products', v_created
  );
end;
$$;

-- Existing active products receive the same bounded backfill once at rollout.
do $$
declare
  v_product_id uuid;
begin
  for v_product_id in select id from public.products where is_active
  loop
    perform public.match_recent_arrival_items_for_product(v_product_id);
  end loop;
end $$;

-- Arrival product requests must never create a second product with the same
-- normalized name. This also protects clients with a stale product list.
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
  v_existing_name text;
begin
  select * into v_report from public.arrival_reports where id = p_report_id;
  if v_report.id is null or v_report.reported_by <> auth.uid() or v_report.status not in ('submitted', 'viewed') then
    raise exception '只能为本人已提交的到货上报申请新增货品' using errcode = '42501';
  end if;

  for v_entry in select value from jsonb_array_elements(coalesce(p_requests, '[]'::jsonb))
  loop
    select * into v_item from public.arrival_report_items
    where id = (v_entry ->> 'arrival_item_id')::uuid and report_id = v_report.id and is_unmatched_product;
    if v_item.id is null then
      raise exception '未匹配的到货明细不存在' using errcode = '22023';
    end if;

    v_spec := coalesce(v_entry ->> 'spec', v_entry ->> 'specification');
    if nullif(btrim(v_entry ->> 'name'), '') is null then raise exception '请填写货品名称' using errcode = '22023'; end if;
    if nullif(btrim(v_spec), '') is null then raise exception '请填写货品规格' using errcode = '22023'; end if;
    if nullif(btrim(v_entry ->> 'count_unit'), '') is null then raise exception '请填写货品最小单位' using errcode = '22023'; end if;
    if not exists (select 1 from public.product_categories where code = v_entry ->> 'category_code') then
      raise exception '请选择有效的货品分类' using errcode = '22023';
    end if;

    select product.name into v_existing_name
    from public.products product
    where product.store_id = v_report.store_id
      and public.normalize_product_name(product.name) = public.normalize_product_name(v_entry ->> 'name')
    limit 1;
    if v_existing_name is not null then
      raise exception '货品列表中已有货品“%”，请返回并选择已有货品。', v_existing_name using errcode = '23505';
    end if;

    insert into public.product_creation_requests(
      store_id, report_id, arrival_item_id, requested_by, name, spec, count_unit, category_code
    ) values (
      v_report.store_id, v_report.id, v_item.id, auth.uid(), btrim(v_entry ->> 'name'), btrim(v_spec),
      btrim(v_entry ->> 'count_unit'), v_entry ->> 'category_code'
    )
    on conflict (report_id, arrival_item_id) do update set
      name = excluded.name, spec = excluded.spec, count_unit = excluded.count_unit,
      category_code = excluded.category_code, status = 'pending', product_id = null,
      reviewed_by = null, reviewed_at = null, review_note = null
    returning * into v_request;

    insert into public.notifications(recipient_role, store_id, type, title, body, entity_type, entity_id, dedupe_key)
    values('admin', v_report.store_id, 'product_creation_requested', '到货货品待新增审核', v_request.name, 'product_creation_request', v_request.id, 'product-create-request:' || v_request.id || ':admin')
    on conflict (dedupe_key) do nothing;
    insert into public.notifications(recipient_role, store_id, type, title, body, entity_type, entity_id, dedupe_key)
    values('manager', v_report.store_id, 'product_creation_requested', '到货货品待新增审核', v_request.name, 'product_creation_request', v_request.id, 'product-create-request:' || v_request.id || ':manager')
    on conflict (dedupe_key) do nothing;
    return next v_request;
  end loop;
end;
$$;

revoke all on function public.normalize_product_name(text) from public, anon;
revoke all on function public.match_recent_arrival_items_for_product(uuid) from public, anon, authenticated;
revoke all on function public.get_product_matching_settings() from public, anon;
revoke all on function public.admin_save_product_matching_settings(smallint, smallint) from public, anon;
revoke all on function public.list_recommended_product_additions(uuid) from public, anon;
revoke all on function public.admin_create_recommended_products(uuid, jsonb) from public, anon;
revoke all on function public.request_arrival_product_creation(uuid, jsonb) from public, anon;
grant execute on function public.normalize_product_name(text) to authenticated;
grant execute on function public.get_product_matching_settings() to authenticated;
grant execute on function public.admin_save_product_matching_settings(smallint, smallint) to authenticated;
grant execute on function public.list_recommended_product_additions(uuid) to authenticated;
grant execute on function public.admin_create_recommended_products(uuid, jsonb) to authenticated;
grant execute on function public.request_arrival_product_creation(uuid, jsonb) to authenticated;
