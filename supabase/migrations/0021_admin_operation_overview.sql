create or replace function public.admin_operation_overview()
returns table (
  arrival_today integer,
  arrival_pending integer,
  inventory_completed_today integer,
  inventory_pending integer,
  v2_task_completed integer,
  v2_task_active integer
) language plpgsql security definer set search_path = public stable as $$
declare local_today date := timezone('Asia/Shanghai', now())::date;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required' using errcode = '42501'; end if;
  return query select
    (select count(*)::integer from public.arrival_reports report where report.arrival_date = local_today and public.has_store_access(report.store_id)),
    (select count(*)::integer from public.arrival_reports report where report.status = 'submitted' and public.has_store_access(report.store_id)),
    (select count(*)::integer from public.tasks task where task.task_type = 'inventory' and task.status = 'submitted' and task.submitted_at >= (local_today::timestamp at time zone 'Asia/Shanghai') and public.has_store_access(task.store_id)),
    (select count(*)::integer from public.tasks task where task.task_type = 'inventory' and task.status in ('draft', 'review') and public.has_store_access(task.store_id)),
    (select count(*)::integer from public.v2_tasks task where task.status = 'approved' and public.has_store_access(task.store_id)),
    (select count(*)::integer from public.v2_tasks task where task.status in ('pending', 'in_progress', 'submitted', 'rejected', 'resubmitted', 'overdue') and public.has_store_access(task.store_id));
end;
$$;
revoke all on function public.admin_operation_overview() from public;
grant execute on function public.admin_operation_overview() to authenticated;
