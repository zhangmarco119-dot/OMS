do $$ begin
  if to_regprocedure('public.admin_operation_overview()') is null then raise exception 'admin operation overview RPC missing'; end if;
  if not has_function_privilege('authenticated', 'public.admin_operation_overview()', 'execute') then raise exception 'admin operation overview RPC must be callable by authenticated admins'; end if;
  raise notice 'StoreHub V2 admin operation overview checks passed';
end $$;
