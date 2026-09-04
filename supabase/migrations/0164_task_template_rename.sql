create or replace function public.rename_v2_task_template(
  p_template_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.v2_task_templates%rowtype;
  v_old_name text;
  v_new_name text := btrim(coalesce(p_name, ''));
  v_store_id uuid;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;
  if v_new_name = '' then
    raise exception '请填写模板名称' using errcode = '22023';
  end if;

  select * into v_template
  from public.v2_task_templates
  where id = p_template_id
  for update;

  if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then
    raise exception 'task template not found or access denied' using errcode = '42501';
  end if;
  if v_template.status = 'archived' then
    raise exception '已归档模板不能重命名' using errcode = '55000';
  end if;

  v_old_name := v_template.name;
  update public.v2_task_templates
  set name = v_new_name
  where id = v_template.id
  returning * into v_template;

  for v_store_id in
    select store_id from public.v2_task_template_stores where template_id = v_template.id
  loop
    insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata)
    values (
      v_store_id,
      auth.uid(),
      'v2_task_template_renamed',
      'v2_task_templates',
      v_template.id,
      jsonb_build_object('old_name', v_old_name, 'new_name', v_template.name)
    );
  end loop;

  return to_jsonb(v_template);
end;
$$;

revoke all on function public.rename_v2_task_template(uuid, text) from public;
grant execute on function public.rename_v2_task_template(uuid, text) to authenticated;
