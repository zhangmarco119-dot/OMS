-- Rename an SOP category and every SOP that currently uses it in one
-- administrator-only transaction. This keeps the text category model
-- consistent while preserving existing SOP ids, assets, and publication state.

create or replace function public.rename_v2_sop_category(p_category_id uuid, p_new_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category public.v2_sop_categories%rowtype;
  v_new_name text := btrim(coalesce(p_new_name, ''));
  v_usage_count integer;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;

  if v_new_name = '' then
    raise exception 'SOP category name is required' using errcode = '22023';
  end if;

  select * into v_category
  from public.v2_sop_categories
  where id = p_category_id
  for update;

  if not found then
    raise exception 'SOP category not found' using errcode = 'P0002';
  end if;

  if v_category.name = v_new_name then
    return jsonb_build_object(
      'id', v_category.id,
      'old_name', v_category.name,
      'new_name', v_new_name,
      'updated_sops', 0
    );
  end if;

  if exists (
    select 1 from public.v2_sop_categories
    where id <> p_category_id and lower(name) = lower(v_new_name)
  ) then
    raise exception 'SOP_CATEGORY_NAME_EXISTS' using errcode = '23505';
  end if;

  update public.v2_sops
  set category = v_new_name
  where category = v_category.name;
  get diagnostics v_usage_count = row_count;

  update public.v2_sop_categories
  set name = v_new_name
  where id = p_category_id;

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, metadata)
  values (
    auth.uid(),
    'v2_sop_category_renamed',
    'v2_sop_categories',
    p_category_id,
    jsonb_build_object(
      'old_name', v_category.name,
      'new_name', v_new_name,
      'updated_sops', v_usage_count
    )
  );

  return jsonb_build_object(
    'id', p_category_id,
    'old_name', v_category.name,
    'new_name', v_new_name,
    'updated_sops', v_usage_count
  );
end;
$$;

revoke all on function public.rename_v2_sop_category(uuid, text) from public;
grant execute on function public.rename_v2_sop_category(uuid, text) to authenticated;
