do $$
declare
  policy jsonb;
  guarded_table_count integer;
begin
  if to_regclass('public.system_release_control') is null then
    raise exception 'system_release_control table is missing';
  end if;

  select public.get_system_release_policy() into policy;
  if policy ->> 'activeRelease' <> '2.4.4'
    or policy ->> 'enforcementMode' <> 'off'
    or not (policy -> 'allowedReleases') ? '2.4.4' then
    raise exception 'bootstrap release policy is invalid: %', policy;
  end if;

  select count(*) into guarded_table_count
  from pg_trigger trigger
  join pg_class relation on relation.oid = trigger.tgrelid
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and trigger.tgname = 'enforce_supported_client_release'
    and not trigger.tgisinternal;

  if guarded_table_count < 20 then
    raise exception 'release write guard coverage is unexpectedly low: %', guarded_table_count;
  end if;

  if has_function_privilege('anon', 'public.configure_system_release_policy(text,text[],integer,text,integer,text)', 'EXECUTE') then
    raise exception 'anon must not configure release policy';
  end if;

  raise notice 'StoreHub safe release control checks passed';
end $$;
