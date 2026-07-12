-- The helper is called only from the administrator-only publishing RPC.
-- Do not expose template schedules to store users by UUID guessing.
revoke all on function public.next_v2_task_template_due(uuid) from public;
revoke all on function public.next_v2_task_template_due(uuid) from authenticated;
