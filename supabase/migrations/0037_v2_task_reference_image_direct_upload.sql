-- Attach template reference images after a direct Storage upload. This mirrors
-- the reliable arrival-image flow and keeps the item/image link atomic.
create or replace function public.attach_v2_task_template_reference_image(
  p_template_id uuid,
  p_item_id uuid,
  p_path text
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paths text[];
begin
  if public.current_user_role() <> 'admin'
    or not public.can_manage_v2_task_template(p_template_id) then
    raise exception 'administrator template permission required' using errcode = '42501';
  end if;

  if p_path is null
    or p_path !~ ('^' || p_template_id::text || '/' || p_item_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'invalid reference image path' using errcode = '22023';
  end if;

  update public.v2_task_template_items
  set reference_image_paths = case
        when p_path = any(reference_image_paths) then reference_image_paths
        else array_append(reference_image_paths, p_path)
      end,
      reference_image_path = coalesce(reference_image_path, p_path)
  where id = p_item_id
    and template_id = p_template_id
  returning reference_image_paths into v_paths;

  if v_paths is null then
    raise exception 'task template item not found' using errcode = 'P0002';
  end if;

  return v_paths;
end;
$$;

revoke all on function public.attach_v2_task_template_reference_image(uuid, uuid, text) from public;
grant execute on function public.attach_v2_task_template_reference_image(uuid, uuid, text) to authenticated;
