create table public.v2_task_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('weekly_clean', 'monthly_clean', 'inspection', 'temporary')),
  description text not null default '',
  requires_review boolean not null default true,
  allow_overdue boolean not null default false,
  recurrence text not null default 'none' check (recurrence in ('none', 'weekly', 'monthly')),
  due_time time,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  current_version integer not null default 0 check (current_version >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (nullif(btrim(name), '') is not null)
);

create table public.v2_task_template_stores (
  template_id uuid not null references public.v2_task_templates(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (template_id, store_id)
);

create table public.v2_task_template_groups (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.v2_task_templates(id) on delete cascade,
  title text not null,
  description text not null default '',
  sort_order integer not null default 0 check (sort_order >= 0),
  check (nullif(btrim(title), '') is not null)
);

create table public.v2_task_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.v2_task_templates(id) on delete cascade,
  group_id uuid not null references public.v2_task_template_groups(id) on delete cascade,
  label text not null,
  guidance text not null default '',
  field_type text not null check (field_type in (
    'instruction', 'short_text', 'long_text', 'integer', 'decimal', 'boolean',
    'single_choice', 'multi_choice', 'image', 'multi_image', 'confirmation', 'rating'
  )),
  is_required boolean not null default true,
  image_requirement text not null default 'none' check (image_requirement in ('none', 'single', 'multiple')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  sort_order integer not null default 0 check (sort_order >= 0),
  check (nullif(btrim(label), '') is not null)
);

create table public.v2_task_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.v2_task_templates(id),
  version_number integer not null check (version_number > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  published_by uuid not null references public.profiles(id),
  published_at timestamptz not null default now(),
  unique (template_id, version_number)
);

create index v2_task_templates_status_category_idx
on public.v2_task_templates (status, category, updated_at desc);
create index v2_task_template_stores_store_idx
on public.v2_task_template_stores (store_id, template_id);
create index v2_task_template_groups_template_sort_idx
on public.v2_task_template_groups (template_id, sort_order);
create index v2_task_template_items_template_group_sort_idx
on public.v2_task_template_items (template_id, group_id, sort_order);
create index v2_task_template_versions_template_idx
on public.v2_task_template_versions (template_id, version_number desc);

create trigger v2_task_templates_touch_updated_at
before update on public.v2_task_templates
for each row execute function public.touch_updated_at();

create or replace function public.can_manage_v2_task_template(target_template_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() = 'admin'
    and exists (
      select 1 from public.v2_task_templates template
      where template.id = target_template_id
    )
    and not exists (
      select 1
      from public.v2_task_template_stores assignment
      where assignment.template_id = target_template_id
        and not public.has_store_access(assignment.store_id)
    )
$$;

create or replace function public.can_view_v2_task_template(target_template_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.can_manage_v2_task_template(target_template_id)
    or exists (
      select 1
      from public.v2_task_templates template
      join public.v2_task_template_stores assignment on assignment.template_id = template.id
      where template.id = target_template_id
        and template.status = 'published'
        and public.current_user_role() in ('staff', 'manager')
        and assignment.store_id = public.current_user_store_id()
        and public.has_store_access(assignment.store_id)
    )
$$;

alter table public.v2_task_templates enable row level security;
alter table public.v2_task_template_stores enable row level security;
alter table public.v2_task_template_groups enable row level security;
alter table public.v2_task_template_items enable row level security;
alter table public.v2_task_template_versions enable row level security;

create policy v2_task_templates_select_allowed
on public.v2_task_templates for select to authenticated
using (public.can_view_v2_task_template(id));

create policy v2_task_template_stores_select_allowed
on public.v2_task_template_stores for select to authenticated
using (public.can_view_v2_task_template(template_id));

create policy v2_task_template_groups_select_allowed
on public.v2_task_template_groups for select to authenticated
using (public.can_view_v2_task_template(template_id));

create policy v2_task_template_items_select_allowed
on public.v2_task_template_items for select to authenticated
using (public.can_view_v2_task_template(template_id));

create policy v2_task_template_versions_select_allowed
on public.v2_task_template_versions for select to authenticated
using (public.can_view_v2_task_template(template_id));

create or replace function public.save_v2_task_template(
  p_template_id uuid,
  p_fields jsonb,
  p_store_ids uuid[],
  p_groups jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.v2_task_templates%rowtype;
  v_store_id uuid;
  v_group jsonb;
  v_item jsonb;
  v_group_id uuid;
  v_item_id uuid;
  v_name text := btrim(coalesce(p_fields ->> 'name', ''));
  v_category text := coalesce(p_fields ->> 'category', '');
  v_recurrence text := coalesce(p_fields ->> 'recurrence', 'none');
  v_due_time time;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'template name is required' using errcode = '22023';
  end if;
  if v_category not in ('weekly_clean', 'monthly_clean', 'inspection', 'temporary') then
    raise exception 'invalid template category' using errcode = '22023';
  end if;
  if v_recurrence not in ('none', 'weekly', 'monthly') then
    raise exception 'invalid template recurrence' using errcode = '22023';
  end if;
  if coalesce(array_length(p_store_ids, 1), 0) = 0 then
    raise exception 'at least one store is required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_groups, '[]'::jsonb)) <> 'array' then
    raise exception 'template groups must be an array' using errcode = '22023';
  end if;

  foreach v_store_id in array p_store_ids loop
    if not public.has_store_access(v_store_id)
      or not exists (select 1 from public.stores where id = v_store_id and is_active) then
      raise exception 'administrator store access required' using errcode = '42501';
    end if;
  end loop;

  if nullif(p_fields ->> 'due_time', '') is not null then
    v_due_time := (p_fields ->> 'due_time')::time;
  end if;

  if p_template_id is null then
    insert into public.v2_task_templates (
      name, category, description, requires_review, allow_overdue, recurrence,
      due_time, status, created_by
    ) values (
      v_name, v_category, coalesce(p_fields ->> 'description', ''),
      coalesce((p_fields ->> 'requires_review')::boolean, true),
      coalesce((p_fields ->> 'allow_overdue')::boolean, false),
      v_recurrence, v_due_time, 'draft', auth.uid()
    ) returning * into v_template;
  else
    select * into v_template
    from public.v2_task_templates
    where id = p_template_id
    for update;

    if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then
      raise exception 'task template not found or access denied' using errcode = '42501';
    end if;
    if v_template.status = 'archived' then
      raise exception 'archived task template cannot be edited' using errcode = '55000';
    end if;

    update public.v2_task_templates
    set name = v_name,
        category = v_category,
        description = coalesce(p_fields ->> 'description', ''),
        requires_review = coalesce((p_fields ->> 'requires_review')::boolean, true),
        allow_overdue = coalesce((p_fields ->> 'allow_overdue')::boolean, false),
        recurrence = v_recurrence,
        due_time = v_due_time,
        status = 'draft'
    where id = v_template.id
    returning * into v_template;

    delete from public.v2_task_template_stores where template_id = v_template.id;
    delete from public.v2_task_template_groups where template_id = v_template.id;
  end if;

  insert into public.v2_task_template_stores (template_id, store_id)
  select v_template.id, store_id
  from unnest(p_store_ids) store_id
  group by store_id;

  for v_group in select value from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) loop
    if btrim(coalesce(v_group ->> 'title', '')) = '' then
      raise exception 'template group title is required' using errcode = '22023';
    end if;
    v_group_id := coalesce(nullif(v_group ->> 'id', '')::uuid, gen_random_uuid());
    insert into public.v2_task_template_groups (id, template_id, title, description, sort_order)
    values (
      v_group_id, v_template.id, btrim(v_group ->> 'title'),
      coalesce(v_group ->> 'description', ''), coalesce((v_group ->> 'sort_order')::integer, 0)
    );

    for v_item in select value from jsonb_array_elements(coalesce(v_group -> 'items', '[]'::jsonb)) loop
      if btrim(coalesce(v_item ->> 'label', '')) = '' then
        raise exception 'template item label is required' using errcode = '22023';
      end if;
      if coalesce(v_item ->> 'field_type', '') not in (
        'instruction', 'short_text', 'long_text', 'integer', 'decimal', 'boolean',
        'single_choice', 'multi_choice', 'image', 'multi_image', 'confirmation', 'rating'
      ) then
        raise exception 'invalid template item field type' using errcode = '22023';
      end if;
      if coalesce(v_item ->> 'image_requirement', 'none') not in ('none', 'single', 'multiple') then
        raise exception 'invalid image requirement' using errcode = '22023';
      end if;
      v_item_id := coalesce(nullif(v_item ->> 'id', '')::uuid, gen_random_uuid());
      insert into public.v2_task_template_items (
        id, template_id, group_id, label, guidance, field_type,
        is_required, image_requirement, options, sort_order
      ) values (
        v_item_id, v_template.id, v_group_id, btrim(v_item ->> 'label'),
        coalesce(v_item ->> 'guidance', ''), v_item ->> 'field_type',
        coalesce((v_item ->> 'is_required')::boolean, true),
        coalesce(v_item ->> 'image_requirement', 'none'),
        coalesce(v_item -> 'options', '[]'::jsonb),
        coalesce((v_item ->> 'sort_order')::integer, 0)
      );
    end loop;
  end loop;

  foreach v_store_id in array p_store_ids loop
    insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata)
    values (
      v_store_id, auth.uid(), 'v2_task_template_saved', 'v2_task_templates', v_template.id,
      jsonb_build_object('name', v_template.name, 'category', v_template.category)
    );
  end loop;

  return to_jsonb(v_template);
end;
$$;

create or replace function public.publish_v2_task_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.v2_task_templates%rowtype;
  v_snapshot jsonb;
  v_next_version integer;
  v_store_id uuid;
begin
  select * into v_template
  from public.v2_task_templates
  where id = p_template_id
  for update;

  if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then
    raise exception 'task template not found or access denied' using errcode = '42501';
  end if;
  if v_template.status = 'archived' then
    raise exception 'archived task template cannot be published' using errcode = '55000';
  end if;
  if not exists (select 1 from public.v2_task_template_stores where template_id = v_template.id) then
    raise exception 'template requires at least one store' using errcode = '23514';
  end if;
  if not exists (select 1 from public.v2_task_template_items where template_id = v_template.id) then
    raise exception 'template requires at least one item' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.v2_task_template_items
    where template_id = v_template.id
      and field_type in ('single_choice', 'multi_choice')
      and jsonb_array_length(options) = 0
  ) then
    raise exception 'choice items require options' using errcode = '23514';
  end if;

  select jsonb_build_object(
    'template', jsonb_build_object(
      'id', v_template.id, 'name', v_template.name, 'category', v_template.category,
      'description', v_template.description, 'requires_review', v_template.requires_review,
      'allow_overdue', v_template.allow_overdue, 'recurrence', v_template.recurrence,
      'due_time', v_template.due_time
    ),
    'store_ids', (
      select coalesce(jsonb_agg(store_id order by store_id), '[]'::jsonb)
      from public.v2_task_template_stores where template_id = v_template.id
    ),
    'groups', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', template_group.id, 'title', template_group.title,
        'description', template_group.description, 'sort_order', template_group.sort_order,
        'items', (
          select coalesce(jsonb_agg(to_jsonb(item) - 'template_id' - 'group_id' order by item.sort_order, item.id), '[]'::jsonb)
          from public.v2_task_template_items item where item.group_id = template_group.id
        )
      ) order by template_group.sort_order, template_group.id), '[]'::jsonb)
      from public.v2_task_template_groups template_group where template_group.template_id = v_template.id
    )
  ) into v_snapshot;

  v_next_version := v_template.current_version + 1;
  insert into public.v2_task_template_versions (
    template_id, version_number, snapshot, published_by
  ) values (v_template.id, v_next_version, v_snapshot, auth.uid());

  update public.v2_task_templates
  set status = 'published', current_version = v_next_version
  where id = v_template.id
  returning * into v_template;

  for v_store_id in select store_id from public.v2_task_template_stores where template_id = v_template.id loop
    insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata)
    values (
      v_store_id, auth.uid(), 'v2_task_template_published', 'v2_task_templates', v_template.id,
      jsonb_build_object('name', v_template.name, 'version', v_next_version)
    );
  end loop;

  return jsonb_build_object('template', to_jsonb(v_template), 'version', v_next_version);
end;
$$;

create or replace function public.archive_v2_task_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.v2_task_templates%rowtype;
begin
  if not public.can_manage_v2_task_template(p_template_id) then
    raise exception 'task template not found or access denied' using errcode = '42501';
  end if;
  update public.v2_task_templates set status = 'archived'
  where id = p_template_id returning * into v_template;
  return to_jsonb(v_template);
end;
$$;

revoke all on function public.can_manage_v2_task_template(uuid) from public;
revoke all on function public.can_view_v2_task_template(uuid) from public;
revoke all on function public.save_v2_task_template(uuid, jsonb, uuid[], jsonb) from public;
revoke all on function public.publish_v2_task_template(uuid) from public;
revoke all on function public.archive_v2_task_template(uuid) from public;

grant execute on function public.can_manage_v2_task_template(uuid) to authenticated;
grant execute on function public.can_view_v2_task_template(uuid) to authenticated;
grant execute on function public.save_v2_task_template(uuid, jsonb, uuid[], jsonb) to authenticated;
grant execute on function public.publish_v2_task_template(uuid) to authenticated;
grant execute on function public.archive_v2_task_template(uuid) to authenticated;

grant select on public.v2_task_templates to authenticated;
grant select on public.v2_task_template_stores to authenticated;
grant select on public.v2_task_template_groups to authenticated;
grant select on public.v2_task_template_items to authenticated;
grant select on public.v2_task_template_versions to authenticated;
