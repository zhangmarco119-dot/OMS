-- Per-user SOP favorites. SOP visibility is still governed by can_read_v2_sop.

create table public.v2_sop_favorites (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sop_id uuid not null references public.v2_sops(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(profile_id, sop_id)
);

create index v2_sop_favorites_sop_idx on public.v2_sop_favorites(sop_id, created_at desc);
alter table public.v2_sop_favorites enable row level security;

create policy v2_sop_favorites_select_own on public.v2_sop_favorites
for select to authenticated using(profile_id=auth.uid());

create policy v2_sop_favorites_insert_own on public.v2_sop_favorites
for insert to authenticated with check(profile_id=auth.uid() and public.can_read_v2_sop(sop_id));

create policy v2_sop_favorites_delete_own on public.v2_sop_favorites
for delete to authenticated using(profile_id=auth.uid());

revoke all on public.v2_sop_favorites from anon;
grant select,insert,delete on public.v2_sop_favorites to authenticated;
