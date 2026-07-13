-- Explicitly requested test reset: retire currently actionable administrator items without deleting history.
update public.v2_tasks
set status = 'cancelled', version = version + 1, updated_at = now()
where status in ('submitted', 'resubmitted');

update public.product_feedback
set status = 'ignored',
    handled_at = now(),
    resolution_note = coalesce(resolution_note, '测试前由管理员强制清理待办'),
    handled_by = null
where status = 'open';

insert into public.audit_logs(store_id, action, entity_table, entity_id, metadata)
select store_id, 'admin_test_todo_cleanup', 'v2_tasks', id, jsonb_build_object('reason', 'explicit test reset')
from public.v2_tasks
where status = 'cancelled' and updated_at >= now() - interval '5 minutes';
