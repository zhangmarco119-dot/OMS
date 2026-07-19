-- Safe client release control supports forward deployments and explicit rollbacks.
-- Enforcement is intentionally OFF for the bootstrap release. Enable it only
-- after the updater-capable frontend has reached active users.
create table public.system_release_control (
  singleton boolean primary key default true check (singleton),
  active_release text not null,
  allowed_releases text[] not null,
  minimum_database_contract integer not null default 1 check (minimum_database_contract > 0),
  enforcement_mode text not null default 'off' check (enforcement_mode in ('off', 'warn', 'block')),
  check_interval_seconds integer not null default 60 check (check_interval_seconds between 30 and 3600),
  message text not null default '当前页面版本已经停止使用，请立即更新后继续操作。',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (cardinality(allowed_releases) > 0)
);

insert into public.system_release_control (
  singleton,
  active_release,
  allowed_releases,
  minimum_database_contract,
  enforcement_mode
) values (true, '2.4.4', array['2.4.4'], 1, 'off');

alter table public.system_release_control enable row level security;
revoke all on public.system_release_control from public, anon, authenticated;
grant select on public.system_release_control to anon, authenticated;

create policy system_release_control_read
on public.system_release_control
for select
to anon, authenticated
using (true);

create or replace function public.get_system_release_policy()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'activeRelease', active_release,
    'allowedReleases', allowed_releases,
    'minimumDatabaseContract', minimum_database_contract,
    'enforcementMode', enforcement_mode,
    'checkIntervalSeconds', check_interval_seconds,
    'message', message,
    'updatedAt', updated_at
  )
  from public.system_release_control
  where singleton;
$$;

create or replace function public.configure_system_release_policy(
  p_active_release text,
  p_allowed_releases text[],
  p_minimum_database_contract integer default 1,
  p_enforcement_mode text default 'off',
  p_check_interval_seconds integer default 60,
  p_message text default '当前页面版本已经停止使用，请立即更新后继续操作。'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'admin' then
    raise exception '需要管理员权限' using errcode = '42501';
  end if;
  if coalesce(btrim(p_active_release), '') !~ '^\d+\.\d+\.\d+$' then
    raise exception '当前版本必须使用 x.y.z 格式';
  end if;
  if coalesce(cardinality(p_allowed_releases), 0) = 0
    or exists (select 1 from unnest(p_allowed_releases) as allowed_release(value) where value !~ '^\d+\.\d+\.\d+$') then
    raise exception '允许版本必须至少包含一个 x.y.z 格式版本';
  end if;
  if not p_active_release = any(p_allowed_releases) then
    raise exception '当前版本必须包含在允许版本列表中';
  end if;
  if p_minimum_database_contract < 1 then
    raise exception '数据库兼容级别必须大于零';
  end if;
  if p_enforcement_mode not in ('off', 'warn', 'block') then
    raise exception '发布限制模式无效';
  end if;
  if p_check_interval_seconds not between 30 and 3600 then
    raise exception '版本检查间隔必须在 30 到 3600 秒之间';
  end if;

  update public.system_release_control
  set active_release = btrim(p_active_release),
      allowed_releases = array(select distinct btrim(value) from unnest(p_allowed_releases) as allowed_release(value)),
      minimum_database_contract = p_minimum_database_contract,
      enforcement_mode = p_enforcement_mode,
      check_interval_seconds = p_check_interval_seconds,
      message = coalesce(nullif(btrim(p_message), ''), message),
      updated_at = now(),
      updated_by = auth.uid()
  where singleton;

  return public.get_system_release_policy();
end;
$$;

create or replace function public.assert_supported_client_release()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  policy public.system_release_control%rowtype;
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  client_release text := coalesce(headers ->> 'x-storehub-release', '');
  client_contract integer;
begin
  if auth.role() <> 'authenticated' then
    return;
  end if;

  select * into policy from public.system_release_control where singleton;
  if policy.enforcement_mode <> 'block' then
    return;
  end if;

  begin
    client_contract := coalesce(nullif(headers ->> 'x-storehub-contract', '')::integer, 0);
  exception when others then
    client_contract := 0;
  end;

  if not client_release = any(policy.allowed_releases)
    or client_contract < policy.minimum_database_contract then
    raise exception '%', policy.message
      using errcode = 'P0001',
        hint = 'STOREHUB_CLIENT_UPDATE_REQUIRED';
  end if;
end;
$$;

create or replace function public.enforce_supported_client_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_supported_client_release();
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare target record;
begin
  for target in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname <> 'system_release_control'
  loop
    execute format(
      'create trigger enforce_supported_client_release before insert or update or delete on public.%I for each statement execute function public.enforce_supported_client_release()',
      target.relname
    );
  end loop;
end $$;

revoke all on function public.get_system_release_policy() from public;
revoke all on function public.configure_system_release_policy(text,text[],integer,text,integer,text) from public;
revoke all on function public.assert_supported_client_release() from public;
revoke all on function public.enforce_supported_client_release() from public;
grant execute on function public.get_system_release_policy() to anon, authenticated;
grant execute on function public.configure_system_release_policy(text,text[],integer,text,integer,text) to authenticated;

comment on table public.system_release_control is
  'Exact allowed client releases and database contract gate. Exact matching keeps rollback safe; do not compare version numbers by size.';
