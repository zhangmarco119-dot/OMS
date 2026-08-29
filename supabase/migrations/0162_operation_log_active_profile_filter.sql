create or replace function public.list_system_operation_log_actors()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if public.current_user_role() <> 'admin' then
    raise exception '需要管理员权限' using errcode = '42501';
  end if;

  return coalesce((
    with current_actors as (
      select
        profile.id,
        profile.display_name,
        coalesce(profile.username, '') as username,
        profile.role,
        profile.employment_type
      from public.profiles profile
      where profile.is_active
        and profile.deleted_at is null
        and (
          profile.store_id is null
          or public.has_store_access(profile.store_id)
          or exists (
            select 1
            from public.profile_store_access store_access
            where store_access.profile_id = profile.id
              and public.has_store_access(store_access.store_id)
          )
        )
    ), historical_actors as (
      select distinct on (log.actor_id)
        log.actor_id as id,
        log.actor_name_snapshot as display_name,
        coalesce(log.actor_username_snapshot, '') as username,
        log.actor_role_snapshot as role,
        log.actor_employment_type_snapshot as employment_type
      from public.system_operation_logs log
      where log.actor_id is not null
        and not exists (select 1 from current_actors actor where actor.id = log.actor_id)
        and (log.store_id is null or public.has_store_access(log.store_id))
      order by log.actor_id, log.occurred_at desc
    ), actors as (
      select * from current_actors
      union all
      select * from historical_actors
    )
    select jsonb_agg(to_jsonb(actor) order by actor.display_name, actor.username)
    from actors actor
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_system_operation_log_actors() from public, anon;
grant execute on function public.list_system_operation_log_actors() to authenticated;
