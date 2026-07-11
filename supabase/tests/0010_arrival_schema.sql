do $$
declare
  v_table_name text;
  v_policy_count integer;
begin
  foreach v_table_name in array array[
    'arrival_reports',
    'arrival_report_items',
    'arrival_report_images',
    'notifications'
  ] loop
    if not exists (
      select 1
      from pg_class relation
      join pg_namespace schema on schema.oid = relation.relnamespace
      where schema.nspname = 'public'
        and relation.relname = v_table_name
        and relation.relkind = 'r'
        and relation.relrowsecurity
    ) then
      raise exception 'missing RLS table public.%', v_table_name;
    end if;
  end loop;

  select count(*)::integer into v_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'arrival_reports',
      'arrival_report_items',
      'arrival_report_images',
      'notifications'
    );

  if v_policy_count < 11 then
    raise exception 'expected at least 11 arrival RLS policies, found %', v_policy_count;
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'arrival-report-images'
      and not public
      and file_size_limit = 10485760
  ) then
    raise exception 'private arrival-report-images bucket is missing or unsafe';
  end if;

  if not exists (
    select 1 from pg_views
    where schemaname = 'public'
      and viewname = 'arrival_daily_detail_view'
  ) or not exists (
    select 1 from pg_views
    where schemaname = 'public'
      and viewname = 'arrival_daily_product_summary_view'
  ) then
    raise exception 'arrival daily views are missing';
  end if;

  raise notice 'StoreHub V2 arrival schema smoke checks passed';
end;
$$;
