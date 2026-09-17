do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks'
      and column_name = 'inventory_recount_only'
  ) then
    raise exception 'focused inventory recount marker missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'v2_tasks'
      and column_name = 'inventory_correction_task_id'
  ) then
    raise exception 'linked inventory correction task pointer missing';
  end if;
  if to_regprocedure('public.review_v2_task_items_with_inventory(uuid,jsonb,text,uuid,uuid[])') is null then
    raise exception 'linked inventory item review RPC missing';
  end if;
  if has_function_privilege('anon', 'public.review_v2_task_items_with_inventory(uuid,jsonb,text,uuid,uuid[])', 'EXECUTE') then
    raise exception 'anonymous users must not review linked inventory items';
  end if;
  raise notice 'StoreHub linked inventory partial recount schema checks passed';
end;
$$;
