create extension if not exists pgcrypto;

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  username text not null unique,
  display_name text not null,
  role text not null check (role in ('staff', 'manager', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_store_access (
  admin_profile_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (admin_profile_id, store_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  spec text not null,
  count_unit text not null,
  product_code text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, product_code),
  unique (store_id, name, spec, count_unit)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  task_type text not null check (task_type in ('inventory', 'order')),
  status text not null default 'draft' check (status in ('draft', 'review', 'submitted', 'cancelled')),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  export_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'submitted' and submitted_at is not null) or (status <> 'submitted'))
);

create table public.task_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid references public.products(id),
  product_snapshot jsonb not null,
  quantity numeric(12, 2),
  status text not null default 'pending' check (status in ('pending', 'completed', 'no_order_needed')),
  staff_note text,
  is_extra_item boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (quantity is null or quantity >= 0),
  check (
    (status = 'pending' and quantity is null)
    or (status = 'completed')
    or (status = 'no_order_needed' and quantity is null)
  )
);

create table public.product_feedback (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  task_item_id uuid not null references public.task_items(id) on delete cascade,
  feedback_type text not null check (feedback_type in ('discontinued', 'incorrect', 'new')),
  original_snapshot jsonb not null,
  suggested_changes jsonb not null default '{}'::jsonb,
  note text,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  handled_by uuid references public.profiles(id),
  handled_at timestamptz,
  resolution_note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_table text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index products_store_sort_idx on public.products (store_id, is_active, sort_order, name);
create index tasks_store_type_status_idx on public.tasks (store_id, task_type, status, updated_at desc);
create index tasks_created_by_idx on public.tasks (created_by, updated_at desc);
create index task_items_task_sort_idx on public.task_items (task_id, sort_order);
create index task_items_store_status_idx on public.task_items (store_id, status);
create index product_feedback_store_type_idx on public.product_feedback (store_id, feedback_type, created_at desc);
create index product_feedback_store_status_idx on public.product_feedback (store_id, status, created_at desc);
create index audit_logs_store_created_idx on public.audit_logs (store_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger products_touch_updated_at
before update on public.products
for each row execute function public.touch_updated_at();

create trigger tasks_touch_updated_at
before update on public.tasks
for each row execute function public.touch_updated_at();

create trigger task_items_touch_updated_at
before update on public.task_items
for each row execute function public.touch_updated_at();

create or replace function public.validate_task_item_store()
returns trigger
language plpgsql
as $$
declare
  task_store_id uuid;
begin
  select store_id into task_store_id from public.tasks where id = new.task_id;
  if task_store_id is null or task_store_id <> new.store_id then
    raise exception 'task item store_id must match parent task store_id';
  end if;
  return new;
end;
$$;

create trigger task_items_validate_store
before insert or update on public.task_items
for each row execute function public.validate_task_item_store();

create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid() and is_active = true
$$;

create or replace function public.current_user_store_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select store_id from public.profiles where id = auth.uid() and is_active = true
$$;

create or replace function public.has_store_access(target_store_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        p.store_id = target_store_id
        or (
          p.role = 'admin'
          and exists (
            select 1
            from public.admin_store_access asa
            where asa.admin_profile_id = p.id
              and asa.store_id = target_store_id
          )
        )
      )
  )
$$;

create or replace function public.can_manage_store(target_store_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        (p.role = 'manager' and p.store_id = target_store_id)
        or (
          p.role = 'admin'
          and exists (
            select 1
            from public.admin_store_access asa
            where asa.admin_profile_id = p.id
              and asa.store_id = target_store_id
          )
        )
      )
  )
$$;

create or replace function public.can_view_task(target_task_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.tasks t
    join public.profiles p on p.id = auth.uid()
    where t.id = target_task_id
      and p.is_active = true
      and public.has_store_access(t.store_id)
      and (
        t.created_by = auth.uid()
        or p.role in ('manager', 'admin')
      )
  )
$$;

create or replace function public.can_modify_task(target_task_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.tasks t
    join public.profiles p on p.id = auth.uid()
    where t.id = target_task_id
      and p.is_active = true
      and t.status <> 'submitted'
      and public.has_store_access(t.store_id)
      and (
        t.created_by = auth.uid()
        or p.role in ('manager', 'admin')
      )
  )
$$;

alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.admin_store_access enable row level security;
alter table public.products enable row level security;
alter table public.tasks enable row level security;
alter table public.task_items enable row level security;
alter table public.product_feedback enable row level security;
alter table public.audit_logs enable row level security;

create policy stores_select_accessible
on public.stores for select
to authenticated
using (public.has_store_access(id));

create policy profiles_select_accessible
on public.profiles for select
to authenticated
using (id = auth.uid() or public.can_manage_store(store_id));

create policy profiles_update_admin
on public.profiles for update
to authenticated
using (public.current_user_role() = 'admin' and public.has_store_access(store_id))
with check (public.current_user_role() = 'admin' and public.has_store_access(store_id));

create policy admin_store_access_select
on public.admin_store_access for select
to authenticated
using (admin_profile_id = auth.uid() or public.can_manage_store(store_id));

create policy products_select_store
on public.products for select
to authenticated
using (public.has_store_access(store_id));

create policy products_insert_manager
on public.products for insert
to authenticated
with check (public.can_manage_store(store_id));

create policy products_update_manager
on public.products for update
to authenticated
using (public.can_manage_store(store_id))
with check (public.can_manage_store(store_id));

create policy products_delete_admin
on public.products for delete
to authenticated
using (public.current_user_role() = 'admin' and public.has_store_access(store_id));

create policy tasks_select_allowed
on public.tasks for select
to authenticated
using (
  public.has_store_access(store_id)
  and (
    created_by = auth.uid()
    or public.current_user_role() in ('manager', 'admin')
  )
);

create policy tasks_insert_own_draft
on public.tasks for insert
to authenticated
with check (
  public.has_store_access(store_id)
  and created_by = auth.uid()
  and status = 'draft'
);

create policy tasks_update_allowed
on public.tasks for update
to authenticated
using (
  status <> 'submitted'
  and public.has_store_access(store_id)
  and (
    created_by = auth.uid()
    or public.current_user_role() in ('manager', 'admin')
  )
)
with check (
  public.has_store_access(store_id)
  and (
    created_by = auth.uid()
    or public.current_user_role() in ('manager', 'admin')
  )
);

create policy tasks_delete_draft_allowed
on public.tasks for delete
to authenticated
using (
  status = 'draft'
  and public.has_store_access(store_id)
  and (
    created_by = auth.uid()
    or public.current_user_role() in ('manager', 'admin')
  )
);

create policy task_items_select_allowed
on public.task_items for select
to authenticated
using (public.can_view_task(task_id));

create policy task_items_insert_allowed
on public.task_items for insert
to authenticated
with check (
  public.has_store_access(store_id)
  and public.can_modify_task(task_id)
);

create policy task_items_update_allowed
on public.task_items for update
to authenticated
using (public.can_modify_task(task_id))
with check (
  public.has_store_access(store_id)
  and public.can_modify_task(task_id)
);

create policy task_items_delete_allowed
on public.task_items for delete
to authenticated
using (public.can_modify_task(task_id));

create policy product_feedback_select_allowed
on public.product_feedback for select
to authenticated
using (
  public.has_store_access(store_id)
  and (
    created_by = auth.uid()
    or public.current_user_role() in ('manager', 'admin')
  )
);

create policy product_feedback_insert_allowed
on public.product_feedback for insert
to authenticated
with check (
  public.has_store_access(store_id)
  and created_by = auth.uid()
  and public.can_view_task((select task_id from public.task_items where id = task_item_id))
);

create policy product_feedback_update_manager
on public.product_feedback for update
to authenticated
using (public.can_manage_store(store_id))
with check (public.can_manage_store(store_id));

create policy audit_logs_select_manager
on public.audit_logs for select
to authenticated
using (store_id is not null and public.can_manage_store(store_id));

create policy audit_logs_insert_actor
on public.audit_logs for insert
to authenticated
with check (
  actor_id = auth.uid()
  and (store_id is null or public.has_store_access(store_id))
);
