-- Persist image-step order atomically. The supplied list must contain every
-- image asset for the SOP exactly once; PDF attachments are intentionally
-- excluded from the visual production sequence.

create or replace function public.reorder_v2_sop_assets(p_sop_id uuid, p_asset_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_count integer;
  v_distinct_count integer;
begin
  if not public.can_manage_v2_sop(p_sop_id) then
    raise exception 'sop management denied' using errcode = '42501';
  end if;

  select count(*) into v_expected_count
  from public.v2_sop_assets
  where sop_id = p_sop_id and mime_type like 'image/%';

  select count(distinct asset_id) into v_distinct_count
  from unnest(coalesce(p_asset_ids, array[]::uuid[])) as supplied(asset_id);

  if cardinality(coalesce(p_asset_ids, array[]::uuid[])) <> v_expected_count
     or v_distinct_count <> v_expected_count
     or exists (
       select 1
       from unnest(coalesce(p_asset_ids, array[]::uuid[])) as supplied(asset_id)
       left join public.v2_sop_assets asset
         on asset.id = supplied.asset_id
        and asset.sop_id = p_sop_id
        and asset.mime_type like 'image/%'
       where asset.id is null
     ) then
    raise exception 'SOP image step list is incomplete or invalid' using errcode = '22023';
  end if;

  update public.v2_sop_assets asset
  set sort_order = ordered.position - 1
  from unnest(coalesce(p_asset_ids, array[]::uuid[])) with ordinality as ordered(asset_id, position)
  where asset.id = ordered.asset_id and asset.sop_id = p_sop_id;

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, metadata)
  values (
    auth.uid(),
    'v2_sop_steps_reordered',
    'v2_sops',
    p_sop_id,
    jsonb_build_object('asset_ids', p_asset_ids)
  );

  return jsonb_build_object('sop_id', p_sop_id, 'asset_ids', p_asset_ids);
end;
$$;

revoke all on function public.reorder_v2_sop_assets(uuid, uuid[]) from public;
grant execute on function public.reorder_v2_sop_assets(uuid, uuid[]) to authenticated;
