-- Complete the administrator SOP lifecycle without breaking older deployed
-- clients that still call publish_v2_sop(uuid).

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

create or replace function public.publish_v2_sop(p_sop_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.publish_v2_sop_with_options(p_sop_id, false)
$$;

create or replace function public.retract_v2_sop(p_sop_id uuid)
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

  update public.v2_sops
  set status = 'draft', published_at = null
  where id = p_sop_id and status = 'published'
  returning * into v_sop;

  if v_sop.id is null then
    raise exception 'only published SOP can be retracted' using errcode = '55000';
  end if;

  delete from public.notifications
  where entity_type = 'v2_sop' and entity_id = v_sop.id;

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'v2_sop_retracted', 'v2_sops', v_sop.id, jsonb_build_object('version', v_sop.version));
  return to_jsonb(v_sop);
end;
$$;

create or replace function public.archive_v2_sop(p_sop_id uuid)
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

  update public.v2_sops
  set status = 'archived', published_at = null
  where id = p_sop_id and status = 'draft'
  returning * into v_sop;

  if v_sop.id is null then
    raise exception 'only draft SOP can be archived' using errcode = '55000';
  end if;

  insert into public.audit_logs (actor_id, action, entity_table, entity_id)
  values (auth.uid(), 'v2_sop_archived', 'v2_sops', v_sop.id);
  return to_jsonb(v_sop);
end;
$$;

create or replace function public.delete_archived_v2_sop(p_sop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if not public.can_manage_v2_sop(p_sop_id) then
    raise exception 'sop management denied' using errcode = '42501';
  end if;

  select title into v_title
  from public.v2_sops
  where id = p_sop_id and status = 'archived'
  for update;

  if v_title is null then
    raise exception 'only archived SOP can be deleted' using errcode = '55000';
  end if;

  delete from public.notifications where entity_type = 'v2_sop' and entity_id = p_sop_id;
  delete from public.v2_sops where id = p_sop_id;
  insert into public.audit_logs (actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'v2_sop_deleted', 'v2_sops', p_sop_id, jsonb_build_object('title', v_title));
  return jsonb_build_object('id', p_sop_id, 'title', v_title);
end;
$$;

revoke all on function public.publish_v2_sop_with_options(uuid, boolean) from public;
revoke all on function public.publish_v2_sop(uuid) from public;
revoke all on function public.retract_v2_sop(uuid) from public;
revoke all on function public.archive_v2_sop(uuid) from public;
revoke all on function public.delete_archived_v2_sop(uuid) from public;
grant execute on function public.publish_v2_sop_with_options(uuid, boolean) to authenticated;
grant execute on function public.publish_v2_sop(uuid) to authenticated;
grant execute on function public.retract_v2_sop(uuid) to authenticated;
grant execute on function public.archive_v2_sop(uuid) to authenticated;
grant execute on function public.delete_archived_v2_sop(uuid) to authenticated;
