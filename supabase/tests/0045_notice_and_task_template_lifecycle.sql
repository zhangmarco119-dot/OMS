do $$
begin
  if to_regprocedure('public.archive_v2_notice(uuid)') is null
    or to_regprocedure('public.retract_v2_task_template(uuid)') is null
  then
    raise exception 'notice or task template lifecycle RPC is missing';
  end if;

  if not has_function_privilege('authenticated', 'public.archive_v2_notice(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.retract_v2_task_template(uuid)', 'EXECUTE')
  then
    raise exception 'authenticated role cannot execute lifecycle RPC';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace schema on schema.oid = relation.relnamespace
    where schema.nspname = 'public'
      and relation.relname = 'v2_notices'
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) like '%archived%'
  ) then
    raise exception 'announcement archived status constraint is missing';
  end if;

  raise notice 'StoreHub notice and task template lifecycle checks passed';
end;
$$;
