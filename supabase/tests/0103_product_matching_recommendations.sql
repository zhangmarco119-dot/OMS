do $$
declare
  function_definition text;
begin
  if to_regclass('public.products_store_normalized_name_uidx') is null then
    raise exception 'normalized product-name unique index is missing';
  end if;
  if to_regclass('private.product_matching_settings') is null then
    raise exception 'product matching settings table is missing';
  end if;

  select pg_get_functiondef('public.match_recent_arrival_items_for_product(uuid)'::regprocedure)
  into function_definition;
  if function_definition not like '%report.arrival_date >=%history_match_days%'
     and function_definition not like '%report.arrival_date >=%v_days%' then
    raise exception 'recent arrival matching must use the configured history window';
  end if;
  if function_definition not like '%is_unmatched_product = false%' then
    raise exception 'recent arrival matching must clear the unmatched flag';
  end if;

  select pg_get_functiondef('public.list_recommended_product_additions(uuid)'::regprocedure)
  into function_definition;
  if function_definition not like '%recommendation_days%'
     or function_definition not like '%item.is_unmatched_product%' then
    raise exception 'recommendations must be limited to configured unmatched arrivals';
  end if;

  select pg_get_functiondef('public.admin_create_recommended_products(uuid,jsonb)'::regprocedure)
  into function_definition;
  if function_definition not like '%jsonb_array_elements%'
     or function_definition not like '%insert into public.products%' then
    raise exception 'bulk recommendation creation must insert selected JSON rows';
  end if;

  raise notice 'StoreHub product matching and recommendation checks passed';
end $$;
