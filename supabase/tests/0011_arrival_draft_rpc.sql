do $$
begin
  if to_regprocedure('public.save_arrival_draft(uuid,integer,jsonb,jsonb)') is null then
    raise exception 'save_arrival_draft RPC is missing';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.save_arrival_draft(uuid,integer,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'authenticated role cannot execute save_arrival_draft';
  end if;

  if has_table_privilege('authenticated', 'public.arrival_reports', 'UPDATE') then
    raise exception 'authenticated role must not directly update arrival reports';
  end if;

  if has_table_privilege('authenticated', 'public.arrival_report_items', 'INSERT,UPDATE,DELETE') then
    raise exception 'authenticated role must not directly mutate arrival items';
  end if;

  raise notice 'StoreHub V2 atomic arrival draft checks passed';
end;
$$;
