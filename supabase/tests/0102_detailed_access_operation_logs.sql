do $$
declare function_definition text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='system_operation_logs' and column_name='actor_username_snapshot'
  ) then raise exception 'operation log username snapshot is missing'; end if;

  select pg_get_functiondef('public.record_system_activity(text,text,text,uuid,uuid,jsonb)'::regprocedure)
  into function_definition;
  if function_definition not like '%interval ''30 seconds''%'
    or function_definition not like '%loginMethod%'
    or function_definition not like '%targetDisplayName%'
    or function_definition like '%password%' then
    raise exception 'detailed activity logging is incomplete or unsafe';
  end if;

  if has_function_privilege('anon','public.record_system_activity(text,text,text,uuid,uuid,jsonb)','EXECUTE') then
    raise exception 'anonymous users must not write activity logs';
  end if;
  if not has_function_privilege('authenticated','public.list_system_operation_log_actors()','EXECUTE') then
    raise exception 'authenticated administrators need actor filter access';
  end if;
  raise notice 'StoreHub detailed access operation log checks passed';
end $$;
