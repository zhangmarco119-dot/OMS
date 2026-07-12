-- Existing monthly schedules must be paused or migrated before rolling this back.
alter table public.v2_task_schedules drop constraint if exists v2_task_schedules_rule_check;
alter table public.v2_task_schedules drop column if exists month_day;
