revoke all on function public.archive_v2_task_template(uuid) from authenticated;
revoke all on function public.publish_v2_task_template(uuid) from authenticated;
revoke all on function public.save_v2_task_template(uuid, jsonb, uuid[], jsonb) from authenticated;
revoke all on function public.can_view_v2_task_template(uuid) from authenticated;
revoke all on function public.can_manage_v2_task_template(uuid) from authenticated;

drop function if exists public.archive_v2_task_template(uuid);
drop function if exists public.publish_v2_task_template(uuid);
drop function if exists public.save_v2_task_template(uuid, jsonb, uuid[], jsonb);
drop function if exists public.can_view_v2_task_template(uuid);
drop function if exists public.can_manage_v2_task_template(uuid);

drop table if exists public.v2_task_template_versions;
drop table if exists public.v2_task_template_items;
drop table if exists public.v2_task_template_groups;
drop table if exists public.v2_task_template_stores;
drop table if exists public.v2_task_templates;
