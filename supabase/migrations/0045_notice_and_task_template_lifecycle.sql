-- Align announcements and task templates with the SOP lifecycle:
-- draft -> published -> retracted/draft -> archived -> permanently deleted.

alter table public.v2_notices
  drop constraint if exists v2_notices_status_check;

alter table public.v2_notices
  add constraint v2_notices_status_check
  check (status in ('draft', 'published', 'retracted', 'archived'));

create or replace function public.publish_v2_notice(p_notice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notice public.v2_notices%rowtype;
  v_previous_status text;
begin
  if not public.can_manage_v2_notice(p_notice_id) then
    raise exception 'notice management denied' using errcode = '42501';
  end if;
  if not exists(select 1 from public.v2_notice_recipients where notice_id = p_notice_id) then
    raise exception 'notice recipients required' using errcode = '22023';
  end if;

  select status into v_previous_status
  from public.v2_notices
  where id = p_notice_id
  for update;

  if not found then
    raise exception 'notice not found' using errcode = 'P0002';
  end if;
  if v_previous_status not in ('draft', 'retracted') then
    raise exception 'only draft or retracted notices can be published' using errcode = '55000';
  end if;

  if v_previous_status = 'retracted' then
    update public.v2_notice_recipients
    set first_read_at = null,
        last_read_at = null,
        dismissed_at = null,
        acknowledged_at = null
    where notice_id = p_notice_id;
  end if;

  delete from public.notifications
  where entity_type = 'v2_notice' and entity_id = p_notice_id;

  update public.v2_notices
  set status = 'published',
      published_at = now(),
      retracted_at = null
  where id = p_notice_id
  returning * into v_notice;

  insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  select recipient.profile_id,
         recipient.store_id,
         'notice_published',
         v_notice.title,
         left(v_notice.body, 180),
         'v2_notice',
         v_notice.id,
         'notice:' || v_notice.id || ':' || recipient.profile_id
  from public.v2_notice_recipients recipient
  where recipient.notice_id = v_notice.id
  on conflict(dedupe_key) do nothing;

  insert into public.audit_logs(actor_id, action, entity_table, entity_id, metadata)
  values (
    auth.uid(),
    case when v_previous_status = 'retracted' then 'v2_notice_republished' else 'v2_notice_published' end,
    'v2_notices',
    v_notice.id,
    jsonb_build_object('previous_status', v_previous_status)
  );
  return to_jsonb(v_notice);
end;
$$;

create or replace function public.archive_v2_notice(p_notice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notice public.v2_notices%rowtype;
begin
  if not public.can_manage_v2_notice(p_notice_id) then
    raise exception 'notice management denied' using errcode = '42501';
  end if;

  update public.v2_notices
  set status = 'archived',
      published_at = null,
      is_pinned = false
  where id = p_notice_id and status in ('draft', 'retracted')
  returning * into v_notice;

  if v_notice.id is null then
    raise exception 'only unpublished notices can be archived' using errcode = '55000';
  end if;

  delete from public.notifications
  where entity_type = 'v2_notice' and entity_id = v_notice.id;

  insert into public.audit_logs(actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'v2_notice_archived', 'v2_notices', v_notice.id, jsonb_build_object('title', v_notice.title));
  return to_jsonb(v_notice);
end;
$$;

create or replace function public.delete_v2_notice(p_notice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if not public.can_manage_v2_notice(p_notice_id) then
    raise exception 'notice management permission required' using errcode = '42501';
  end if;

  select title into v_title
  from public.v2_notices
  where id = p_notice_id and status = 'archived'
  for update;

  if v_title is null then
    raise exception 'only archived notices can be deleted' using errcode = '55000';
  end if;

  delete from public.notifications where entity_type = 'v2_notice' and entity_id = p_notice_id;
  delete from public.v2_notice_assets where notice_id = p_notice_id;
  delete from public.v2_notices where id = p_notice_id;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'v2_notice_deleted', 'v2_notices', p_notice_id, jsonb_build_object('title', v_title));
  return jsonb_build_object('id', p_notice_id, 'title', v_title, 'deleted', true);
end;
$$;

create or replace function public.retract_v2_task_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.v2_task_templates%rowtype;
  v_store_id uuid;
begin
  if not public.can_manage_v2_task_template(p_template_id) then
    raise exception 'task template not found or access denied' using errcode = '42501';
  end if;

  update public.v2_task_templates
  set status = 'draft'
  where id = p_template_id and status = 'published'
  returning * into v_template;

  if v_template.id is null then
    raise exception 'only published task templates can be retracted' using errcode = '55000';
  end if;

  for v_store_id in select store_id from public.v2_task_template_stores where template_id = v_template.id loop
    insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
    values (
      v_store_id,
      auth.uid(),
      'v2_task_template_retracted',
      'v2_task_templates',
      v_template.id,
      jsonb_build_object('name', v_template.name, 'version', v_template.current_version)
    );
  end loop;
  return to_jsonb(v_template);
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
  v_store_id uuid;
begin
  if not public.can_manage_v2_task_template(p_template_id) then
    raise exception 'task template not found or access denied' using errcode = '42501';
  end if;

  update public.v2_task_templates
  set status = 'archived'
  where id = p_template_id and status = 'draft'
  returning * into v_template;

  if v_template.id is null then
    raise exception 'only draft task templates can be archived' using errcode = '55000';
  end if;

  for v_store_id in select store_id from public.v2_task_template_stores where template_id = v_template.id loop
    insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
    values (
      v_store_id,
      auth.uid(),
      'v2_task_template_archived',
      'v2_task_templates',
      v_template.id,
      jsonb_build_object('name', v_template.name, 'version', v_template.current_version)
    );
  end loop;
  return to_jsonb(v_template);
end;
$$;

revoke all on function public.archive_v2_notice(uuid) from public;
revoke all on function public.retract_v2_task_template(uuid) from public;
grant execute on function public.archive_v2_notice(uuid) to authenticated;
grant execute on function public.retract_v2_task_template(uuid) to authenticated;
