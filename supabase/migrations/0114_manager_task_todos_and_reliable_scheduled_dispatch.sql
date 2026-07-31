-- Keep manager review access aligned with the account's complete authorized-store scope.
-- Split one-off publication dispatch from recurring task creation so a malformed
-- recurring schedule can never roll back an otherwise due one-off publication.

create or replace function public.can_review_v2_task(p_task_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1
    from public.v2_tasks task
    left join public.profiles submitter on submitter.id = task.submitted_by
    where task.id = p_task_id
      and task.status in ('submitted', 'resubmitted')
      and public.has_store_access(task.store_id)
      and (
        public.current_user_role() = 'admin'
        or (
          public.current_user_role() = 'manager'
          and task.manager_review_enabled
          and coalesce(task.submitted_by_role, submitter.role) = 'staff'
        )
      )
  )
$$;

create or replace function public.can_read_v2_task(p_task_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1
    from public.v2_tasks task
    where task.id = p_task_id
      and public.has_store_access(task.store_id)
      and (
        public.current_user_role() = 'admin'
        or (
          task.publish_at <= now()
          and public.current_user_role() in ('staff', 'manager')
          and (
            task.assigned_profile_id = auth.uid()
            or (
              task.assigned_profile_id is null
              and public.v2_task_audience_for_profile(auth.uid()) = any(task.target_audiences)
            )
            or public.can_review_v2_task(task.id)
          )
        )
      )
  )
$$;

-- Older submissions pre-date submitted_by_role. Backfill them so manager review
-- lists and policies do not depend on a null compatibility value.
update public.v2_tasks task
set submitted_by_role = profile.role
from public.profiles profile
where task.submitted_by = profile.id
  and task.submitted_by_role is null;

create or replace function public.notify_v2_task_publication(p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.v2_tasks%rowtype;
begin
  select *
  into v_task
  from public.v2_tasks
  where id = p_task_id
  for update;

  if v_task.id is null
    or v_task.status = 'cancelled'
    or v_task.publish_at > now()
    or v_task.publish_notified_at is not null
  then
    return false;
  end if;

  insert into public.notifications(
    recipient_user_id,
    store_id,
    type,
    title,
    body,
    entity_type,
    entity_id,
    dedupe_key
  )
  select
    profile.id,
    v_task.store_id,
    'v2_task_published',
    case when v_task.schedule_id is null then '新任务：' else '新周期任务：' end || v_task.name,
    '截止时间：' || to_char(v_task.due_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI'),
    'v2_task',
    v_task.id,
    'v2-task-published:' || v_task.id || ':' || profile.id
  from public.profiles profile
  where profile.is_active
    and profile.deleted_at is null
    and profile.role in ('staff', 'manager')
    and (
      profile.store_id = v_task.store_id
      or exists(
        select 1
        from public.profile_store_access access
        where access.profile_id = profile.id
          and access.store_id = v_task.store_id
      )
    )
    and (
      v_task.assigned_profile_id = profile.id
      or (
        v_task.assigned_profile_id is null
        and public.v2_task_audience_for_profile(profile.id) = any(v_task.target_audiences)
      )
    )
  on conflict(dedupe_key) do nothing;

  update public.v2_tasks
  set publish_notified_at = now()
  where id = v_task.id;

  return true;
end;
$$;

create or replace function public.dispatch_v2_task_schedules()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.v2_task_schedules%rowtype;
  v_release timestamptz;
  v_due timestamptz;
  v_next timestamptz;
  v_created integer := 0;
begin
  for s in
    select *
    from public.v2_task_schedules
    where is_active
      and next_due_at <= now()
    for update skip locked
  loop
    begin
      v_release := s.next_due_at;
      v_due := public.v2_task_schedule_acceptance_due(s.id, v_release);

      while v_due <= now() loop
        v_release := public.v2_task_schedule_next_due(s.id, v_release);
        v_due := public.v2_task_schedule_acceptance_due(s.id, v_release);
      end loop;

      v_next := public.v2_task_schedule_next_due(s.id, v_release);
      if v_due >= v_next then
        update public.v2_task_schedules
        set is_active = false,
            paused_at = now()
        where id = s.id;
        continue;
      end if;

      perform public.create_v2_task_from_schedule(s.id, v_due);
      update public.v2_task_schedules
      set next_due_at = v_next,
          last_published_at = v_release
      where id = s.id;
      v_created := v_created + 1;
    exception
      when others then
        raise warning 'StoreHub task schedule % dispatch failed: %', s.id, sqlerrm;
    end;
  end loop;

  return v_created;
end;
$$;

do $$
declare
  job_id bigint;
begin
  for job_id in
    select jobid
    from cron.job
    where jobname in (
      'storehub-v2-task-publication-dispatch',
      'storehub-v2-task-schedule-dispatch'
    )
  loop
    perform cron.unschedule(job_id);
  end loop;

  perform cron.schedule(
    'storehub-v2-task-publication-dispatch',
    '* * * * *',
    'select public.dispatch_scheduled_v2_task_publications()'
  );
  perform cron.schedule(
    'storehub-v2-task-schedule-dispatch',
    '* * * * *',
    'select public.dispatch_v2_task_schedules()'
  );
end;
$$;
