-- Keep dated membership separately from current application access. An end date
-- is exclusive: cancellation on October 17 preserves membership through the 16th.
create table public.profile_store_assignment_periods (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  store_id uuid not null references public.stores(id),
  effective_from date not null,
  effective_to date,
  is_primary boolean not null default false,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index profile_store_assignment_periods_lookup on public.profile_store_assignment_periods(profile_id,store_id,effective_from,effective_to);
create unique index profile_store_assignment_periods_open on public.profile_store_assignment_periods(profile_id,store_id) where effective_to is null;
alter table public.profile_store_assignment_periods enable row level security;
create policy profile_store_assignment_periods_select on public.profile_store_assignment_periods
for select to authenticated using (
  profile_id = auth.uid() or (public.current_user_role() = 'admin' and public.has_store_access(store_id))
);
grant select on public.profile_store_assignment_periods to authenticated;
revoke all on public.profile_store_assignment_periods from anon;
revoke insert,update,delete on public.profile_store_assignment_periods from authenticated;
grant all on public.profile_store_assignment_periods to service_role;

-- The legacy access table has no start-date history. Preserve its full historical
-- scope rather than inventing an employment start date from migration timestamps.
insert into public.profile_store_assignment_periods(profile_id,store_id,effective_from,is_primary)
select access.profile_id,access.store_id,date '1900-01-01',access.store_id=profile.store_id
from public.profile_store_access access join public.profiles profile on profile.id=access.profile_id;

create function public.capture_profile_store_access_added()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if not exists(select 1 from public.profile_store_assignment_periods where profile_id=new.profile_id and store_id=new.store_id
    and effective_from<=v_today and (effective_to is null or effective_to>v_today)) then
    insert into public.profile_store_assignment_periods(profile_id,store_id,effective_from,updated_by)
    values(new.profile_id,new.store_id,v_today,auth.uid());
  end if;
  return new;
end;
$$;
create trigger profile_store_access_capture_added after insert on public.profile_store_access
for each row execute function public.capture_profile_store_access_added();

create function public.profile_store_ids_on(p_profile_id uuid,p_date date)
returns table(store_id uuid) language sql stable security definer set search_path = public as $$
  select distinct period.store_id from public.profile_store_assignment_periods period
  where period.profile_id = p_profile_id and period.effective_from <= p_date
    and (period.effective_to is null or period.effective_to > p_date);
$$;

create function public.apply_due_profile_store_assignments()
returns void language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  insert into public.profile_store_access(profile_id,store_id)
  select distinct period.profile_id,period.store_id from public.profile_store_assignment_periods period
  where period.effective_from <= v_today and (period.effective_to is null or period.effective_to > v_today)
  on conflict do nothing;
  delete from public.profile_store_access access where not exists (
    select 1 from public.profile_store_ids_on(access.profile_id,v_today) scope where scope.store_id=access.store_id
  );
  update public.profiles profile set store_id=(select scope.store_id from public.profile_store_ids_on(profile.id,v_today) scope order by scope.store_id limit 1)
  where not exists(select 1 from public.profile_store_ids_on(profile.id,v_today) scope where scope.store_id=profile.store_id)
    and exists(select 1 from public.profile_store_ids_on(profile.id,v_today));
end;
$$;

create function public.admin_end_profile_store(p_profile_id uuid,p_store_id uuid,p_effective_date date)
returns void language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if public.current_user_role() is distinct from 'admin' or not public.can_admin_manage_attendance_profile(p_profile_id)
     or not public.has_store_access(p_store_id) then raise exception 'profile store access denied'; end if;
  perform 1 from public.profiles where id=p_profile_id and deleted_at is null for update;
  if not found then raise exception 'profile not found'; end if;
  if p_effective_date is null or not exists(select 1 from public.profile_store_assignment_periods
    where profile_id=p_profile_id and store_id=p_store_id and effective_from<p_effective_date
      and (effective_to is null or effective_to>p_effective_date)) then
    raise exception '请选择该门店有效关联期间内的取消日期。';
  end if;
  -- Every future change boundary must retain at least one store; this also
  -- prevents two individually valid scheduled cancellations leaving no access.
  if exists (
    select 1 from (
      select greatest(p_effective_date,v_today) boundary
      union select effective_to from public.profile_store_assignment_periods where profile_id=p_profile_id and effective_to>=greatest(p_effective_date,v_today)
      union select effective_from from public.profile_store_assignment_periods where profile_id=p_profile_id and effective_from>=greatest(p_effective_date,v_today)
    ) dates where not exists(select 1 from public.profile_store_ids_on(p_profile_id,dates.boundary) scope where scope.store_id<>p_store_id)
  ) then raise exception '取消后必须至少保留一个有效关联门店。'; end if;
  update public.profile_store_assignment_periods set effective_to=p_effective_date,updated_by=auth.uid()
  where profile_id=p_profile_id and store_id=p_store_id and effective_from<p_effective_date
    and (effective_to is null or effective_to>p_effective_date);
  perform public.apply_due_profile_store_assignments();
end;
$$;

-- Preserve unchanged memberships when saving other employee fields. Readding
-- a previously ended store creates a new period without rewriting its history.
create or replace function public.admin_set_profile_stores(p_profile_id uuid,p_store_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if public.current_user_role() is distinct from 'admin' or not public.can_admin_manage_attendance_profile(p_profile_id) then raise exception 'admin permission required'; end if;
  if coalesce(cardinality(p_store_ids),0)=0 or array_position(p_store_ids,null) is not null then raise exception 'at least one store is required'; end if;
  if exists(select 1 from unnest(p_store_ids) requested(store_id) where not public.has_store_access(requested.store_id)) then raise exception 'cannot grant an inaccessible store'; end if;
  perform 1 from public.profiles where id=p_profile_id and deleted_at is null for update;
  if not found then raise exception 'profile not found'; end if;
  -- Same-day additions can be removed without deleting their audit/history row.
  update public.profile_store_assignment_periods set effective_to=v_today,updated_by=auth.uid()
  where profile_id=p_profile_id and not(store_id=any(p_store_ids)) and effective_from<=v_today
    and (effective_to is null or effective_to>v_today);
  insert into public.profile_store_assignment_periods(profile_id,store_id,effective_from,updated_by)
  select p_profile_id,requested.store_id,v_today,auth.uid() from (select distinct unnest(p_store_ids) store_id) requested
  where not exists(select 1 from public.profile_store_ids_on(p_profile_id,v_today) scope where scope.store_id=requested.store_id);
  perform public.apply_due_profile_store_assignments();
end;
$$;

create table public.attendance_sync_binding_days (
  corp_id text not null,
  profile_id uuid not null references public.profiles(id),
  store_id uuid not null references public.stores(id),
  attendance_date date not null,
  last_synced_at timestamptz not null default now(),
  primary key(corp_id,profile_id,store_id,attendance_date)
);
alter table public.attendance_sync_binding_days enable row level security;
grant all on public.attendance_sync_binding_days to service_role;
revoke all on public.attendance_sync_binding_days from anon,authenticated;
insert into public.attendance_sync_binding_days(corp_id,profile_id,store_id,attendance_date,last_synced_at)
select corp_id,profile_id,store_id,attendance_date,last_synced_at from public.attendance_daily_records;

revoke all on function public.profile_store_ids_on(uuid,date),public.apply_due_profile_store_assignments() from public,anon,authenticated;
revoke all on function public.capture_profile_store_access_added() from public,anon,authenticated;
revoke all on function public.admin_end_profile_store(uuid,uuid,date) from public,anon;
grant execute on function public.admin_end_profile_store(uuid,uuid,date) to authenticated;
grant execute on function public.apply_due_profile_store_assignments() to service_role;
select cron.schedule('storehub-apply-store-assignment-dates','0 16 * * *','select public.apply_due_profile_store_assignments()');

comment on table public.profile_store_assignment_periods is 'Employee store membership history. effective_to is the first unassociated date; historical records are retained.';
comment on table public.attendance_sync_binding_days is 'Successful per-binding fetch coverage, including dates without schedules or punches.';
