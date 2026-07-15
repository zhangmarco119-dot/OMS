-- Development-only rollback. Review data retention before running anywhere.
drop function if exists public.admin_unbind_dingtalk_employee(uuid);
drop function if exists public.admin_bind_dingtalk_employee(uuid,uuid,text);
drop function if exists public.admin_attendance_month(date,uuid,text,text,integer,integer);
drop function if exists public.get_attendance_month_detail(uuid,date);
drop view if exists public.attendance_monthly_summary;
drop function if exists public.can_admin_manage_attendance_profile(uuid);
drop function if exists public.can_admin_read_attendance_store(uuid);
drop table if exists public.attendance_audit_logs;
drop table if exists public.attendance_sync_failures;
drop table if exists public.attendance_sync_jobs;
drop table if exists public.attendance_punch_records;
drop table if exists public.attendance_daily_records;
drop table if exists public.dingtalk_employee_bindings;
drop table if exists public.dingtalk_employee_directory;

