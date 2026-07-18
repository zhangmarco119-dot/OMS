-- Allow a published task to keep one live editable definition while template
-- versions remain immutable. Existing employee input is protected from
-- destructive field changes.

create or replace function public.can_manage_v2_task_content_asset(p_asset_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() = 'admin' and (
    exists(select 1 from public.v2_tasks task where task.id = p_asset_id and public.has_store_access(task.store_id))
    or exists(select 1 from public.v2_task_schedules schedule where schedule.id = p_asset_id and public.has_store_access(schedule.store_id))
  )
$$;

revoke all on function public.can_manage_v2_task_content_asset(uuid) from public, anon;
grant execute on function public.can_manage_v2_task_content_asset(uuid) to authenticated;

drop policy if exists v2_task_template_reference_image_select on storage.objects;
create policy v2_task_template_reference_image_select on storage.objects for select to authenticated using (
  bucket_id = 'v2-task-template-reference-images' and (
    exists(select 1 from public.v2_task_template_items item where (item.reference_image_path = name or name = any(item.reference_image_paths)) and public.can_manage_v2_task_template(item.template_id))
    or exists(select 1 from public.v2_task_answers answer where (answer.item_snapshot ->> 'reference_image_path' = name or (answer.item_snapshot -> 'reference_image_paths') ? name) and public.can_read_v2_task(answer.task_id))
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.can_manage_v2_task_content_asset((storage.foldername(name))[1]::uuid)
    )
  )
);

drop policy if exists v2_task_template_reference_image_insert on storage.objects;
create policy v2_task_template_reference_image_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'v2-task-template-reference-images'
  and public.current_user_role() = 'admin'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (
    public.can_manage_v2_task_template((storage.foldername(name))[1]::uuid)
    or public.can_manage_v2_task_content_asset((storage.foldername(name))[1]::uuid)
  )
);

drop policy if exists v2_task_template_reference_image_delete on storage.objects;
create policy v2_task_template_reference_image_delete on storage.objects for delete to authenticated using (
  bucket_id = 'v2-task-template-reference-images'
  and public.current_user_role() = 'admin'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (
    public.can_manage_v2_task_template((storage.foldername(name))[1]::uuid)
    or public.can_manage_v2_task_content_asset((storage.foldername(name))[1]::uuid)
  )
);

create or replace function public.apply_v2_task_content(p_task_id uuid, p_name text, p_snapshot jsonb, p_due_at timestamptz default null)
returns public.v2_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.v2_tasks%rowtype;
  v_snapshot jsonb;
  v_group jsonb;
  v_item jsonb;
  v_item_id uuid;
  v_group_id uuid;
  v_snapshot_count integer;
  v_snapshot_unique integer;
begin
  select * into v_task from public.v2_tasks where id = p_task_id for update;
  if v_task.id is null then raise exception '任务不存在'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception '请填写任务名称'; end if;
  if jsonb_typeof(p_snapshot) <> 'object' or jsonb_typeof(p_snapshot -> 'groups') <> 'array' or jsonb_array_length(p_snapshot -> 'groups') = 0 then
    raise exception '任务至少需要一个分组';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_snapshot -> 'groups') group_value
    where coalesce(group_value ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or btrim(coalesce(group_value ->> 'title', '')) = ''
      or jsonb_typeof(group_value -> 'items') <> 'array'
      or jsonb_array_length(group_value -> 'items') = 0
  ) then raise exception '请完善任务分组名称和项目'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_snapshot -> 'groups') group_value
    cross join lateral jsonb_array_elements(group_value -> 'items') item_value
    where coalesce(item_value ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or btrim(coalesce(item_value ->> 'label', '')) = ''
  ) then raise exception '每个任务项目都需要填写名称'; end if;

  select count(*), count(distinct (item_value ->> 'id')::uuid)
  into v_snapshot_count, v_snapshot_unique
  from jsonb_array_elements(p_snapshot -> 'groups') group_value
  cross join lateral jsonb_array_elements(group_value -> 'items') item_value;
  if v_snapshot_count <> v_snapshot_unique then raise exception '任务项目编号不能重复'; end if;
  if p_due_at is not null and p_due_at <= now() then raise exception '验收截止时间必须晚于当前时间'; end if;

  -- An item that already contains employee work cannot be deleted. The admin
  -- can still change its wording, required flag, image rule and references.
  if exists(
    select 1 from public.v2_task_answers answer
    where answer.task_id = p_task_id
      and not exists(
        select 1 from jsonb_array_elements(p_snapshot -> 'groups') group_value
        cross join lateral jsonb_array_elements(group_value -> 'items') item_value
        where (item_value ->> 'id')::uuid = answer.item_id
      )
      and (
        (answer.answer is not null and answer.answer <> 'null'::jsonb)
        or btrim(answer.note) <> ''
        or answer.is_issue
        or exists(select 1 from public.v2_task_images image where image.task_id = p_task_id and image.item_id = answer.item_id)
        or exists(select 1 from public.v2_task_item_reviews review where review.task_id = p_task_id and review.item_id = answer.item_id)
      )
  ) then raise exception '已有员工填写内容的项目不能删除，请保留该项目或先修改为非必填'; end if;

  -- Changing a completed answer to another field type could make the stored
  -- value invalid, so only unanswered items may change type.
  if exists(
    select 1 from public.v2_task_answers answer
    join lateral (
      select item_value
      from jsonb_array_elements(p_snapshot -> 'groups') group_value
      cross join lateral jsonb_array_elements(group_value -> 'items') item_value
      where (item_value ->> 'id')::uuid = answer.item_id
    ) source on true
    where answer.task_id = p_task_id
      and coalesce(source.item_value ->> 'field_type', '') <> coalesce(answer.item_snapshot ->> 'field_type', '')
      and ((answer.answer is not null and answer.answer <> 'null'::jsonb) or exists(select 1 from public.v2_task_images image where image.task_id = p_task_id and image.item_id = answer.item_id))
  ) then raise exception '已有员工填写内容的项目不能改变字段类型'; end if;

  v_snapshot := p_snapshot || jsonb_build_object(
    'template', coalesce(p_snapshot -> 'template', '{}'::jsonb) || jsonb_build_object('name', btrim(p_name))
  );
  update public.v2_tasks
  set name = btrim(p_name),
    category = coalesce(nullif(v_snapshot -> 'template' ->> 'category', ''), category),
    snapshot = v_snapshot,
    due_at = coalesce(p_due_at, due_at),
    allow_overdue = coalesce((v_snapshot -> 'template' ->> 'allow_overdue')::boolean, allow_overdue),
    requires_review = coalesce((v_snapshot -> 'template' ->> 'requires_review')::boolean, requires_review),
    correction_item_ids = array(select item_id from unnest(correction_item_ids) item_id where exists(
      select 1 from jsonb_array_elements(v_snapshot -> 'groups') group_value
      cross join lateral jsonb_array_elements(group_value -> 'items') item_value
      where (item_value ->> 'id')::uuid = item_id
    )),
    version = version + 1
  where id = p_task_id
  returning * into v_task;

  delete from public.v2_task_answers answer
  where answer.task_id = p_task_id and not exists(
    select 1 from jsonb_array_elements(v_snapshot -> 'groups') group_value
    cross join lateral jsonb_array_elements(group_value -> 'items') item_value
    where (item_value ->> 'id')::uuid = answer.item_id
  );

  for v_group in select value from jsonb_array_elements(v_snapshot -> 'groups') loop
    v_group_id := (v_group ->> 'id')::uuid;
    for v_item in select value from jsonb_array_elements(v_group -> 'items') loop
      v_item_id := (v_item ->> 'id')::uuid;
      insert into public.v2_task_answers(task_id, item_id, group_id, item_snapshot)
      values(p_task_id, v_item_id, v_group_id, v_item)
      on conflict(task_id, item_id) do update
      set group_id = excluded.group_id,
        item_snapshot = excluded.item_snapshot,
        updated_at = now();
    end loop;
  end loop;
  return v_task;
end;
$$;

revoke all on function public.apply_v2_task_content(uuid, text, jsonb, timestamptz) from public, anon, authenticated;
