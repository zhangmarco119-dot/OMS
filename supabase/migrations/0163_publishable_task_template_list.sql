create or replace function public.list_publishable_v2_task_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'task template publish access denied' using errcode = '42501';
  end if;

  return (
    select coalesce(
      jsonb_agg(
        to_jsonb(template)
        || jsonb_build_object(
          'storeIds', (
            select coalesce(jsonb_agg(assignment.store_id order by assignment.store_id), '[]'::jsonb)
            from public.v2_task_template_stores assignment
            where assignment.template_id = template.id
          )
        )
        order by template.updated_at desc
      ),
      '[]'::jsonb
    )
    from public.v2_task_templates template
    where template.status = 'published'
      and public.can_view_v2_task_template(template.id)
  );
end;
$$;

revoke all on function public.list_publishable_v2_task_templates() from public;
grant execute on function public.list_publishable_v2_task_templates() to authenticated;
