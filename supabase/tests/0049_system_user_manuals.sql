do $$
begin
  if to_regclass('public.v2_system_documents') is null then
    raise exception 'system user manuals table missing';
  end if;

  if not exists (
    select 1 from pg_class relation
    join pg_namespace schema on schema.oid = relation.relnamespace
    where schema.nspname = 'public'
      and relation.relname = 'v2_system_documents'
      and relation.relrowsecurity
  ) then
    raise exception 'system user manuals RLS is not enabled';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'v2_system_documents'
      and policyname = 'v2_system_documents_select_admin'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'v2_system_documents'
      and policyname = 'v2_system_documents_update_admin'
  ) then
    raise exception 'system user manuals admin policies missing';
  end if;

  if has_table_privilege('anon', 'public.v2_system_documents', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'anonymous role must not access system user manuals';
  end if;

  if has_table_privilege('authenticated', 'public.v2_system_documents', 'DELETE') then
    raise exception 'system user manuals must not be deleted by the application';
  end if;

  if (select count(*) from public.v2_system_documents where slug in ('staff-manager-guide', 'admin-guide')) <> 2 then
    raise exception 'initial system user manual metadata missing';
  end if;

  raise notice 'StoreHub system user manual schema checks passed';
end;
$$;
