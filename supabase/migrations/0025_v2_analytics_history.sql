create or replace function public.admin_v2_analytics(p_days integer default 7)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_days integer := greatest(1, least(coalesce(p_days, 7), 31)); v_today date := timezone('Asia/Shanghai', now())::date;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'arrival', jsonb_build_object(
      'today', (select count(*)::integer from public.arrival_reports report where report.arrival_date = v_today and report.status <> 'voided' and public.has_store_access(report.store_id)),
      'pending', (select count(*)::integer from public.arrival_reports report where report.status = 'submitted' and public.has_store_access(report.store_id)),
      'stores', (select count(distinct report.store_id)::integer from public.arrival_reports report where report.arrival_date = v_today and report.status <> 'voided' and public.has_store_access(report.store_id)),
      'product_kinds', (select count(distinct item.product_name_snapshot)::integer from public.arrival_report_items item join public.arrival_reports report on report.id = item.report_id where report.arrival_date = v_today and report.status <> 'voided' and public.has_store_access(report.store_id)),
      'quantity_total', (select coalesce(sum(item.quantity), 0) from public.arrival_report_items item join public.arrival_reports report on report.id = item.report_id where report.arrival_date = v_today and report.status <> 'voided' and public.has_store_access(report.store_id)),
      'trend', (select coalesce(jsonb_agg(jsonb_build_object('date', trend.report_day::text, 'count', trend.report_count) order by trend.report_day), '[]'::jsonb) from (select report.arrival_date as report_day, count(*)::integer as report_count from public.arrival_reports report where report.arrival_date >= v_today - (v_days - 1) and report.status <> 'voided' and public.has_store_access(report.store_id) group by report.arrival_date) trend)
    ),
    'tasks', jsonb_build_object(
      'pending', (select count(*)::integer from public.v2_tasks task where task.status in ('pending','in_progress') and public.has_store_access(task.store_id)),
      'submitted', (select count(*)::integer from public.v2_tasks task where task.status in ('submitted','resubmitted') and public.has_store_access(task.store_id)),
      'approved', (select count(*)::integer from public.v2_tasks task where task.status = 'approved' and public.has_store_access(task.store_id)),
      'rejected', (select count(*)::integer from public.v2_tasks task where task.status = 'rejected' and public.has_store_access(task.store_id)),
      'overdue', (select count(*)::integer from public.v2_tasks task where task.status = 'overdue' and public.has_store_access(task.store_id)),
      'completion_rate', (select case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where task.status = 'approved') / count(*), 1) end from public.v2_tasks task where task.status <> 'cancelled' and public.has_store_access(task.store_id)),
      'store_rates', (select coalesce(jsonb_agg(jsonb_build_object('store_id', store.id, 'store_name', store.short_name, 'total', totals.total, 'approved', totals.approved, 'rate', totals.rate) order by store.short_name), '[]'::jsonb) from public.stores store join lateral (select count(*)::integer total, count(*) filter (where task.status = 'approved')::integer approved, case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where task.status = 'approved') / count(*), 1) end rate from public.v2_tasks task where task.store_id = store.id and task.status <> 'cancelled') totals on true where public.has_store_access(store.id))
    ),
    'inspection', jsonb_build_object(
      'issue_count', (select count(*)::integer from public.v2_task_answers answer join public.v2_tasks task on task.id = answer.task_id where task.category = 'inspection' and answer.is_issue and public.has_store_access(task.store_id)),
      'correction_completion_rate', (select case when count(*) filter (where task.status in ('rejected','approved')) = 0 then 0 else round(100.0 * count(*) filter (where task.status = 'approved' and task.review_note is not null) / count(*) filter (where task.status in ('rejected','approved')), 1) end from public.v2_tasks task where task.category = 'inspection' and public.has_store_access(task.store_id)),
      'frequent_issues', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', count) order by count desc, label) filter (where label is not null), '[]'::jsonb) from (select answer.item_snapshot->>'label' label, count(*)::integer count from public.v2_task_answers answer join public.v2_tasks task on task.id = answer.task_id where task.category = 'inspection' and answer.is_issue and public.has_store_access(task.store_id) group by answer.item_snapshot->>'label' order by count(*) desc, answer.item_snapshot->>'label' limit 5) issues)
    ),
    'v1', jsonb_build_object(
      'inventory_submissions', (select count(*)::integer from public.tasks task where task.task_type = 'inventory' and task.status = 'submitted' and task.submitted_at >= (v_today - 29)::timestamp at time zone 'Asia/Shanghai' and public.has_store_access(task.store_id)),
      'order_submissions', (select count(*)::integer from public.tasks task where task.task_type = 'order' and task.status = 'submitted' and task.submitted_at >= (v_today - 29)::timestamp at time zone 'Asia/Shanghai' and public.has_store_access(task.store_id)),
      'open_inventory', (select count(*)::integer from public.tasks task where task.task_type = 'inventory' and task.status in ('draft','review') and public.has_store_access(task.store_id))
    )
  );
end;
$$;

revoke all on function public.admin_v2_analytics(integer) from public;
grant execute on function public.admin_v2_analytics(integer) to authenticated;
