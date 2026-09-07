-- A single, admin-only employee archive shared by Employee Management and
-- Tax & Accounting.  Identity data is intentionally entered through the
-- authenticated application, not embedded in migrations or seed data.

alter table public.tax_reporting_people
  add column if not exists contact_address text,
  add column if not exists bank_card_number text,
  add column if not exists bank_name text,
  add column if not exists id_card_image_path text;

alter table public.tax_reporting_people
  alter column id_number drop not null,
  alter column phone drop not null;

alter table public.tax_reporting_people
  drop constraint if exists tax_reporting_people_id_number_check,
  drop constraint if exists tax_reporting_people_phone_check;

alter table public.tax_reporting_people
  add constraint tax_reporting_people_id_number_check
    check (id_number is null or upper(btrim(id_number)) ~ '^[0-9]{17}[0-9X]$'),
  add constraint tax_reporting_people_phone_check
    check (phone is null or btrim(phone) ~ '^1[0-9]{10}$'),
  add constraint tax_reporting_people_contact_address_check
    check (contact_address is null or char_length(btrim(contact_address)) between 1 and 300),
  add constraint tax_reporting_people_bank_card_number_check
    check (bank_card_number is null or btrim(bank_card_number) ~ '^[0-9]{12,30}$'),
  add constraint tax_reporting_people_bank_name_check
    check (bank_name is null or char_length(btrim(bank_name)) between 1 and 200),
  add constraint tax_reporting_people_id_card_image_path_check
    check (id_card_image_path is null or char_length(btrim(id_card_image_path)) between 1 and 500);

-- Every existing employee account receives a record immediately.  Fields that
-- have not yet been collected remain NULL so that an admin can complete them
-- later; incomplete records are excluded from tax-card generation below.
insert into public.tax_reporting_people (
  profile_id,
  reporting_store_id,
  full_name,
  id_number,
  phone,
  is_active,
  created_by,
  updated_by
)
select
  profile.id,
  profile.store_id,
  profile.display_name,
  null,
  null,
  profile.is_active,
  profile.id,
  profile.id
from public.profiles profile
where profile.role in ('staff', 'manager')
  and profile.deleted_at is null
on conflict (profile_id) where profile_id is not null do update
set
  full_name = excluded.full_name,
  is_active = excluded.is_active,
  reporting_store_id = coalesce(public.tax_reporting_people.reporting_store_id, excluded.reporting_store_id),
  updated_by = excluded.updated_by;

create or replace function public.sync_tax_reporting_person_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role in ('staff', 'manager') and new.deleted_at is null then
    insert into public.tax_reporting_people (
      profile_id,
      reporting_store_id,
      full_name,
      id_number,
      phone,
      is_active,
      created_by,
      updated_by
    )
    values (
      new.id,
      new.store_id,
      new.display_name,
      null,
      null,
      new.is_active,
      coalesce(auth.uid(), new.id),
      coalesce(auth.uid(), new.id)
    )
    on conflict (profile_id) where profile_id is not null do update
    set
      full_name = excluded.full_name,
      is_active = excluded.is_active,
      reporting_store_id = coalesce(public.tax_reporting_people.reporting_store_id, excluded.reporting_store_id),
      updated_by = coalesce(auth.uid(), new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists sync_tax_reporting_person_from_profile on public.profiles;
create trigger sync_tax_reporting_person_from_profile
after insert or update of display_name, is_active, role, deleted_at, store_id on public.profiles
for each row execute function public.sync_tax_reporting_person_from_profile();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-documents',
  'employee-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists employee_documents_admin_select on storage.objects;
create policy employee_documents_admin_select
on storage.objects for select to authenticated
using (bucket_id = 'employee-documents' and public.current_user_role() = 'admin');

drop policy if exists employee_documents_admin_insert on storage.objects;
create policy employee_documents_admin_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'employee-documents' and public.current_user_role() = 'admin');

drop policy if exists employee_documents_admin_update on storage.objects;
create policy employee_documents_admin_update
on storage.objects for update to authenticated
using (bucket_id = 'employee-documents' and public.current_user_role() = 'admin')
with check (bucket_id = 'employee-documents' and public.current_user_role() = 'admin');

drop policy if exists employee_documents_admin_delete on storage.objects;
create policy employee_documents_admin_delete
on storage.objects for delete to authenticated
using (bucket_id = 'employee-documents' and public.current_user_role() = 'admin');

comment on table public.tax_reporting_people is
  'Admin-only shared employee archive for employee management and tax accounting. Contains sensitive identity, contact and bank information.';
comment on column public.tax_reporting_people.id_card_image_path is
  'Private object path in the employee-documents storage bucket.';
