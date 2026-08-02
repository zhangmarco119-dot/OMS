-- A SOP may intentionally omit its optional overall description. Non-silent
-- publishing still creates notifications, whose body must be non-blank.

create or replace function public.publish_v2_sop_with_options(p_sop_id uuid, p_silent boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sop public.v2_sops%rowtype;
begin
  if not public.can_manage_v2_sop(p_sop_id) then
    raise exception 'sop management denied' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.v2_sop_assets asset
    where asset.sop_id = p_sop_id
      and asset.asset_kind = 'step'
      and (asset.object_path is not null or nullif(btrim(asset.step_text), '') is not null)
  ) then
    raise exception 'SOP requires at least one image or text step' using errcode = '22023';
  end if;

  update public.v2_sops
  set status = 'published',
      published_at = now(),
      effective_at = coalesce(effective_at, now()),
      version = version + 1
  where id = p_sop_id and status = 'draft'
  returning * into v_sop;

  if v_sop.id is null then
    raise exception 'only draft SOP can be published' using errcode = '55000';
  end if;

  if not coalesce(p_silent, false) then
    insert into public.notifications (recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
    select p.id,
           p.store_id,
           'sop_published',
           v_sop.title,
           left(coalesce(nullif(btrim(v_sop.body), ''), '请打开 SOP 查看完整内容。'), 180),
           'v2_sop',
           v_sop.id,
           'sop:' || v_sop.id || ':' || v_sop.version || ':' || p.id
    from public.profiles p
    join public.v2_sop_stores ss on ss.store_id = p.store_id
    join public.v2_sop_roles sr on sr.sop_id = ss.sop_id and sr.role = p.role
    where ss.sop_id = v_sop.id and p.is_active and p.deleted_at is null
    on conflict (dedupe_key) do nothing;
  end if;

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'v2_sop_published', 'v2_sops', v_sop.id, jsonb_build_object(
    'version', v_sop.version,
    'silent', coalesce(p_silent, false)
  ));
  return to_jsonb(v_sop);
end;
$$;

