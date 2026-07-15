do $$
declare v_table text;
begin
  foreach v_table in array array[
    'dingtalk_employee_directory','dingtalk_employee_bindings','attendance_daily_records','attendance_punch_records',
    'attendance_sync_jobs','attendance_sync_failures','attendance_audit_logs'
  ] loop
    if to_regclass('public.'||v_table) is null then raise exception 'attendance table missing: %',v_table; end if;
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=v_table and c.relrowsecurity) then
      raise exception 'attendance RLS missing: %',v_table;
    end if;
  end loop;

  if to_regclass('public.attendance_monthly_summary') is null then raise exception 'attendance monthly summary missing'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='attendance_daily_records' and policyname='attendance_daily_records_select_allowed') then raise exception 'daily attendance policy missing'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='dingtalk_employee_bindings_active_profile_idx') then raise exception 'active profile binding uniqueness missing'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='attendance_daily_records_store_month_idx') then raise exception 'attendance month index missing'; end if;
  if has_table_privilege('anon','public.attendance_daily_records','SELECT,INSERT,UPDATE,DELETE') then raise exception 'anonymous attendance access must be denied'; end if;
  if has_table_privilege('authenticated','public.attendance_daily_records','INSERT,UPDATE,DELETE') then raise exception 'authenticated attendance writes must be denied'; end if;
  if not has_function_privilege('authenticated','public.get_attendance_month_detail(uuid,date)','EXECUTE') then raise exception 'employee month detail RPC missing'; end if;
  if not has_function_privilege('authenticated','public.admin_attendance_month(date,uuid,text,text,integer,integer)','EXECUTE') then raise exception 'admin month RPC missing'; end if;

  raise notice 'StoreHub DingTalk attendance schema checks passed';
end;
$$;

