do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='v2_task_schedules' and column_name='month_day') then raise exception 'monthly task schedule column missing'; end if;
  if to_regprocedure('public.create_v2_task_schedule(uuid,uuid[],timestamp with time zone,text,smallint,smallint[],smallint)') is null then raise exception 'monthly task schedule RPC missing'; end if;
  raise notice 'StoreHub V2 monthly task schedule checks passed';
end $$;
