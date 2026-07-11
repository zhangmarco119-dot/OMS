alter table public.profiles
  add column deleted_at timestamptz;

create table public.profile_store_access (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, store_id)
);

insert into public.profile_store_access (profile_id, store_id)
select id, store_id
from public.profiles
on conflict do nothing;

insert into public.profile_store_access (profile_id, store_id)
select admin_profile_id, store_id
from public.admin_store_access
on conflict do nothing;

create index profile_store_access_store_idx
on public.profile_store_access (store_id, profile_id);

alter table public.profile_store_access enable row level security;

create or replace function public.has_store_access(target_store_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles profile
    join public.profile_store_access access
      on access.profile_id = profile.id
    where profile.id = auth.uid()
      and profile.is_active = true
      and profile.deleted_at is null
      and access.store_id = target_store_id
  )
$$;

create or replace function public.can_manage_store(target_store_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles profile
    join public.profile_store_access access
      on access.profile_id = profile.id
    where profile.id = auth.uid()
      and profile.is_active = true
      and profile.deleted_at is null
      and profile.role in ('manager', 'admin')
      and access.store_id = target_store_id
  )
$$;

create policy profile_store_access_select_allowed
on public.profile_store_access for select
to authenticated
using (
  profile_id = auth.uid()
  or (
    public.current_user_role() = 'admin'
    and public.has_store_access(store_id)
  )
);

create or replace function public.switch_current_store(p_store_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profile_store_access access
    join public.stores store on store.id = access.store_id
    join public.profiles profile on profile.id = access.profile_id
    where access.profile_id = auth.uid()
      and access.store_id = p_store_id
      and store.is_active = true
      and profile.is_active = true
      and profile.deleted_at is null
  ) then
    raise exception 'store access denied';
  end if;

  update public.profiles
  set store_id = p_store_id
  where id = auth.uid();

  return p_store_id;
end;
$$;

create or replace function public.admin_set_profile_stores(
  p_profile_id uuid,
  p_store_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_store_id uuid;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'admin permission required';
  end if;

  if coalesce(array_length(p_store_ids, 1), 0) = 0 then
    raise exception 'at least one store is required';
  end if;

  if exists (
    select 1
    from unnest(p_store_ids) as requested(store_id)
    where not public.has_store_access(requested.store_id)
  ) then
    raise exception 'cannot grant an inaccessible store';
  end if;

  select store_id into v_current_store_id
  from public.profiles
  where id = p_profile_id
    and deleted_at is null;

  if v_current_store_id is null then
    raise exception 'profile not found';
  end if;

  delete from public.profile_store_access
  where profile_id = p_profile_id;

  insert into public.profile_store_access (profile_id, store_id)
  select p_profile_id, requested.store_id
  from unnest(p_store_ids) as requested(store_id)
  on conflict do nothing;

  if not (v_current_store_id = any(p_store_ids)) then
    update public.profiles
    set store_id = p_store_ids[1]
    where id = p_profile_id;
  end if;
end;
$$;

revoke all on function public.switch_current_store(uuid) from public;
revoke all on function public.admin_set_profile_stores(uuid, uuid[]) from public;
grant execute on function public.switch_current_store(uuid) to authenticated;
grant execute on function public.admin_set_profile_stores(uuid, uuid[]) to authenticated;
