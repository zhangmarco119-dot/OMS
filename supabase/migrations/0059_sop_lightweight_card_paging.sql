-- Return only the data needed by SOP list cards. The function is security invoker,
-- so the existing SOP, store, role, asset and favorite RLS policies remain authoritative.

create index if not exists v2_sops_list_idx on public.v2_sops(status, category, updated_at desc);
create index if not exists v2_sop_assets_preview_idx on public.v2_sop_assets(sop_id, asset_kind, sort_order desc, created_at desc);

create or replace function public.list_v2_sop_cards(
  p_archived boolean default false,
  p_category text default 'all',
  p_search text default '',
  p_favorites_only boolean default false,
  p_limit integer default 16,
  p_offset integer default 0
)
returns jsonb language plpgsql stable set search_path=public as $$
declare v_result jsonb;
begin
  if p_limit<1 or p_limit>50 or p_offset<0 then raise exception 'invalid pagination'; end if;
  with filtered as (
    select sop.*
    from public.v2_sops sop
    where (case when p_archived then sop.status='archived' else sop.status<>'archived' end)
      and (coalesce(p_category,'all')='all' or sop.category=p_category)
      and (trim(coalesce(p_search,''))='' or sop.title ilike '%'||trim(p_search)||'%' or sop.category ilike '%'||trim(p_search)||'%' or sop.body ilike '%'||trim(p_search)||'%')
      and (not p_favorites_only or exists(select 1 from public.v2_sop_favorites favorite where favorite.profile_id=auth.uid() and favorite.sop_id=sop.id))
  ), paged as (
    select * from filtered order by updated_at desc,id limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total',(select count(*) from filtered),
    'items',coalesce((select jsonb_agg(
      to_jsonb(sop) || jsonb_build_object(
        'roles',coalesce((select jsonb_agg(role.role order by role.role) from public.v2_sop_roles role where role.sop_id=sop.id),'[]'::jsonb),
        'storeIds',coalesce((select jsonb_agg(store.store_id order by store.store_id) from public.v2_sop_stores store where store.sop_id=sop.id),'[]'::jsonb),
        'previewAsset',(select to_jsonb(asset) from public.v2_sop_assets asset where asset.sop_id=sop.id and asset.asset_kind in ('cover','step') order by case when asset.asset_kind='cover' then 0 else 1 end,case when asset.asset_kind='step' then asset.sort_order end desc,asset.created_at desc limit 1),
        'stepCount',(select count(*) from public.v2_sop_assets asset where asset.sop_id=sop.id and asset.asset_kind='step'),
        'attachmentCount',(select count(*) from public.v2_sop_assets asset where asset.sop_id=sop.id and asset.asset_kind='attachment'),
        'isFavorite',exists(select 1 from public.v2_sop_favorites favorite where favorite.profile_id=auth.uid() and favorite.sop_id=sop.id)
      ) order by sop.updated_at desc,sop.id
    ) from paged sop),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.list_v2_sop_cards(boolean,text,text,boolean,integer,integer) from public,anon;
grant execute on function public.list_v2_sop_cards(boolean,text,text,boolean,integer,integer) to authenticated;
