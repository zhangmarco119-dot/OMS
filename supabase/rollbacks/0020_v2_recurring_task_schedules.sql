do $$ declare job_id bigint; begin for job_id in select jobid from cron.job where jobname = 'storehub-v2-task-schedule-dispatch' loop perform cron.unschedule(job_id); end loop; end $$;
drop function if exists public.pause_v2_task_schedule(uuid);
drop function if exists public.dispatch_v2_task_schedules();
drop function if exists public.create_v2_task_schedule(uuid, uuid[], timestamptz, text, smallint, smallint[]);
drop function if exists public.create_v2_task_from_schedule(uuid, timestamptz);
drop function if exists public.v2_task_schedule_next_due(uuid, timestamptz);
alter table public.v2_tasks drop column if exists schedule_id;
drop table if exists public.v2_task_schedules;
