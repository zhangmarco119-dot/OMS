-- A missing/pending value is not zero, and zero net pay after deductions is
-- still a meaningful statement when there was income or a deduction.
create function private.payroll_snapshot_is_zero(p_snapshot jsonb)
returns boolean language sql immutable set search_path=public as $$
 select coalesce((p_snapshot->>'dataComplete')::boolean,false)
   and (p_snapshot->>'incomeSubtotalKnown')::numeric=0
   and (p_snapshot->>'knownEstimatedPayable')::numeric=0
   and (p_snapshot->>'estimatedPayable')::numeric=0
   and coalesce((p_snapshot->>'fineTotal')::numeric,0)=0
   and coalesce((p_snapshot->>'individualIncomeTax')::numeric,0)=0;
$$;
revoke all on function private.payroll_snapshot_is_zero(jsonb) from public,anon,authenticated;
-- The legacy generators execute as postgres; API roles still have no access.
grant execute on function private.payroll_snapshot_is_zero(jsonb) to postgres;

-- Patch both existing generation paths without changing their access checks,
-- tax registration, issued-statement protections or notification contracts.
do $migration$
declare v_name text; v_sql text; v_filter text; v_count integer:=0;
begin
 foreach v_name in array array['admin_generate_payroll_payslips','issue_payroll_payslips_internal'] loop
  select pg_get_functiondef(p.oid) into strict v_sql from pg_proc p
  where p.pronamespace='public'::regnamespace and p.proname=v_name;
  if position('v_missing_tax integer := 0;' in v_sql)=0
   or position('if v_tax is null then v_missing_tax := v_missing_tax + 1; end if;' in v_sql)=0
   or position('v_snapshot := public.payroll_snapshot_with_registered_tax(v_snapshot, coalesce(v_tax, 0), v_tax is not null);' in v_sql)=0 then
   raise exception 'Payroll generation contract changed: %',v_name;
  end if;
  v_sql:=replace(v_sql,'v_missing_tax integer := 0;','v_missing_tax integer := 0; v_zero integer := 0;');
  v_sql:=replace(v_sql,'if v_tax is null then v_missing_tax := v_missing_tax + 1; end if;','');
  v_filter:='v_snapshot := public.payroll_snapshot_with_registered_tax(v_snapshot, coalesce(v_tax, 0), v_tax is not null);
    if private.payroll_snapshot_is_zero(v_snapshot) then
      v_zero := v_zero + 1;
      -- A regenerated draft must not retain an obsolete positive amount.
      -- Keep its history, but exclude it from preview/send and batch send.
      if v_existing.id is not null and v_existing.status = ''draft'' then
        update public.payroll_payslips set status=''withdrawn'',withdrawn_at=now(),withdrawn_by=';
  v_filter:=v_filter||case when v_name='admin_generate_payroll_payslips' then 'auth.uid()' else 'p_issued_by' end||',
          last_modified_by='||case when v_name='admin_generate_payroll_payslips' then 'auth.uid()' else 'p_issued_by' end||',revision=revision+1 where id=v_existing.id;
      end if;
      continue;
    end if;
    if v_tax is null then v_missing_tax := v_missing_tax + 1; end if;';
  v_sql:=replace(v_sql,'v_snapshot := public.payroll_snapshot_with_registered_tax(v_snapshot, coalesce(v_tax, 0), v_tax is not null);',v_filter);
  if v_name='admin_generate_payroll_payslips' then
    if position('if v_generated + v_refreshed + v_skipped = 0' in v_sql)=0 then raise exception 'Missing manual generation count contract'; end if;
    v_sql:=replace(v_sql,'if v_generated + v_refreshed + v_skipped = 0','if v_generated + v_refreshed + v_skipped + v_zero = 0');
  else
    v_sql:=replace(v_sql,'''missingTaxCount'', 0,','''missingTaxCount'', 0, ''skippedZeroCount'', 0,');
  end if;
  v_sql:=replace(v_sql,'''missingTaxCount'', v_missing_tax,','''missingTaxCount'', v_missing_tax, ''skippedZeroCount'', v_zero,');
  execute v_sql;
  v_count:=v_count+1;
 end loop;
 if v_count<>2 then raise exception 'Both payroll generators must be updated'; end if;
end $migration$;
notify pgrst,'reload schema';
