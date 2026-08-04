do $$
declare
  admin_id uuid;
  function_definition text;
  payload jsonb;
begin
  if to_regclass('public.arrival_reports_status_date_submitted_idx') is null then
    raise exception 'Arrival Center status/date index is missing';
  end if;

  select pg_get_functiondef('public.list_admin_arrivals_v1(date,date,uuid,text,integer,integer)'::regprocedure)
  into function_definition;
  if function_definition not like '%current_user_role() <> ''admin''%' then
    raise exception 'Arrival Center list RPC must require administrator access';
  end if;
  if function_definition not like '%jsonb_build_object(%thumbnailObjectPath%' then
    raise exception 'Arrival Center list RPC must return one thumbnail path';
  end if;
  if function_definition not like '%allProductsMatched%' or function_definition not like '%itemSummary%' then
    raise exception 'Arrival Center list RPC must aggregate item presentation data';
  end if;

  select profile.id into admin_id
  from public.profiles profile
  where profile.role = 'admin' and profile.is_active and profile.deleted_at is null
  order by profile.created_at
  limit 1;
  if admin_id is null then
    raise exception 'Arrival Center list RPC test requires an active administrator';
  end if;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  payload := public.list_admin_arrivals_v1(current_date, current_date, null, 'all', 1, 20);
  if jsonb_typeof(payload->'reports') <> 'array' or jsonb_typeof(payload->'count') <> 'number' then
    raise exception 'Arrival Center list RPC returned an invalid payload';
  end if;

  raise notice 'StoreHub fast Arrival Center list checks passed';
end $$;
