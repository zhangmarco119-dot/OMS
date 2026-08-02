-- Validate task-image uploads against the task encoded in the object path.
-- This is stricter and more reliable than comparing against the mutable
-- current store selected in another browser session.

create or replace function public.can_upload_v2_task_image_path(p_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1
    from public.v2_tasks task
    where task.store_id::text = split_part(p_name, '/', 1)
      and task.id::text = split_part(p_name, '/', 2)
      and public.can_edit_v2_task(task.id)
  )
$$;

revoke all on function public.can_upload_v2_task_image_path(text) from public, anon;
grant execute on function public.can_upload_v2_task_image_path(text) to authenticated;

drop policy if exists v2_task_storage_insert on storage.objects;
create policy v2_task_storage_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'v2-task-images'
  and public.can_upload_v2_task_image_path(name)
);

