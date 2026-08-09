do $$
declare
  submit_definition text;
  review_definition text;
begin
  if to_regprocedure('public.reset_arrival_draft(uuid,integer)') is null then
    raise exception 'reset_arrival_draft RPC is missing';
  end if;
  if to_regprocedure('public.submit_arrival_correction_request(uuid,jsonb,jsonb)') is null then
    raise exception 'submit_arrival_correction_request RPC is missing';
  end if;
  if to_regprocedure('public.review_arrival_correction_request(uuid,boolean,text)') is null then
    raise exception 'review_arrival_correction_request RPC is missing';
  end if;
  if not has_function_privilege('authenticated', 'public.reset_arrival_draft(uuid,integer)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.submit_arrival_correction_request(uuid,jsonb,jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.review_arrival_correction_request(uuid,boolean,text)', 'EXECUTE') then
    raise exception 'authenticated role is missing an arrival correction RPC grant';
  end if;
  if has_table_privilege('authenticated', 'public.arrival_report_correction_requests', 'INSERT,UPDATE,DELETE') then
    raise exception 'authenticated users must not directly mutate arrival correction requests';
  end if;

  select pg_get_functiondef('public.submit_arrival_correction_request(uuid,jsonb,jsonb)'::regprocedure)
  into submit_definition;
  if submit_definition not like '%v_role = ''staff'' and v_report.reported_by <> auth.uid()%'
    or submit_definition not like '%v_role not in (''staff'', ''manager'')%' then
    raise exception 'arrival correction submission must preserve staff ownership and role boundaries';
  end if;

  select pg_get_functiondef('public.review_arrival_correction_request(uuid,boolean,text)'::regprocedure)
  into review_definition;
  if review_definition not like '%v_request.requester_role <> ''staff''%'
    or review_definition not like '%v_role = ''admin''%' then
    raise exception 'manager review must be limited to staff requests while administrators can review manager requests';
  end if;

  raise notice 'StoreHub arrival draft reset and correction workflow checks passed';
end;
$$;
