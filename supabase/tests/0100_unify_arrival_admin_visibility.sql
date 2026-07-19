do $$
declare function_definition text;
begin
  select pg_get_functiondef('public.admin_operation_overview()'::regprocedure)
  into function_definition;

  if function_definition not like '%report.status IN (''submitted'', ''viewed'')%' then
    raise exception 'admin arrival total must only count submitted and viewed reports';
  end if;

  raise notice 'StoreHub arrival admin visibility checks passed';
end $$;
