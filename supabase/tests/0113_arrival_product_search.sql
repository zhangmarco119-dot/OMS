do $$
declare
  admin_id uuid;
  function_definition text;
  payload jsonb;
begin
  select pg_get_functiondef('public.list_admin_arrivals_v2(date,date,uuid,text,text,integer,integer)'::regprocedure)
  into function_definition;
  if function_definition not like '%current_user_role() <> ''admin''%' then
    raise exception 'Arrival Center product search RPC must require administrator access';
  end if;
  if function_definition not like '%position(v_product_search in lower(searched_item.product_name_snapshot)) > 0%' then
    raise exception 'Arrival Center product search RPC must filter by product name';
  end if;

  select profile.id into admin_id
  from public.profiles profile
  where profile.role = 'admin' and profile.is_active and profile.deleted_at is null
  order by profile.created_at
  limit 1;
  if admin_id is null then
    raise exception 'Arrival Center product search test requires an active administrator';
  end if;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  payload := public.list_admin_arrivals_v2(current_date, current_date, null, 'all', '__no_matching_product__', 1, 20);
  if payload->>'count' <> '0' or jsonb_array_length(payload->'reports') <> 0 then
    raise exception 'Arrival Center product search did not exclude nonmatching reports';
  end if;

  raise notice 'StoreHub Arrival Center product search checks passed';
end $$;
