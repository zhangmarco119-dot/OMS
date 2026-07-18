-- Fetch SOP detail metadata in one RLS-protected request. Image URLs are signed lazily
-- by the frontend only when their cards approach the viewport.

create or replace function public.get_v2_sop_detail(p_sop_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select to_jsonb(sop) || jsonb_build_object(
    'roles', coalesce((
      select jsonb_agg(role.role order by role.role)
      from public.v2_sop_roles role
      where role.sop_id = sop.id
    ), '[]'::jsonb),
    'storeIds', coalesce((
      select jsonb_agg(store.store_id order by store.store_id)
      from public.v2_sop_stores store
      where store.sop_id = sop.id
    ), '[]'::jsonb),
    'assets', coalesce((
      select jsonb_agg(to_jsonb(asset) order by asset.sort_order, asset.created_at)
      from public.v2_sop_assets asset
      where asset.sop_id = sop.id
    ), '[]'::jsonb)
  )
  from public.v2_sops sop
  where sop.id = p_sop_id;
$$;

revoke all on function public.get_v2_sop_detail(uuid) from public, anon;
grant execute on function public.get_v2_sop_detail(uuid) to authenticated;
