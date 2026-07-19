-- Permanently disable broad automatic/history attendance queues. Attendance is
-- now fetched only by explicit, purpose-scoped requests guarded by API quota.

create or replace function private.dispatch_attendance_automation(p_mode text)
returns bigint language plpgsql security definer set search_path = public, private as $$
begin
  return null;
end $$;

create or replace function public.admin_save_attendance_automation_settings(
  p_enabled boolean,
  p_interval_minutes smallint,
  p_start_time time,
  p_end_time time
)
returns jsonb language plpgsql security definer set search_path = public, private, cron as $$
begin
  if public.current_user_role() <> 'admin' then raise exception '需要管理员权限'; end if;
  update private.attendance_automation_config
  set enabled = false, configured_by = auth.uid(), configured_at = now()
  where singleton;
  perform cron.unschedule('storehub-attendance-hourly') where exists(select 1 from cron.job where jobname='storehub-attendance-hourly');
  perform cron.unschedule('storehub-attendance-current-month') where exists(select 1 from cron.job where jobname='storehub-attendance-current-month');
  perform cron.unschedule('storehub-attendance-history-queue') where exists(select 1 from cron.job where jobname='storehub-attendance-history-queue');
  return public.get_attendance_automation_settings();
end $$;

revoke all on function private.dispatch_attendance_automation(text) from public, anon, authenticated;
revoke all on function public.admin_save_attendance_automation_settings(boolean,smallint,time,time) from public, anon;
grant execute on function public.admin_save_attendance_automation_settings(boolean,smallint,time,time) to authenticated;
