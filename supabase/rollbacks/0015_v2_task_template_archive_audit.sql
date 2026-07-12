create or replace function public.archive_v2_task_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.v2_task_templates%rowtype;
begin
  if not public.can_manage_v2_task_template(p_template_id) then
    raise exception 'task template not found or access denied' using errcode = '42501';
  end if;
  update public.v2_task_templates set status = 'archived'
  where id = p_template_id returning * into v_template;
  return to_jsonb(v_template);
end;
$$;
