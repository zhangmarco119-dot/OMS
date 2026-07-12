do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'v2_task_templates',
    'v2_task_template_stores',
    'v2_task_template_groups',
    'v2_task_template_items',
    'v2_task_template_versions'
  ] loop
    if not exists (
      select 1 from pg_class relation
      join pg_namespace schema on schema.oid = relation.relnamespace
      where schema.nspname = 'public' and relation.relname = v_table
        and relation.relkind = 'r' and relation.relrowsecurity
    ) then
      raise exception 'missing RLS task template table public.%', v_table;
    end if;
  end loop;

  if to_regprocedure('public.save_v2_task_template(uuid,jsonb,uuid[],jsonb)') is null
    or to_regprocedure('public.publish_v2_task_template(uuid)') is null
    or to_regprocedure('public.archive_v2_task_template(uuid)') is null
  then
    raise exception 'task template RPC is missing';
  end if;

  if has_table_privilege('authenticated', 'public.v2_task_templates', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.v2_task_template_items', 'INSERT,UPDATE,DELETE')
  then
    raise exception 'authenticated role must not directly mutate task templates';
  end if;

  if not has_function_privilege(
    'authenticated', 'public.save_v2_task_template(uuid,jsonb,uuid[],jsonb)', 'EXECUTE'
  ) then
    raise exception 'authenticated role cannot execute task template save RPC';
  end if;

  raise notice 'StoreHub V2 task template schema checks passed';
end;
$$;
