-- Xizhimen product registration: personal editable records with administrator read-only visibility.
create table public.product_registration_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  registration_type text not null check (registration_type in ('packaging', 'abandoned', 'loaned_to_wudaokou', 'equipment', 'other')),
  product_id uuid references public.products(id) on delete set null,
  product_name text not null default '',
  unit text not null default '',
  note text not null default '',
  status text not null default 'draft' check (status in ('draft', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_registration_entries_store_type_updated_idx
  on public.product_registration_entries(store_id, registration_type, updated_at desc);
create index product_registration_entries_creator_updated_idx
  on public.product_registration_entries(created_by, updated_at desc);

create table public.product_registration_images (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.product_registration_entries(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  bucket text not null default 'product-registration-images',
  object_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0),
  width integer,
  height integer,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index product_registration_images_entry_created_idx
  on public.product_registration_images(entry_id, created_at);

create or replace function public.sync_product_registration_entry_status(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.product_registration_entries entry
  set status = case
    when nullif(trim(entry.product_name), '') is not null
      and nullif(trim(entry.unit), '') is not null
      and exists (select 1 from public.product_registration_images image where image.entry_id = entry.id)
    then 'completed'
    else 'draft'
  end,
  updated_at = now()
  where entry.id = p_entry_id;
end;
$$;

create or replace function public.sync_product_registration_entry_from_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_product_registration_entry_status(new.id);
  return new;
end;
$$;

create or replace function public.sync_product_registration_entry_from_image()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_product_registration_entry_status(coalesce(new.entry_id, old.entry_id));
  return coalesce(new, old);
end;
$$;

create trigger product_registration_entries_status_from_fields
after insert or update of product_name, unit on public.product_registration_entries
for each row execute function public.sync_product_registration_entry_from_fields();

create trigger product_registration_entries_touch_updated_at
before update on public.product_registration_entries
for each row execute function public.touch_updated_at();

create trigger product_registration_images_status_after_change
after insert or delete on public.product_registration_images
for each row execute function public.sync_product_registration_entry_from_image();

alter table public.product_registration_entries enable row level security;
alter table public.product_registration_images enable row level security;

create policy product_registration_entries_select_own_or_admin
on public.product_registration_entries for select to authenticated
using (
  created_by = auth.uid()
  or (public.current_user_role() = 'admin' and public.has_store_access(store_id))
);

create policy product_registration_entries_insert_own
on public.product_registration_entries for insert to authenticated
with check (
  created_by = auth.uid()
  and store_id = public.current_user_store_id()
);

create policy product_registration_entries_update_own
on public.product_registration_entries for update to authenticated
using (created_by = auth.uid())
with check (
  created_by = auth.uid()
  and store_id = public.current_user_store_id()
);

create policy product_registration_entries_delete_own
on public.product_registration_entries for delete to authenticated
using (created_by = auth.uid());

create policy product_registration_images_select_own_or_admin
on public.product_registration_images for select to authenticated
using (
  exists (
    select 1 from public.product_registration_entries entry
    where entry.id = product_registration_images.entry_id
      and (
        entry.created_by = auth.uid()
        or (public.current_user_role() = 'admin' and public.has_store_access(entry.store_id))
      )
  )
);

create policy product_registration_images_insert_own
on public.product_registration_images for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1 from public.product_registration_entries entry
    where entry.id = product_registration_images.entry_id
      and entry.store_id = product_registration_images.store_id
      and entry.created_by = auth.uid()
  )
);

create policy product_registration_images_delete_own
on public.product_registration_images for delete to authenticated
using (
  exists (
    select 1 from public.product_registration_entries entry
    where entry.id = product_registration_images.entry_id
      and entry.created_by = auth.uid()
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-registration-images', 'product-registration-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy product_registration_storage_select
on storage.objects for select to authenticated
using (
  bucket_id = 'product-registration-images'
  and exists (
    select 1
    from public.product_registration_images image
    join public.product_registration_entries entry on entry.id = image.entry_id
    where image.object_path = name
      and (
        entry.created_by = auth.uid()
        or (public.current_user_role() = 'admin' and public.has_store_access(entry.store_id))
      )
  )
);

create policy product_registration_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-registration-images'
  and (storage.foldername(name))[1] = public.current_user_store_id()::text
);

create policy product_registration_storage_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'product-registration-images'
  and (storage.foldername(name))[1] = public.current_user_store_id()::text
);

do $$
begin
  alter publication supabase_realtime add table public.product_registration_entries;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.product_registration_images;
exception when duplicate_object then null;
end $$;

comment on table public.product_registration_entries is
  'Xizhimen staff and managers maintain their own packaging, abandoned, loaned, equipment and other product registrations. Administrators can view only.';
