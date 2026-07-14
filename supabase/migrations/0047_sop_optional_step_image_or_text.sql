-- Allow each SOP step to contain an image, text, or both. Cover images and
-- attachments remain file-backed assets.

alter table public.v2_sop_assets
  drop constraint if exists v2_sop_assets_object_path_check,
  drop constraint if exists v2_sop_assets_file_name_check,
  drop constraint if exists v2_sop_assets_mime_type_check,
  drop constraint if exists v2_sop_assets_size_bytes_check;

alter table public.v2_sop_assets
  alter column object_path drop not null,
  alter column file_name drop not null,
  alter column mime_type drop not null,
  alter column size_bytes set default 0;

alter table public.v2_sop_assets
  add constraint v2_sop_assets_content_check check (
    case asset_kind
      when 'step' then
        (
          object_path is not null
          and nullif(btrim(object_path), '') is not null
          and nullif(btrim(file_name), '') is not null
          and mime_type in ('image/jpeg', 'image/png', 'image/webp')
          and size_bytes > 0 and size_bytes <= 10485760
        )
        or
        (
          object_path is null
          and file_name is null
          and mime_type is null
          and size_bytes = 0
          and nullif(btrim(step_text), '') is not null
        )
      when 'cover' then
        object_path is not null
        and nullif(btrim(object_path), '') is not null
        and nullif(btrim(file_name), '') is not null
        and mime_type in ('image/jpeg', 'image/png', 'image/webp')
        and size_bytes > 0 and size_bytes <= 10485760
      when 'attachment' then
        object_path is not null
        and nullif(btrim(object_path), '') is not null
        and nullif(btrim(file_name), '') is not null
        and mime_type = 'application/pdf'
        and size_bytes > 0 and size_bytes <= 10485760
      else false
    end
  );

drop policy if exists v2_sop_assets_insert_admin on public.v2_sop_assets;
create policy v2_sop_assets_insert_admin
on public.v2_sop_assets for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and public.can_manage_v2_sop(sop_id)
  and (
    object_path like sop_id::text || '/%'
    or (
      asset_kind = 'step'
      and object_path is null
      and nullif(btrim(step_text), '') is not null
    )
  )
);

create or replace function public.create_v2_sop_text_step(
  p_sop_id uuid,
  p_sort_order integer,
  p_step_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.v2_sop_assets%rowtype;
  v_text text := btrim(coalesce(p_step_text, ''));
begin
  if not public.can_manage_v2_sop(p_sop_id) then
    raise exception 'sop management denied' using errcode = '42501';
  end if;
  if v_text = '' then
    raise exception 'text-only SOP step requires text' using errcode = '22023';
  end if;
  if coalesce(p_sort_order, -1) < 0 then
    raise exception 'invalid SOP step order' using errcode = '22023';
  end if;

  insert into public.v2_sop_assets (
    sop_id, asset_kind, object_path, file_name, mime_type, size_bytes,
    uploaded_by, sort_order, step_text
  )
  values (
    p_sop_id, 'step', null, null, null, 0,
    auth.uid(), p_sort_order, v_text
  )
  returning * into v_step;

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'v2_sop_text_step_created', 'v2_sop_assets', v_step.id, jsonb_build_object(
    'sop_id', p_sop_id,
    'sort_order', p_sort_order
  ));
  return to_jsonb(v_step);
end;
$$;

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
           left(v_sop.body, 180),
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

revoke all on function public.create_v2_sop_text_step(uuid, integer, text) from public;
grant execute on function public.create_v2_sop_text_step(uuid, integer, text) to authenticated;
