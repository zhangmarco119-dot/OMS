do $$
declare
  v_policy_qual text;
begin
  select qual into v_policy_qual
  from pg_policies
  where schemaname = 'public'
    and tablename = 'arrival_reports'
    and policyname = 'arrival_reports_select_allowed';

  if v_policy_qual is null then
    raise exception 'arrival report select policy is missing';
  end if;

  if v_policy_qual like '%can_read_arrival_report(id)%' then
    raise exception 'arrival report select policy still performs a self-lookup';
  end if;

  if v_policy_qual not like '%has_store_access(store_id)%'
    or v_policy_qual not like '%current_user_store_id()%'
    or v_policy_qual not like '%reported_by = auth.uid()%'
  then
    raise exception 'arrival report row-based select policy is incomplete';
  end if;

  raise notice 'StoreHub V2 arrival INSERT RETURNING RLS checks passed';
end;
$$;
