do $$ begin
  if to_regclass('public.v2_task_schedules') is null then raise exception 'V2 task schedules table missing'; end if;
  if to_regprocedure('public.create_v2_task_schedule(uuid,uuid[],timestamp with time zone,text,smallint,smallint[])') is null or to_regprocedure('public.dispatch_v2_task_schedules()') is null then raise exception 'V2 task schedule RPC missing'; end if;
  if has_table_privilege('authenticated', 'public.v2_task_schedules', 'INSERT,UPDATE,DELETE') then raise exception 'V2 task schedules must block direct writes'; end if;
  if not exists (select 1 from cron.job where jobname = 'storehub-v2-task-schedule-dispatch') then raise exception 'V2 task schedule dispatcher is not registered'; end if;
  raise notice 'StoreHub V2 recurring task schedule checks passed';
end $$;
