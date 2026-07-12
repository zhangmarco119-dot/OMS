-- Templates are administrator-only configuration. Store users only receive immutable task instances.
alter table public.v2_task_templates add column recurrence_day smallint;
update public.v2_task_templates
set recurrence_day = case recurrence when 'weekly' then 1 when 'monthly' then 1 else null end
where recurrence_day is null;
alter table public.v2_task_templates add constraint v2_task_templates_recurrence_day_check check (
  (recurrence = 'none' and recurrence_day is null)
  or (recurrence = 'weekly' and recurrence_day between 1 and 7)
  or (recurrence = 'monthly' and recurrence_day between 1 and 31)
);

create or replace function public.can_view_v2_task_template(target_template_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.can_manage_v2_task_template(target_template_id)
$$;

create or replace function public.next_v2_task_template_due(target_template_id uuid)
returns timestamptz language plpgsql security definer set search_path = public stable as $$
declare
  template public.v2_task_templates%rowtype;
  local_now timestamp := timezone('Asia/Shanghai', now());
  candidate timestamp;
  candidate_date date;
  last_day integer;
begin
  select * into template from public.v2_task_templates where id = target_template_id;
  if template.id is null or template.recurrence = 'none' or template.recurrence_day is null or template.due_time is null then
    return null;
  end if;
  if template.recurrence = 'weekly' then
    candidate_date := local_now::date + ((template.recurrence_day - extract(isodow from local_now)::integer + 7) % 7);
  else
    last_day := extract(day from (date_trunc('month', local_now)::date + interval '1 month - 1 day'))::integer;
    candidate_date := make_date(extract(year from local_now)::integer, extract(month from local_now)::integer, least(template.recurrence_day, last_day));
  end if;
  candidate := candidate_date + template.due_time;
  if candidate <= local_now then
    if template.recurrence = 'weekly' then
      candidate := candidate + interval '7 days';
    else
      candidate_date := (date_trunc('month', candidate_date)::date + interval '1 month')::date;
      last_day := extract(day from (date_trunc('month', candidate_date)::date + interval '1 month - 1 day'))::integer;
      candidate := make_date(extract(year from candidate_date)::integer, extract(month from candidate_date)::integer, least(template.recurrence_day, last_day)) + template.due_time;
    end if;
  end if;
  return candidate at time zone 'Asia/Shanghai';
end;
$$;

create or replace function public.save_v2_task_template(p_template_id uuid, p_fields jsonb, p_store_ids uuid[], p_groups jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_template public.v2_task_templates%rowtype; v_store_id uuid; v_group jsonb; v_item jsonb; v_group_id uuid; v_item_id uuid;
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
      insert into public.v2_task_template_items (id, template_id, group_id, label, guidance, field_type, is_required, image_requirement, options, sort_order) values (v_item_id, v_template.id, v_group_id, btrim(v_item ->> 'label'), coalesce(v_item ->> 'guidance', ''), v_item ->> 'field_type', coalesce((v_item ->> 'is_required')::boolean, true), coalesce(v_item ->> 'image_requirement', 'none'), coalesce(v_item -> 'options', '[]'::jsonb), coalesce((v_item ->> 'sort_order')::integer, 0));
    end loop;
  end loop;
  foreach v_store_id in array p_store_ids loop
    insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata) values (v_store_id, auth.uid(), 'v2_task_template_saved', 'v2_task_templates', v_template.id, jsonb_build_object('name', v_template.name, 'category', v_template.category));
  end loop;
  return to_jsonb(v_template);
end;
$$;

create or replace function public.publish_v2_task_template(p_template_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_template public.v2_task_templates%rowtype; v_snapshot jsonb; v_next_version integer; v_store_id uuid;
begin
  select * into v_template from public.v2_task_templates where id = p_template_id for update;
  if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then raise exception 'task template not found or access denied' using errcode = '42501'; end if;
  if v_template.status = 'archived' then raise exception 'archived task template cannot be published' using errcode = '55000'; end if;
  if not exists (select 1 from public.v2_task_template_stores where template_id = v_template.id) or not exists (select 1 from public.v2_task_template_items where template_id = v_template.id) then raise exception 'template requires stores and items' using errcode = '23514'; end if;
  if exists (select 1 from public.v2_task_template_items where template_id = v_template.id and field_type in ('single_choice', 'multi_choice') and jsonb_array_length(options) = 0) then raise exception 'choice items require options' using errcode = '23514'; end if;
  select jsonb_build_object('template', jsonb_build_object('id', v_template.id, 'name', v_template.name, 'category', v_template.category, 'description', v_template.description, 'requires_review', v_template.requires_review, 'allow_overdue', v_template.allow_overdue, 'recurrence', v_template.recurrence, 'recurrence_day', v_template.recurrence_day, 'due_time', v_template.due_time), 'store_ids', (select coalesce(jsonb_agg(store_id order by store_id), '[]'::jsonb) from public.v2_task_template_stores where template_id = v_template.id), 'groups', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'description', g.description, 'sort_order', g.sort_order, 'items', (select coalesce(jsonb_agg(to_jsonb(i) - 'template_id' - 'group_id' order by i.sort_order, i.id), '[]'::jsonb) from public.v2_task_template_items i where i.group_id = g.id)) order by g.sort_order, g.id), '[]'::jsonb) from public.v2_task_template_groups g where g.template_id = v_template.id)) into v_snapshot;
  v_next_version := v_template.current_version + 1;
  insert into public.v2_task_template_versions (template_id, version_number, snapshot, published_by) values (v_template.id, v_next_version, v_snapshot, auth.uid());
  update public.v2_task_templates set status = 'published', current_version = v_next_version where id = v_template.id returning * into v_template;
  for v_store_id in select store_id from public.v2_task_template_stores where template_id = v_template.id loop
    insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata) values (v_store_id, auth.uid(), 'v2_task_template_published', 'v2_task_templates', v_template.id, jsonb_build_object('name', v_template.name, 'version', v_next_version));
  end loop;
  return jsonb_build_object('template', to_jsonb(v_template), 'version', v_next_version);
end;
$$;

create or replace function public.publish_v2_tasks(p_template_id uuid, p_store_ids uuid[], p_due_at timestamptz)
returns setof public.v2_tasks language plpgsql security definer set search_path = public as $$
declare v_template public.v2_task_templates%rowtype; v_version public.v2_task_template_versions%rowtype; v_store uuid; v_task public.v2_tasks%rowtype; v_group jsonb; v_item jsonb; v_due_at timestamptz;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required' using errcode = '42501'; end if;
  select * into v_template from public.v2_task_templates where id = p_template_id and status = 'published';
  if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then raise exception 'published template required' using errcode = '42501'; end if;
  select * into v_version from public.v2_task_template_versions where template_id = v_template.id and version_number = v_template.current_version;
  v_due_at := coalesce(p_due_at, public.next_v2_task_template_due(v_template.id));
  if v_due_at is null or v_due_at <= now() then raise exception 'a future due time is required' using errcode = '22023'; end if;
  foreach v_store in array p_store_ids loop
    if not public.has_store_access(v_store) or not exists (select 1 from public.v2_task_template_stores where template_id = v_template.id and store_id = v_store) then raise exception 'template store access denied' using errcode = '42501'; end if;
    insert into public.v2_tasks (template_id, template_version_id, store_id, name, category, snapshot, due_at, allow_overdue, requires_review, created_by) values (v_template.id, v_version.id, v_store, v_template.name, v_template.category, v_version.snapshot, v_due_at, v_template.allow_overdue, v_template.requires_review, auth.uid()) returning * into v_task;
    for v_group in select value from jsonb_array_elements(v_version.snapshot -> 'groups') loop
      for v_item in select value from jsonb_array_elements(v_group -> 'items') loop
        insert into public.v2_task_answers (task_id, item_id, group_id, item_snapshot) values (v_task.id, (v_item ->> 'id')::uuid, (v_group ->> 'id')::uuid, v_item);
      end loop;
    end loop;
    insert into public.audit_logs (store_id, actor_id, action, entity_table, entity_id, metadata) values (v_store, auth.uid(), 'v2_task_published', 'v2_tasks', v_task.id, jsonb_build_object('template', v_template.name));
    return next v_task;
  end loop;
end;
$$;

revoke all on function public.next_v2_task_template_due(uuid) from public;
