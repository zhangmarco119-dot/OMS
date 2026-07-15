-- Store the complete user manuals in Postgres so the application can load the
-- latest approved copy without bundling database credentials or public files.
create table public.v2_system_documents (
  slug text primary key,
  title text not null,
  audience text not null check (audience in ('staff_manager', 'admin')),
  summary text not null default '',
  content_html text not null default '',
  document_version text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint v2_system_documents_slug_check check (slug ~ '^[a-z0-9-]+$')
);

create trigger v2_system_documents_touch_updated_at
before update on public.v2_system_documents
for each row execute function public.touch_updated_at();

alter table public.v2_system_documents enable row level security;

revoke all on table public.v2_system_documents from anon;
revoke all on table public.v2_system_documents from authenticated;
grant select, insert, update on table public.v2_system_documents to authenticated;

create policy v2_system_documents_select_admin
on public.v2_system_documents
for select to authenticated
using (public.current_user_role() = 'admin');

create policy v2_system_documents_insert_admin
on public.v2_system_documents
for insert to authenticated
with check (public.current_user_role() = 'admin' and updated_by = auth.uid());

create policy v2_system_documents_update_admin
on public.v2_system_documents
for update to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin' and updated_by = auth.uid());

insert into public.v2_system_documents (slug, title, audience, summary, document_version)
values
  (
    'staff-manager-guide',
    '员工与店长使用说明',
    'staff_manager',
    '登录、点货订货、到货上报、任务、公告、SOP、历史记录和账号使用说明。',
    '2.2.1'
  ),
  (
    'admin-guide',
    '管理员使用说明',
    'admin',
    '任务、到货、货品、账号、公告、SOP、运营统计和归档管理说明。',
    '2.2.1'
  )
on conflict (slug) do update
set title = excluded.title,
    audience = excluded.audience,
    summary = excluded.summary,
    document_version = excluded.document_version;
