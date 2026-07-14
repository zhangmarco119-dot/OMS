-- Structured SOP categories and ordered image/text steps.
-- Existing SOPs and assets remain valid; existing assets receive stable order.

alter table public.v2_sop_assets
  add column step_text text not null default '',
  add column sort_order integer not null default 0 check (sort_order >= 0);

with ranked as (
  select id, row_number() over (partition by sop_id order by created_at, id) - 1 as position
  from public.v2_sop_assets
)
update public.v2_sop_assets asset
set sort_order = ranked.position
from ranked
where ranked.id = asset.id;

create index v2_sop_assets_step_order_idx
  on public.v2_sop_assets (sop_id, sort_order, created_at);

create table public.v2_sop_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (nullif(btrim(name), '') is not null)
);

insert into public.v2_sop_categories (name, sort_order)
select category, row_number() over (order by category) - 1
from (select distinct btrim(category) as category from public.v2_sops where nullif(btrim(category), '') is not null) existing
on conflict (name) do nothing;

insert into public.v2_sop_categories (name, sort_order)
values ('奶茶制作', 10), ('酸奶碗制作', 20), ('原料准备', 30), ('设备操作', 40), ('清洁消毒', 50), ('通用', 60)
on conflict (name) do nothing;

create trigger v2_sop_categories_touch_updated_at
before update on public.v2_sop_categories
for each row execute function public.touch_updated_at();

alter table public.v2_sop_categories enable row level security;

create policy v2_sop_categories_select_authenticated
on public.v2_sop_categories for select to authenticated
using (true);

create policy v2_sop_categories_insert_admin
on public.v2_sop_categories for insert to authenticated
with check (public.current_user_role() = 'admin' and created_by = auth.uid());

create policy v2_sop_categories_update_admin
on public.v2_sop_categories for update to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy v2_sop_assets_update_admin
on public.v2_sop_assets for update to authenticated
using (public.can_manage_v2_sop(sop_id))
with check (public.can_manage_v2_sop(sop_id));

grant select on public.v2_sop_categories to authenticated;
grant insert, update on public.v2_sop_categories to authenticated;
grant update (step_text, sort_order) on public.v2_sop_assets to authenticated;
