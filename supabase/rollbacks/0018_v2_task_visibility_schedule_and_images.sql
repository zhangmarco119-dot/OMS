-- Rollback deliberately does not restore store-user template visibility.
-- Restoring that exposure would violate the V2 task-instance-only workflow.
drop function if exists public.next_v2_task_template_due(uuid);
alter table public.v2_task_templates drop constraint if exists v2_task_templates_recurrence_day_check;
alter table public.v2_task_templates drop column if exists recurrence_day;
