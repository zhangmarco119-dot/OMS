create table public.v2_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'retracted')),
  is_pinned boolean not null default false,
  published_at timestamptz,
  retracted_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (nullif(btrim(title), '') is not null),
  check ((status = 'published') = (published_at is not null)),
  check (status <> 'retracted' or retracted_at is not null)
);

create table public.v2_notice_stores (
  notice_id uuid not null references public.v2_notices(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (notice_id, store_id)
);

create table public.v2_notice_reads (
  notice_id uuid not null references public.v2_notices(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notice_id, profile_id)
);

create table public.v2_sops (
  id uuid primary key default gen_random_uuid(),
  category text not null default '通用',
  title text not null,
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version integer not null default 0 check (version >= 0),
  effective_at timestamptz,
  published_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (nullif(btrim(category), '') is not null),
  check (nullif(btrim(title), '') is not null),
  check ((status = 'published') = (published_at is not null)),
  check (status <> 'published' or effective_at is not null)
);

create table public.v2_sop_stores (
  sop_id uuid not null references public.v2_sops(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sop_id, store_id)
);

create table public.v2_sop_roles (
  sop_id uuid not null references public.v2_sops(id) on delete cascade,
  role text not null check (role in ('staff', 'manager')),
  created_at timestamptz not null default now(),
  primary key (sop_id, role)
);

create table public.v2_sop_assets (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references public.v2_sops(id) on delete cascade,
  bucket text not null default 'v2-sop-assets' check (bucket = 'v2-sop-assets'),
  object_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (nullif(btrim(object_path), '') is not null),
  check (nullif(btrim(file_name), '') is not null)
);

create index v2_notices_status_pinned_idx on public.v2_notices (status, is_pinned desc, published_at desc);
create index v2_notice_stores_store_idx on public.v2_notice_stores (store_id, notice_id);
create index v2_sops_status_effective_idx on public.v2_sops (status, effective_at desc, category);
create index v2_sop_stores_store_idx on public.v2_sop_stores (store_id, sop_id);
create index v2_sop_assets_sop_idx on public.v2_sop_assets (sop_id, created_at);

create trigger v2_notices_touch_updated_at before update on public.v2_notices for each row execute function public.touch_updated_at();
create trigger v2_sops_touch_updated_at before update on public.v2_sops for each row execute function public.touch_updated_at();

create or replace function public.can_manage_v2_notice(p_notice_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.current_user_role() = 'admin'
    and exists (select 1 from public.v2_notices where id = p_notice_id)
    and not exists (
      select 1 from public.v2_notice_stores assignment
      where assignment.notice_id = p_notice_id and not public.has_store_access(assignment.store_id)
    )
$$;

create or replace function public.can_read_v2_notice(p_notice_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.can_manage_v2_notice(p_notice_id)
    or exists (
      select 1 from public.v2_notices notice
      join public.v2_notice_stores assignment on assignment.notice_id = notice.id
      where notice.id = p_notice_id
        and notice.status = 'published'
        and public.current_user_role() in ('staff', 'manager')
        and assignment.store_id = public.current_user_store_id()
        and public.has_store_access(assignment.store_id)
    )
$$;

create or replace function public.can_manage_v2_sop(p_sop_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.current_user_role() = 'admin'
    and exists (select 1 from public.v2_sops where id = p_sop_id)
    and not exists (
      select 1 from public.v2_sop_stores assignment
      where assignment.sop_id = p_sop_id and not public.has_store_access(assignment.store_id)
    )
$$;

create or replace function public.can_read_v2_sop(p_sop_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.can_manage_v2_sop(p_sop_id)
    or exists (
      select 1 from public.v2_sops sop
      join public.v2_sop_stores assignment on assignment.sop_id = sop.id
      join public.v2_sop_roles audience on audience.sop_id = sop.id
      where sop.id = p_sop_id
        and sop.status = 'published'
        and sop.effective_at <= now()
        and audience.role = public.current_user_role()
        and assignment.store_id = public.current_user_store_id()
        and public.has_store_access(assignment.store_id)
    )
$$;

alter table public.v2_notices enable row level security;
alter table public.v2_notice_stores enable row level security;
alter table public.v2_notice_reads enable row level security;
alter table public.v2_sops enable row level security;
alter table public.v2_sop_stores enable row level security;
alter table public.v2_sop_roles enable row level security;
alter table public.v2_sop_assets enable row level security;

create policy v2_notices_select_allowed on public.v2_notices for select to authenticated using (public.can_read_v2_notice(id));
create policy v2_notice_stores_select_allowed on public.v2_notice_stores for select to authenticated using (public.can_read_v2_notice(notice_id));
create policy v2_notice_reads_select_own on public.v2_notice_reads for select to authenticated using (profile_id = auth.uid() and public.can_read_v2_notice(notice_id));
create policy v2_sops_select_allowed on public.v2_sops for select to authenticated using (public.can_read_v2_sop(id));
create policy v2_sop_stores_select_allowed on public.v2_sop_stores for select to authenticated using (public.can_read_v2_sop(sop_id));
create policy v2_sop_roles_select_allowed on public.v2_sop_roles for select to authenticated using (public.can_read_v2_sop(sop_id));
create policy v2_sop_assets_select_allowed on public.v2_sop_assets for select to authenticated using (public.can_read_v2_sop(sop_id));
create policy v2_sop_assets_insert_admin on public.v2_sop_assets for insert to authenticated with check (
  uploaded_by = auth.uid() and public.can_manage_v2_sop(sop_id) and object_path like sop_id::text || '/%'
);
create policy v2_sop_assets_delete_admin on public.v2_sop_assets for delete to authenticated using (public.can_manage_v2_sop(sop_id));

create or replace function public.save_v2_notice(p_notice_id uuid, p_fields jsonb, p_store_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_notice public.v2_notices%rowtype; v_title text := btrim(coalesce(p_fields->>'title', '')); v_body text := coalesce(p_fields->>'body', ''); v_pinned boolean := coalesce((p_fields->>'is_pinned')::boolean, false); v_store_id uuid;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required' using errcode = '42501'; end if;
  if v_title = '' then raise exception 'notice title is required' using errcode = '22023'; end if;
  if coalesce(cardinality(p_store_ids), 0) = 0 then raise exception 'at least one notice store is required' using errcode = '22023'; end if;
  foreach v_store_id in array p_store_ids loop if not public.has_store_access(v_store_id) then raise exception 'notice store access denied' using errcode = '42501'; end if; end loop;
  if p_notice_id is null then
    insert into public.v2_notices (title, body, is_pinned, created_by) values (v_title, v_body, v_pinned, auth.uid()) returning * into v_notice;
  else
    if not public.can_manage_v2_notice(p_notice_id) then raise exception 'notice management denied' using errcode = '42501'; end if;
    update public.v2_notices set title = v_title, body = v_body, is_pinned = v_pinned where id = p_notice_id returning * into v_notice;
    delete from public.v2_notice_stores where notice_id = v_notice.id;
  end if;
  insert into public.v2_notice_stores (notice_id, store_id) select v_notice.id, unnest(p_store_ids);
  insert into public.audit_logs (actor_id, action, entity_table, entity_id, metadata) values (auth.uid(), 'v2_notice_saved', 'v2_notices', v_notice.id, jsonb_build_object('store_ids', p_store_ids));
  return to_jsonb(v_notice);
end;
$$;

create or replace function public.publish_v2_notice(p_notice_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_notice public.v2_notices%rowtype;
begin
  if not public.can_manage_v2_notice(p_notice_id) then raise exception 'notice management denied' using errcode = '42501'; end if;
  update public.v2_notices set status = 'published', published_at = coalesce(published_at, now()), retracted_at = null where id = p_notice_id returning * into v_notice;
  insert into public.audit_logs (actor_id, action, entity_table, entity_id) values (auth.uid(), 'v2_notice_published', 'v2_notices', v_notice.id);
  return to_jsonb(v_notice);
end;
$$;

create or replace function public.retract_v2_notice(p_notice_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_notice public.v2_notices%rowtype;
begin
  if not public.can_manage_v2_notice(p_notice_id) then raise exception 'notice management denied' using errcode = '42501'; end if;
  update public.v2_notices set status = 'retracted', published_at = null, retracted_at = now(), is_pinned = false where id = p_notice_id returning * into v_notice;
  insert into public.audit_logs (actor_id, action, entity_table, entity_id) values (auth.uid(), 'v2_notice_retracted', 'v2_notices', v_notice.id);
  return to_jsonb(v_notice);
end;
$$;

create or replace function public.mark_v2_notice_read(p_notice_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.can_read_v2_notice(p_notice_id) then raise exception 'notice read denied' using errcode = '42501'; end if;
  insert into public.v2_notice_reads (notice_id, profile_id) values (p_notice_id, auth.uid()) on conflict (notice_id, profile_id) do update set read_at = excluded.read_at;
  return jsonb_build_object('notice_id', p_notice_id, 'read_at', now());
end;
$$;

create or replace function public.save_v2_sop(p_sop_id uuid, p_fields jsonb, p_store_ids uuid[], p_roles text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sop public.v2_sops%rowtype; v_title text := btrim(coalesce(p_fields->>'title', '')); v_body text := coalesce(p_fields->>'body', ''); v_category text := btrim(coalesce(p_fields->>'category', '通用')); v_effective_at timestamptz := nullif(p_fields->>'effective_at', '')::timestamptz; v_store_id uuid; v_role text;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required' using errcode = '42501'; end if;
  if v_title = '' or v_category = '' then raise exception 'sop title and category are required' using errcode = '22023'; end if;
  if coalesce(cardinality(p_store_ids), 0) = 0 or coalesce(cardinality(p_roles), 0) = 0 then raise exception 'sop stores and roles are required' using errcode = '22023'; end if;
  foreach v_store_id in array p_store_ids loop if not public.has_store_access(v_store_id) then raise exception 'sop store access denied' using errcode = '42501'; end if; end loop;
  foreach v_role in array p_roles loop if v_role not in ('staff', 'manager') then raise exception 'invalid sop audience role' using errcode = '22023'; end if; end loop;
  if p_sop_id is null then
    insert into public.v2_sops (category, title, body, effective_at, created_by) values (v_category, v_title, v_body, v_effective_at, auth.uid()) returning * into v_sop;
  else
    if not public.can_manage_v2_sop(p_sop_id) then raise exception 'sop management denied' using errcode = '42501'; end if;
    update public.v2_sops set category = v_category, title = v_title, body = v_body, effective_at = v_effective_at where id = p_sop_id returning * into v_sop;
    delete from public.v2_sop_stores where sop_id = v_sop.id;
    delete from public.v2_sop_roles where sop_id = v_sop.id;
  end if;
  insert into public.v2_sop_stores (sop_id, store_id) select v_sop.id, unnest(p_store_ids);
  insert into public.v2_sop_roles (sop_id, role) select v_sop.id, unnest(p_roles);
  insert into public.audit_logs (actor_id, action, entity_table, entity_id, metadata) values (auth.uid(), 'v2_sop_saved', 'v2_sops', v_sop.id, jsonb_build_object('store_ids', p_store_ids, 'roles', p_roles));
  return to_jsonb(v_sop);
end;
$$;

create or replace function public.publish_v2_sop(p_sop_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sop public.v2_sops%rowtype;
begin
  if not public.can_manage_v2_sop(p_sop_id) then raise exception 'sop management denied' using errcode = '42501'; end if;
  update public.v2_sops set status = 'published', version = version + 1, published_at = now(), effective_at = coalesce(effective_at, now()) where id = p_sop_id returning * into v_sop;
  insert into public.audit_logs (actor_id, action, entity_table, entity_id, metadata) values (auth.uid(), 'v2_sop_published', 'v2_sops', v_sop.id, jsonb_build_object('version', v_sop.version));
  return to_jsonb(v_sop);
end;
$$;

create or replace function public.archive_v2_sop(p_sop_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sop public.v2_sops%rowtype;
begin
  if not public.can_manage_v2_sop(p_sop_id) then raise exception 'sop management denied' using errcode = '42501'; end if;
  update public.v2_sops set status = 'archived' where id = p_sop_id returning * into v_sop;
  insert into public.audit_logs (actor_id, action, entity_table, entity_id) values (auth.uid(), 'v2_sop_archived', 'v2_sops', v_sop.id);
  return to_jsonb(v_sop);
end;
$$;

insert into storage.buckets (id, name, public) values ('v2-sop-assets', 'v2-sop-assets', false) on conflict (id) do nothing;
create policy "v2 sop assets read" on storage.objects for select to authenticated using (
  bucket_id = 'v2-sop-assets' and public.can_read_v2_sop((storage.foldername(name))[1]::uuid)
);
create policy "v2 sop assets upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'v2-sop-assets' and public.can_manage_v2_sop((storage.foldername(name))[1]::uuid)
);
create policy "v2 sop assets delete" on storage.objects for delete to authenticated using (
  bucket_id = 'v2-sop-assets' and public.can_manage_v2_sop((storage.foldername(name))[1]::uuid)
);

revoke all on function public.can_manage_v2_notice(uuid), public.can_read_v2_notice(uuid), public.can_manage_v2_sop(uuid), public.can_read_v2_sop(uuid), public.save_v2_notice(uuid, jsonb, uuid[]), public.publish_v2_notice(uuid), public.retract_v2_notice(uuid), public.mark_v2_notice_read(uuid), public.save_v2_sop(uuid, jsonb, uuid[], text[]), public.publish_v2_sop(uuid), public.archive_v2_sop(uuid) from public;
grant execute on function public.can_manage_v2_notice(uuid), public.can_read_v2_notice(uuid), public.can_manage_v2_sop(uuid), public.can_read_v2_sop(uuid), public.save_v2_notice(uuid, jsonb, uuid[]), public.publish_v2_notice(uuid), public.retract_v2_notice(uuid), public.mark_v2_notice_read(uuid), public.save_v2_sop(uuid, jsonb, uuid[], text[]), public.publish_v2_sop(uuid), public.archive_v2_sop(uuid) to authenticated;
grant select on public.v2_notices, public.v2_notice_stores, public.v2_notice_reads, public.v2_sops, public.v2_sop_stores, public.v2_sop_roles, public.v2_sop_assets to authenticated;
