-- Admin-only tax reporting roster and monthly salary overrides.
-- Personal identity data must be inserted through the authenticated application,
-- never embedded in migrations or seed files.

create table public.tax_reporting_people (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  reporting_store_id uuid references public.stores(id) on delete set null,
  full_name text not null,
  id_number text not null,
  phone text not null,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tax_reporting_people_name_check
    check (char_length(btrim(full_name)) between 1 and 50),
  constraint tax_reporting_people_id_number_check
    check (upper(btrim(id_number)) ~ '^[0-9]{17}[0-9X]$'),
  constraint tax_reporting_people_phone_check
    check (btrim(phone) ~ '^1[0-9]{10}$')
);

create unique index tax_reporting_people_profile_unique
  on public.tax_reporting_people(profile_id)
  where profile_id is not null;
create index tax_reporting_people_store_idx
  on public.tax_reporting_people(reporting_store_id, is_active, full_name);

create table public.tax_reporting_monthly_salaries (
  person_id uuid not null references public.tax_reporting_people(id) on delete cascade,
  payroll_month date not null,
  manual_amount numeric(12,2),
  note text not null default '',
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (person_id, payroll_month),
  constraint tax_reporting_monthly_salaries_month_check
    check (payroll_month = date_trunc('month', payroll_month)::date),
  constraint tax_reporting_monthly_salaries_amount_check
    check (manual_amount is null or manual_amount >= 0),
  constraint tax_reporting_monthly_salaries_note_check
    check (char_length(note) <= 300)
);

create index tax_reporting_monthly_salaries_month_idx
  on public.tax_reporting_monthly_salaries(payroll_month, person_id);

create trigger tax_reporting_people_touch_updated_at
before update on public.tax_reporting_people
for each row execute function public.touch_updated_at();

create trigger tax_reporting_monthly_salaries_touch_updated_at
before update on public.tax_reporting_monthly_salaries
for each row execute function public.touch_updated_at();

create trigger audit_tax_reporting_people
after insert or update or delete on public.tax_reporting_people
for each row execute function public.capture_system_operation_log();

create trigger audit_tax_reporting_monthly_salaries
after insert or update or delete on public.tax_reporting_monthly_salaries
for each row execute function public.capture_system_operation_log();

alter table public.tax_reporting_people enable row level security;
alter table public.tax_reporting_monthly_salaries enable row level security;

create policy tax_reporting_people_admin_select
on public.tax_reporting_people for select to authenticated
using (public.current_user_role() = 'admin');

create policy tax_reporting_people_admin_insert
on public.tax_reporting_people for insert to authenticated
with check (
  public.current_user_role() = 'admin'
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy tax_reporting_people_admin_update
on public.tax_reporting_people for update to authenticated
using (public.current_user_role() = 'admin')
with check (
  public.current_user_role() = 'admin'
  and updated_by = auth.uid()
);

create policy tax_reporting_people_admin_delete
on public.tax_reporting_people for delete to authenticated
using (public.current_user_role() = 'admin');

create policy tax_reporting_monthly_salaries_admin_select
on public.tax_reporting_monthly_salaries for select to authenticated
using (public.current_user_role() = 'admin');

create policy tax_reporting_monthly_salaries_admin_insert
on public.tax_reporting_monthly_salaries for insert to authenticated
with check (
  public.current_user_role() = 'admin'
  and updated_by = auth.uid()
);

create policy tax_reporting_monthly_salaries_admin_update
on public.tax_reporting_monthly_salaries for update to authenticated
using (public.current_user_role() = 'admin')
with check (
  public.current_user_role() = 'admin'
  and updated_by = auth.uid()
);

create policy tax_reporting_monthly_salaries_admin_delete
on public.tax_reporting_monthly_salaries for delete to authenticated
using (public.current_user_role() = 'admin');

grant select, insert, update, delete on public.tax_reporting_people to authenticated;
grant select, insert, update, delete on public.tax_reporting_monthly_salaries to authenticated;

comment on table public.tax_reporting_people is
  'Admin-only tax reporting roster. Identity numbers and phone numbers are sensitive personal data.';
comment on column public.tax_reporting_people.reporting_store_id is
  'Independent tax reporting assignment. NULL excludes the person from generated tax cards.';
comment on table public.tax_reporting_monthly_salaries is
  'Optional monthly manual salary values for unlinked people or explicit tax-report overrides.';
