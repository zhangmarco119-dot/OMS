create table public.admin_task_reads (
  admin_profile_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (admin_profile_id, task_id)
);

create index admin_task_reads_task_idx
on public.admin_task_reads (task_id, read_at desc);

alter table public.admin_task_reads enable row level security;

create policy admin_task_reads_select_own
on public.admin_task_reads for select
to authenticated
using (
  admin_profile_id = auth.uid()
  and public.current_user_role() = 'admin'
  and public.can_view_task(task_id)
);

create policy admin_task_reads_insert_own
on public.admin_task_reads for insert
to authenticated
with check (
  admin_profile_id = auth.uid()
  and public.current_user_role() = 'admin'
  and public.can_view_task(task_id)
);

create policy admin_task_reads_update_own
on public.admin_task_reads for update
to authenticated
using (
  admin_profile_id = auth.uid()
  and public.current_user_role() = 'admin'
  and public.can_view_task(task_id)
)
with check (
  admin_profile_id = auth.uid()
  and public.current_user_role() = 'admin'
  and public.can_view_task(task_id)
);
