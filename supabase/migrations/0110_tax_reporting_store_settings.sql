-- Per-store legal company names used by the employee individual income tax report.

create table public.tax_reporting_store_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  company_name text not null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tax_reporting_store_settings_company_name_check
    check (char_length(btrim(company_name)) between 1 and 100)
);

insert into public.tax_reporting_store_settings (store_id, company_name)
select
  id,
  case
    when name like '%西直门%' then '咖啡真好喝有限公司'
    when name like '%五道口%' then '微风习习餐饮有限公司'
    else name
  end
from public.stores
on conflict (store_id) do nothing;

create trigger tax_reporting_store_settings_touch_updated_at
before update on public.tax_reporting_store_settings
for each row execute function public.touch_updated_at();

create trigger audit_tax_reporting_store_settings
after insert or update or delete on public.tax_reporting_store_settings
for each row execute function public.capture_system_operation_log();

alter table public.tax_reporting_store_settings enable row level security;

create policy tax_reporting_store_settings_admin_select
on public.tax_reporting_store_settings for select to authenticated
using (public.current_user_role() = 'admin');

create policy tax_reporting_store_settings_admin_insert
on public.tax_reporting_store_settings for insert to authenticated
with check (
  public.current_user_role() = 'admin'
  and updated_by = auth.uid()
);

create policy tax_reporting_store_settings_admin_update
on public.tax_reporting_store_settings for update to authenticated
using (public.current_user_role() = 'admin')
with check (
  public.current_user_role() = 'admin'
  and updated_by = auth.uid()
);

create policy tax_reporting_store_settings_admin_delete
on public.tax_reporting_store_settings for delete to authenticated
using (public.current_user_role() = 'admin');

grant select, insert, update, delete on public.tax_reporting_store_settings to authenticated;

comment on table public.tax_reporting_store_settings is
  'Admin-maintained legal company names shown on store employee individual income tax reports.';
