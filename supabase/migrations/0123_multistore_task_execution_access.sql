-- Keep task execution stable for multi-store accounts. The selected current
-- store is shared by all sessions of one profile, so another tab/device may
-- change it while an employee is already completing a task. Task permissions
-- must follow explicit store access and the task recipient rules instead.

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

create or replace function public.can_edit_v2_task(p_task_id uuid)
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
      and task.publish_at <= now()
      and public.current_user_role() in ('staff', 'manager')
      and public.has_store_access(task.store_id)
      and (
        task.assigned_profile_id = auth.uid()
        or (
          task.assigned_profile_id is null
          and public.v2_task_audience_for_profile(auth.uid()) = any(task.target_audiences)
        )
      )
      and (
        task.status in ('pending', 'in_progress', 'rejected')
        or (task.status = 'overdue' and task.allow_overdue)
      )
  )
$$;

-- Image paths already start with the task's store id. Accept uploads for any
-- explicitly authorised store instead of only the profile's mutable current
-- store; metadata insertion still requires can_edit_v2_task(task_id).
drop policy if exists v2_task_storage_insert on storage.objects;
create policy v2_task_storage_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'v2-task-images'
  and exists(
    select 1
    from public.stores store
    where store.id::text = (storage.foldername(name))[1]
      and public.has_store_access(store.id)
  )
);

