-- Archived templates are kept separate from active work. They can be permanently
-- removed only when no task or recurring schedule needs their historical version.
create or replace function public.delete_archived_v2_task_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.v2_task_templates%rowtype;
  v_store_id uuid;
begin
  select * into v_template from public.v2_task_templates where id = p_template_id for update;
  if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then
    raise exception 'task template not found or access denied' using errcode = '42501';
  end if;
  if v_template.status <> 'archived' then
    raise exception 'only archived templates can be deleted' using errcode = '55000';
  end if;
  if exists (select 1 from public.v2_tasks where template_id = v_template.id)
    or exists (select 1 from public.v2_task_schedules where template_id = v_template.id) then
    raise exception 'template has task history or recurring schedules and must remain archived' using errcode = '55000';
  end if;

  for v_store_id in select store_id from public.v2_task_template_stores where template_id = v_template.id loop
    insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata)
    values (v_store_id, auth.uid(), 'v2_task_template_deleted', 'v2_task_templates', v_template.id, jsonb_build_object('name', v_template.name));
  end loop;

  delete from public.v2_task_template_versions where template_id = v_template.id;
  delete from public.v2_task_templates where id = v_template.id;
  return to_jsonb(v_template);
end;
$$;

revoke all on function public.delete_archived_v2_task_template(uuid) from public;
grant execute on function public.delete_archived_v2_task_template(uuid) to authenticated;

create policy v2_task_template_reference_image_delete on storage.objects for delete to authenticated using (
  bucket_id = 'v2-task-template-reference-images'
  and public.current_user_role() = 'admin'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.can_manage_v2_task_template((storage.foldername(name))[1]::uuid)
);
