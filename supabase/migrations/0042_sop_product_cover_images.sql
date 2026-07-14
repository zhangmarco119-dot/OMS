-- Distinguish optional SOP product covers from ordered production steps and
-- document attachments. Existing data keeps its previous meaning.

alter table public.v2_sop_assets
  add column asset_kind text not null default 'step'
  check (asset_kind in ('step', 'cover', 'attachment'));

update public.v2_sop_assets
set asset_kind = 'attachment'
where mime_type = 'application/pdf';

create index v2_sop_assets_kind_order_idx
  on public.v2_sop_assets (sop_id, asset_kind, sort_order, created_at);

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
  where sop_id = p_sop_id and asset_kind = 'step';

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
        and asset.asset_kind = 'step'
       where asset.id is null
     ) then
    raise exception 'SOP image step list is incomplete or invalid' using errcode = '22023';
  end if;

  update public.v2_sop_assets asset
  set sort_order = ordered.position - 1
  from unnest(coalesce(p_asset_ids, array[]::uuid[])) with ordinality as ordered(asset_id, position)
  where asset.id = ordered.asset_id and asset.sop_id = p_sop_id and asset.asset_kind = 'step';

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'v2_sop_steps_reordered', 'v2_sops', p_sop_id, jsonb_build_object('asset_ids', p_asset_ids));

  return jsonb_build_object('sop_id', p_sop_id, 'asset_ids', p_asset_ids);
end;
$$;

revoke all on function public.reorder_v2_sop_assets(uuid, uuid[]) from public;
grant execute on function public.reorder_v2_sop_assets(uuid, uuid[]) to authenticated;
