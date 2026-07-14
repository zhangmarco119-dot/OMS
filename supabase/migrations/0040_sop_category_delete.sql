-- Allow administrators to delete unused SOP categories without leaving
-- existing SOPs with an orphaned category value.

create or replace function public.delete_v2_sop_category(p_category_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category public.v2_sop_categories%rowtype;
  v_usage_count integer;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;

  select * into v_category
  from public.v2_sop_categories
  where id = p_category_id
  for update;

  if not found then
    raise exception 'SOP category not found' using errcode = 'P0002';
  end if;

  select count(*) into v_usage_count
  from public.v2_sops
  where category = v_category.name;

  if v_usage_count > 0 then
    raise exception 'SOP_CATEGORY_IN_USE:%', v_usage_count using errcode = '23503';
  end if;

  delete from public.v2_sop_categories where id = p_category_id;

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, metadata)
  values (
    auth.uid(),
    'v2_sop_category_deleted',
    'v2_sop_categories',
    p_category_id,
    jsonb_build_object('name', v_category.name)
  );

  return jsonb_build_object('id', p_category_id, 'name', v_category.name, 'deleted', true);
end;
$$;

revoke all on function public.delete_v2_sop_category(uuid) from public;
grant execute on function public.delete_v2_sop_category(uuid) to authenticated;
