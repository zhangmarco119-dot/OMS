-- Keep the SOP lifecycle compatible with the table constraints:
-- published rows require both published_at and effective_at, while draft and
-- archived rows require published_at to be null.

create or replace function public.save_v2_sop(p_sop_id uuid, p_fields jsonb, p_store_ids uuid[], p_roles text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sop public.v2_sops%rowtype;
  v_title text := btrim(coalesce(p_fields ->> 'title', ''));
  v_body text := coalesce(p_fields ->> 'body', '');
  v_category text := btrim(coalesce(p_fields ->> 'category', '通用'));
  v_effective_at timestamptz := nullif(p_fields ->> 'effective_at', '')::timestamptz;
  v_template_id uuid := nullif(p_fields ->> 'task_template_id', '')::uuid;
  v_store_id uuid;
  v_role text;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;
  if v_title = '' or v_category = '' then
    raise exception 'sop title and category are required' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_store_ids), 0) = 0 or coalesce(cardinality(p_roles), 0) = 0 then
    raise exception 'sop stores and roles are required' using errcode = '22023';
  end if;
  foreach v_store_id in array p_store_ids loop
    if not public.has_store_access(v_store_id) then
      raise exception 'sop store access denied' using errcode = '42501';
    end if;
  end loop;
  foreach v_role in array p_roles loop
    if v_role not in ('staff', 'manager') then
      raise exception 'invalid sop audience role' using errcode = '22023';
    end if;
  end loop;
  if v_template_id is not null and not public.can_manage_v2_task_template(v_template_id) then
    raise exception 'sop task template access denied' using errcode = '42501';
  end if;

  if p_sop_id is null then
    insert into public.v2_sops (category, title, body, effective_at, task_template_id, created_by)
    values (v_category, v_title, v_body, v_effective_at, v_template_id, auth.uid())
    returning * into v_sop;
  else
    if not public.can_manage_v2_sop(p_sop_id) then
      raise exception 'sop management denied' using errcode = '42501';
    end if;
    update public.v2_sops
    set category = v_category,
        title = v_title,
        body = v_body,
        effective_at = case
          when status = 'published' then coalesce(v_effective_at, effective_at, now())
          else v_effective_at
        end,
        task_template_id = v_template_id
    where id = p_sop_id
    returning * into v_sop;
    delete from public.v2_sop_stores where sop_id = v_sop.id;
    delete from public.v2_sop_roles where sop_id = v_sop.id;
  end if;

  insert into public.v2_sop_stores (sop_id, store_id)
  select v_sop.id, unnest(p_store_ids);
  insert into public.v2_sop_roles (sop_id, role)
  select v_sop.id, unnest(p_roles);
  insert into public.audit_logs (actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'v2_sop_saved', 'v2_sops', v_sop.id, jsonb_build_object(
    'store_ids', p_store_ids,
    'roles', p_roles,
    'task_template_id', v_template_id
  ));
  return to_jsonb(v_sop);
end;
$$;

create or replace function public.publish_v2_sop(p_sop_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sop public.v2_sops%rowtype;
begin
  if not public.can_manage_v2_sop(p_sop_id) then
    raise exception 'sop management denied' using errcode = '42501';
  end if;
  update public.v2_sops
  set status = 'published',
      published_at = coalesce(published_at, now()),
      effective_at = coalesce(effective_at, now()),
      version = version + 1
  where id = p_sop_id
  returning * into v_sop;

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

  insert into public.audit_logs (actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'v2_sop_published', 'v2_sops', v_sop.id, jsonb_build_object('version', v_sop.version));
  return to_jsonb(v_sop);
end;
$$;

create or replace function public.archive_v2_sop(p_sop_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sop public.v2_sops%rowtype;
begin
  if not public.can_manage_v2_sop(p_sop_id) then
    raise exception 'sop management denied' using errcode = '42501';
  end if;
  update public.v2_sops
  set status = 'archived', published_at = null
  where id = p_sop_id
  returning * into v_sop;
  insert into public.audit_logs (actor_id, action, entity_table, entity_id)
  values (auth.uid(), 'v2_sop_archived', 'v2_sops', v_sop.id);
  return to_jsonb(v_sop);
end;
$$;

revoke all on function public.save_v2_sop(uuid, jsonb, uuid[], text[]) from public;
revoke all on function public.publish_v2_sop(uuid) from public;
revoke all on function public.archive_v2_sop(uuid) from public;
grant execute on function public.save_v2_sop(uuid, jsonb, uuid[], text[]) to authenticated;
grant execute on function public.publish_v2_sop(uuid) to authenticated;
grant execute on function public.archive_v2_sop(uuid) to authenticated;
