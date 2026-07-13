-- Optional reference images are attached to immutable template item snapshots.
alter table public.v2_task_template_items
  add column if not exists reference_image_path text;

create or replace function public.save_v2_task_template(p_template_id uuid, p_fields jsonb, p_store_ids uuid[], p_groups jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_template public.v2_task_templates%rowtype; v_store_id uuid; v_group jsonb; v_item jsonb; v_group_id uuid; v_item_id uuid; v_reference_image_path text;
  v_name text := btrim(coalesce(p_fields ->> 'name', '')); v_category text := coalesce(p_fields ->> 'category', '');
  v_recurrence text := coalesce(p_fields ->> 'recurrence', 'none'); v_due_time time; v_recurrence_day smallint;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'template name is required' using errcode = '22023'; end if;
  if v_category not in ('weekly_clean', 'monthly_clean', 'inspection', 'temporary') then raise exception 'invalid template category' using errcode = '22023'; end if;
  if v_recurrence not in ('none', 'weekly', 'monthly') then raise exception 'invalid template recurrence' using errcode = '22023'; end if;
  if nullif(p_fields ->> 'due_time', '') is not null then v_due_time := (p_fields ->> 'due_time')::time; end if;
  if v_recurrence = 'none' then v_recurrence_day := null;
  else
    v_recurrence_day := nullif(p_fields ->> 'recurrence_day', '')::smallint;
    if v_due_time is null or v_recurrence_day is null or (v_recurrence = 'weekly' and v_recurrence_day not between 1 and 7) or (v_recurrence = 'monthly' and v_recurrence_day not between 1 and 31) then
      raise exception 'valid recurring deadline is required' using errcode = '22023';
    end if;
  end if;
  if coalesce(array_length(p_store_ids, 1), 0) = 0 then raise exception 'at least one store is required' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_groups, '[]'::jsonb)) <> 'array' then raise exception 'template groups must be an array' using errcode = '22023'; end if;
  foreach v_store_id in array p_store_ids loop
    if not public.has_store_access(v_store_id) or not exists (select 1 from public.stores where id = v_store_id and is_active) then raise exception 'administrator store access required' using errcode = '42501'; end if;
  end loop;
  if p_template_id is null then
    insert into public.v2_task_templates (name, category, description, requires_review, allow_overdue, recurrence, recurrence_day, due_time, status, created_by)
    values (v_name, v_category, coalesce(p_fields ->> 'description', ''), coalesce((p_fields ->> 'requires_review')::boolean, true), coalesce((p_fields ->> 'allow_overdue')::boolean, false), v_recurrence, v_recurrence_day, v_due_time, 'draft', auth.uid()) returning * into v_template;
  else
    select * into v_template from public.v2_task_templates where id = p_template_id for update;
    if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then raise exception 'task template not found or access denied' using errcode = '42501'; end if;
    if v_template.status = 'archived' then raise exception 'archived task template cannot be edited' using errcode = '55000'; end if;
    update public.v2_task_templates set name = v_name, category = v_category, description = coalesce(p_fields ->> 'description', ''), requires_review = coalesce((p_fields ->> 'requires_review')::boolean, true), allow_overdue = coalesce((p_fields ->> 'allow_overdue')::boolean, false), recurrence = v_recurrence, recurrence_day = v_recurrence_day, due_time = v_due_time, status = 'draft' where id = v_template.id returning * into v_template;
    delete from public.v2_task_template_stores where template_id = v_template.id;
    delete from public.v2_task_template_groups where template_id = v_template.id;
  end if;
  insert into public.v2_task_template_stores (template_id, store_id) select v_template.id, store_id from unnest(p_store_ids) store_id group by store_id;
  for v_group in select value from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) loop
    if btrim(coalesce(v_group ->> 'title', '')) = '' then raise exception 'template group title is required' using errcode = '22023'; end if;
    v_group_id := coalesce(nullif(v_group ->> 'id', '')::uuid, gen_random_uuid());
    insert into public.v2_task_template_groups (id, template_id, title, description, sort_order) values (v_group_id, v_template.id, btrim(v_group ->> 'title'), coalesce(v_group ->> 'description', ''), coalesce((v_group ->> 'sort_order')::integer, 0));
    for v_item in select value from jsonb_array_elements(coalesce(v_group -> 'items', '[]'::jsonb)) loop
      if btrim(coalesce(v_item ->> 'label', '')) = '' then raise exception 'template item label is required' using errcode = '22023'; end if;
      if coalesce(v_item ->> 'field_type', '') not in ('instruction', 'short_text', 'long_text', 'integer', 'decimal', 'boolean', 'single_choice', 'multi_choice', 'image', 'multi_image', 'confirmation', 'rating') then raise exception 'invalid template item field type' using errcode = '22023'; end if;
      if coalesce(v_item ->> 'image_requirement', 'none') not in ('none', 'single', 'multiple') then raise exception 'invalid image requirement' using errcode = '22023'; end if;
      v_item_id := coalesce(nullif(v_item ->> 'id', '')::uuid, gen_random_uuid());
      v_reference_image_path := nullif(v_item ->> 'reference_image_path', '');
      if v_reference_image_path is not null and v_reference_image_path !~ ('^' || v_template.id::text || '/' || v_item_id::text || '/') then
        raise exception 'invalid reference image path' using errcode = '22023';
      end if;
      insert into public.v2_task_template_items (id, template_id, group_id, label, guidance, field_type, is_required, image_requirement, options, reference_image_path, sort_order)
      values (v_item_id, v_template.id, v_group_id, btrim(v_item ->> 'label'), coalesce(v_item ->> 'guidance', ''), v_item ->> 'field_type', coalesce((v_item ->> 'is_required')::boolean, true), coalesce(v_item ->> 'image_requirement', 'none'), coalesce(v_item -> 'options', '[]'::jsonb), v_reference_image_path, coalesce((v_item ->> 'sort_order')::integer, 0));
    end loop;
  end loop;
  foreach v_store_id in array p_store_ids loop
    insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata) values (v_store_id, auth.uid(), 'v2_task_template_saved', 'v2_task_templates', v_template.id, jsonb_build_object('name', v_template.name, 'category', v_template.category));
  end loop;
  return to_jsonb(v_template);
end;
$$;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('v2-task-template-reference-images', 'v2-task-template-reference-images', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy v2_task_template_reference_image_select on storage.objects for select to authenticated using (
  bucket_id = 'v2-task-template-reference-images' and (
    exists (select 1 from public.v2_task_template_items item where item.reference_image_path = name and public.can_manage_v2_task_template(item.template_id))
    or exists (select 1 from public.v2_task_answers answer where answer.item_snapshot ->> 'reference_image_path' = name and public.can_read_v2_task(answer.task_id))
  )
);

create policy v2_task_template_reference_image_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'v2-task-template-reference-images'
  and public.current_user_role() = 'admin'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.can_manage_v2_task_template((storage.foldername(name))[1]::uuid)
);
