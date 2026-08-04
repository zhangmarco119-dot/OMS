-- Serve the Arrival Center in one bounded query and keep its primary filters
-- indexed as the history grows.
create index if not exists arrival_reports_status_date_submitted_idx
on public.arrival_reports(status, arrival_date desc, submitted_at desc)
where status <> 'draft';

create or replace function public.list_admin_arrivals_v1(
  p_date_from date default null,
  p_date_to date default null,
  p_store_id uuid default null,
  p_status text default 'all',
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_count integer := 0;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 50);
  v_reports jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or public.current_user_role() <> 'admin' then
    raise exception '需要管理员权限' using errcode = '42501';
  end if;
  if p_status not in ('all', 'submitted', 'viewed', 'voided') then
    raise exception '不支持的到货状态';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception '开始日期不能晚于结束日期';
  end if;
  if p_store_id is not null and not public.has_store_access(p_store_id) then
    raise exception '没有该门店的访问权限' using errcode = '42501';
  end if;

  with scoped as materialized (
    select report.*
    from public.arrival_reports report
    where public.has_store_access(report.store_id)
      and (p_store_id is null or report.store_id = p_store_id)
      and (p_date_from is null or report.arrival_date >= p_date_from)
      and (p_date_to is null or report.arrival_date <= p_date_to)
      and (
        (p_status = 'all' and report.status in ('submitted', 'viewed'))
        or (p_status <> 'all' and report.status = p_status)
      )
  ), paged as (
    select report.*
    from scoped report
    order by report.submitted_at desc nulls last, report.id desc
    offset (v_page - 1) * v_page_size
    limit v_page_size
  )
  select
    (select count(*)::integer from scoped),
    coalesce(jsonb_agg(
      to_jsonb(report)
      || jsonb_build_object(
        'allProductsMatched', coalesce(item_data.all_products_matched, false),
        'itemSummary', coalesce(item_data.item_summary, '暂无货品明细'),
        'productTypeCount', coalesce(item_data.product_type_count, 0),
        'thumbnailObjectPath', thumbnail.object_path
      )
      order by report.submitted_at desc nulls last, report.id desc
    ), '[]'::jsonb)
  into v_count, v_reports
  from paged report
  left join lateral (
    with grouped as (
      select
        item.product_name_snapshot as name,
        item.unit,
        sum(item.quantity) as quantity,
        min(item.sort_order) as first_sort_order,
        min(item.created_at) as first_created_at
      from public.arrival_report_items item
      where item.report_id = report.id
      group by item.product_name_snapshot, item.unit
    )
    select
      (
        select count(*) > 0
          and bool_and(item.product_id is not null and not item.is_unmatched_product)
        from public.arrival_report_items item
        where item.report_id = report.id
      ) as all_products_matched,
      count(*)::integer as product_type_count,
      string_agg(
        grouped.name || '到货' || to_char(grouped.quantity, 'FM999999999990.###') || grouped.unit,
        '、' order by grouped.first_sort_order, grouped.first_created_at, grouped.name, grouped.unit
      ) as item_summary
    from grouped
  ) item_data on true
  left join lateral (
    select image.object_path
    from public.arrival_report_images image
    where image.report_id = report.id
    order by case when image.image_type = 'goods' then 0 else 1 end, image.created_at, image.id
    limit 1
  ) thumbnail on true;

  return jsonb_build_object('count', coalesce(v_count, 0), 'reports', v_reports);
end;
$$;

revoke all on function public.list_admin_arrivals_v1(date,date,uuid,text,integer,integer) from public,anon;
grant execute on function public.list_admin_arrivals_v1(date,date,uuid,text,integer,integer) to authenticated;

comment on function public.list_admin_arrivals_v1(date,date,uuid,text,integer,integer) is
  'Returns one authorized, paginated Arrival Center payload with item summaries and one thumbnail path per report.';
