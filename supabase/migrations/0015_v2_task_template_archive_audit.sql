create or replace function public.archive_v2_task_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.v2_task_templates%rowtype;
  v_store_id uuid;
begin
  if not public.can_manage_v2_task_template(p_template_id) then
    raise exception 'task template not found or access denied' using errcode = '42501';
  end if;

  update public.v2_task_templates set status = 'archived'
  where id = p_template_id returning * into v_template;

  for v_store_id in
    select store_id from public.v2_task_template_stores where template_id = v_template.id
  loop
    insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata)
    values (
      v_store_id, auth.uid(), 'v2_task_template_archived', 'v2_task_templates', v_template.id,
      jsonb_build_object('name', v_template.name, 'version', v_template.current_version)
    );
  end loop;

  return to_jsonb(v_template);
end;
$$;
