-- Store manager task publishing support.

alter table public.v2_task_templates add column if not exists publisher_role text not null default 'admin'
  check (publisher_role in ('admin', 'manager'));

alter table public.v2_tasks add column if not exists publisher_role text not null default 'admin'
  check (publisher_role in ('admin', 'manager'));

update public.v2_task_templates set publisher_role = 'admin' where publisher_role is null;
update public.v2_tasks set publisher_role = 'admin' where publisher_role is null;

-- Let a manager manage templates they created as manager scope.
create or replace function public.can_manage_v2_task_template(target_template_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.v2_task_templates template
    where template.id = target_template_id
      and (
        public.current_user_role() = 'admin'
        or (
          public.current_user_role() = 'manager'
          and template.publisher_role = 'manager'
          and template.created_by = auth.uid()
        )
      )
      and not exists (
        select 1 from public.v2_task_template_stores assignment
        where assignment.template_id = target_template_id
          and not public.has_store_access(assignment.store_id)
      )
  )
$$;

-- Manager-created draft template with one required long-text instruction item.
create or replace function public.manager_save_v2_task_template(
  p_name text,
  p_category text,
  p_description text,
  p_requires_review boolean,
  p_allow_overdue boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_template public.v2_task_templates;
  v_group_id uuid;
begin
  if public.current_user_role() <> 'manager' then
    raise exception 'store manager permission required' using errcode = '42501';
  end if;
  select current_user_store_id() into v_store_id;
  if v_store_id is null or not public.has_store_access(v_store_id) then
    raise exception 'store access denied' using errcode = '42501';
  end if;
  if btrim(p_name) = '' then raise exception '任务名称不能为空' using errcode = '22023'; end if;
  if p_category not in ('weekly_clean', 'monthly_clean', 'inspection', 'temporary') then
    raise exception '无效的任务分类' using errcode = '22023';
  end if;

  insert into public.v2_task_templates(
    name, category, description, requires_review, allow_overdue,
    recurrence, recurrence_day, due_time, status, created_by, publisher_role
  ) values (
    btrim(p_name), p_category, coalesce(p_description, ''),
    coalesce(p_requires_review, true), coalesce(p_allow_overdue, false),
    'none', null, null, 'draft', auth.uid(), 'manager'
  ) returning * into v_template;

  insert into public.v2_task_template_stores(template_id, store_id)
  values (v_template.id, v_store_id);

  insert into public.v2_task_template_groups(id, template_id, title, description, sort_order)
  values (gen_random_uuid(), v_template.id, '任务说明', '', 0)
  returning id into v_group_id;

  insert into public.v2_task_template_items(
    id, template_id, group_id, label, guidance, field_type,
    is_required, image_requirement, options, sort_order
  ) values (
    gen_random_uuid(), v_template.id, v_group_id, '任务说明',
    '请填写任务完成说明', 'long_text', true, 'none', '[]'::jsonb, 0
  );

  return to_jsonb(v_template);
end;
$$;

-- Publish a published manager template to the manager's current store.
create or replace function public.manager_publish_v2_tasks(p_template_id uuid, p_due_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.v2_task_templates;
  v_version public.v2_task_template_versions;
  v_store_id uuid;
  v_task public.v2_tasks;
  v_group jsonb;
  v_item jsonb;
begin
  if public.current_user_role() <> 'manager' then
    raise exception 'store manager permission required' using errcode = '42501';
  end if;
  select current_user_store_id() into v_store_id;
  if v_store_id is null or not public.has_store_access(v_store_id) then
    raise exception 'store access denied' using errcode = '42501';
  end if;

  select * into v_template from public.v2_task_templates
  where id = p_template_id and status = 'published';
  if v_template.id is null
    or v_template.publisher_role <> 'manager'
    or v_template.created_by <> auth.uid()
    or not public.can_manage_v2_task_template(v_template.id)
  then
    raise exception '已发布且属于本人的店长模板才可发布任务' using errcode = '42501';
  end if;

  if not exists(
    select 1 from public.v2_task_template_stores
    where template_id = v_template.id and store_id = v_store_id
  ) then
    raise exception '模板不属于当前门店' using errcode = '42501';
  end if;
  if p_due_at <= now() then
    raise exception '任务截止时间必须晚于当前时间' using errcode = '22023';
  end if;

  select * into v_version from public.v2_task_template_versions
  where template_id = v_template.id and version_number = v_template.current_version;

  insert into public.v2_tasks(
    template_id, template_version_id, store_id, name, category, snapshot,
    due_at, allow_overdue, requires_review, created_by, publisher_role
  ) values (
    v_template.id, v_version.id, v_store_id, v_template.name, v_template.category,
    v_version.snapshot, p_due_at, v_template.allow_overdue, v_template.requires_review,
    auth.uid(), 'manager'
  ) returning * into v_task;

  for v_group in select value from jsonb_array_elements(v_version.snapshot->'groups') loop
    for v_item in select value from jsonb_array_elements(v_group->'items') loop
      insert into public.v2_task_answers(task_id, item_id, group_id, item_snapshot)
      values(v_task.id, (v_item->>'id')::uuid, (v_group->>'id')::uuid, v_item);
    end loop;
  end loop;

  insert into public.notifications(recipient_role, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  values('admin', v_store_id, 'manager_task_published', '店长已发布任务', v_template.name, 'v2_task', v_task.id, 'manager-task:' || v_task.id)
  on conflict (dedupe_key) do nothing;

  return to_jsonb(v_task);
end;
$$;

revoke all on function public.manager_save_v2_task_template(text, text, text, boolean, boolean),
  public.manager_publish_v2_tasks(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.manager_save_v2_task_template(text, text, text, boolean, boolean),
  public.manager_publish_v2_tasks(uuid, timestamptz)
to authenticated;
