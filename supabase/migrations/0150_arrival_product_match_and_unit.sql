-- Enforce that every unmatched arrival item requests a new product before
-- submission, and that matched items use the product library's counting unit.
-- The employee arrival page is the primary caller of this wrapper.

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
  v_missing integer;
  v_unit_mismatch integer;
begin
  select count(*) into v_missing
  from public.arrival_report_items item
  where item.report_id = p_report_id
    and item.is_unmatched_product
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_requests, '[]'::jsonb)) entry
      where (entry ->> 'arrival_item_id')::uuid = item.id
    );

  if v_missing > 0 then
    raise exception '存在未匹配货品尚未申请新增，请先填写并申请新增后再提交'
      using errcode = '23514';
  end if;

  select count(*) into v_unit_mismatch
  from public.arrival_report_items item
  join public.products product on product.id = item.product_id
  where item.report_id = p_report_id
    and not item.is_unmatched_product
    and item.product_id is not null
    and nullif(btrim(item.unit), '') is distinct from product.count_unit;

  if v_unit_mismatch > 0 then
    raise exception '已匹配货品必须使用货品库中的计量单位'
      using errcode = '23514';
  end if;

  v_report := public.submit_arrival_report(
    p_report_id,
    p_expected_version,
    p_idempotency_key
  );

  if jsonb_array_length(coalesce(p_requests, '[]'::jsonb)) > 0 then
    perform * from public.request_arrival_product_creation(p_report_id, p_requests);
  end if;

  return v_report;
end;
$$;

revoke all on function public.submit_arrival_report_with_product_requests(uuid, integer, text, jsonb)
from public, anon;
grant execute on function public.submit_arrival_report_with_product_requests(uuid, integer, text, jsonb)
to authenticated;
