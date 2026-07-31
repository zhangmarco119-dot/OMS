-- Optional published SOP/notice links for one-off and recurring tasks.

alter table public.v2_tasks
  add column related_sop_id uuid references public.v2_sops(id) on delete set null,
  add column related_notice_id uuid references public.v2_notices(id) on delete set null,
  add column related_content_title text;

alter table public.v2_tasks
  add constraint v2_tasks_single_related_content_check
  check (related_sop_id is null or related_notice_id is null);

alter table public.v2_task_schedules
  add column related_sop_id uuid references public.v2_sops(id) on delete set null,
  add column related_notice_id uuid references public.v2_notices(id) on delete set null,
  add column related_content_title text;

alter table public.v2_task_schedules
  add constraint v2_task_schedules_single_related_content_check
  check (related_sop_id is null or related_notice_id is null);

create index v2_tasks_related_sop_idx on public.v2_tasks(related_sop_id) where related_sop_id is not null;
create index v2_tasks_related_notice_idx on public.v2_tasks(related_notice_id) where related_notice_id is not null;

create function public.validate_v2_task_related_content(
  p_related_sop_id uuid,
  p_related_notice_id uuid,
  p_store_ids uuid[],
  p_target_audiences text[]
)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_title text;
  v_role text;
begin
  if p_related_sop_id is not null and p_related_notice_id is not null then
    raise exception '任务只能关联一个 SOP 或一条公告' using errcode = '22023';
  end if;

  if p_related_sop_id is not null then
    select title into v_title
    from public.v2_sops
    where id = p_related_sop_id
      and status = 'published'
      and effective_at is not null
      and effective_at <= now();
    if v_title is null then
      raise exception '请选择已经生效的已发布 SOP' using errcode = '22023';
    end if;
    if exists (
      select 1
      from unnest(coalesce(p_store_ids, '{}'::uuid[])) store_id
      where not exists (
        select 1 from public.v2_sop_stores assignment
        where assignment.sop_id = p_related_sop_id and assignment.store_id = store_id
      )
    ) then
      raise exception '关联 SOP 未分配给全部任务门店' using errcode = '22023';
    end if;
    for v_role in
      select distinct case when audience = 'part_time' then 'staff' else audience end
      from unnest(coalesce(p_target_audiences, '{}'::text[])) audience
      where audience in ('staff', 'manager', 'part_time')
    loop
      if not exists (
        select 1 from public.v2_sop_roles role_assignment
        where role_assignment.sop_id = p_related_sop_id and role_assignment.role = v_role
      ) then
        raise exception '关联 SOP 未开放给全部任务接收角色' using errcode = '22023';
      end if;
    end loop;
    return v_title;
  end if;

  if p_related_notice_id is not null then
    select title into v_title
    from public.v2_notices
    where id = p_related_notice_id
      and status = 'published'
      and (expires_at is null or expires_at > now());
    if v_title is null then
      raise exception '请选择有效的已发布公告' using errcode = '22023';
    end if;
    if exists (
      select 1
      from unnest(coalesce(p_store_ids, '{}'::uuid[])) store_id
      where not exists (
        select 1 from public.v2_notice_stores assignment
        where assignment.notice_id = p_related_notice_id and assignment.store_id = store_id
      )
    ) then
      raise exception '关联公告未分配给全部任务门店' using errcode = '22023';
    end if;
    return v_title;
  end if;

  return null;
end;
$$;

create function public.publish_v2_tasks_v3(
  p_template_id uuid,
  p_store_ids uuid[],
  p_due_at timestamptz,
  p_publish_at timestamptz default now(),
  p_profile_ids uuid[] default '{}',
  p_target_audiences text[] default array['staff', 'manager']::text[],
  p_manager_review_enabled boolean default false,
  p_related_sop_id uuid default null,
  p_related_notice_id uuid default null
)
returns setof public.v2_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.v2_tasks%rowtype;
  v_title text;
begin
  v_title := public.validate_v2_task_related_content(
    p_related_sop_id,
    p_related_notice_id,
    p_store_ids,
    p_target_audiences
  );
  for v_task in
    select * from public.publish_v2_tasks_v2(
      p_template_id,
      p_store_ids,
      p_due_at,
      p_publish_at,
      p_profile_ids,
      p_target_audiences,
      p_manager_review_enabled
    )
  loop
    update public.v2_tasks
    set related_sop_id = p_related_sop_id,
        related_notice_id = p_related_notice_id,
        related_content_title = v_title
    where id = v_task.id
    returning * into v_task;
    return next v_task;
  end loop;
  return;
end;
$$;

create function public.create_v2_task_schedule_v3(
  p_template_id uuid,
  p_store_ids uuid[],
  p_profile_ids uuid[],
  p_fields jsonb,
  p_related_sop_id uuid default null,
  p_related_notice_id uuid default null
)
returns setof public.v2_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.v2_tasks%rowtype;
  v_title text;
  v_schedule_ids uuid[];
  v_started_at timestamptz := now();
  v_target_audiences text[] := coalesce(
    array(
      select value
      from jsonb_array_elements_text(coalesce(p_fields->'targetAudiences', '["staff","manager"]'::jsonb)) value
    ),
    array['staff', 'manager']::text[]
  );
begin
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  v_title := public.validate_v2_task_related_content(
    p_related_sop_id,
    p_related_notice_id,
    p_store_ids,
    v_target_audiences
  );

  for v_task in
    select * from public.create_v2_task_schedule_v2(
      p_template_id,
      p_store_ids,
      p_profile_ids,
      p_fields
    )
  loop
    return next v_task;
  end loop;

  select coalesce(array_agg(schedule.id), '{}'::uuid[]) into v_schedule_ids
  from public.v2_task_schedules schedule
  where schedule.created_by = auth.uid()
    and schedule.template_id = p_template_id
    and schedule.store_id = any(p_store_ids)
    and schedule.created_at >= v_started_at;

  update public.v2_task_schedules
  set related_sop_id = p_related_sop_id,
      related_notice_id = p_related_notice_id,
      related_content_title = v_title
  where id = any(v_schedule_ids);

  update public.v2_tasks
  set related_sop_id = p_related_sop_id,
      related_notice_id = p_related_notice_id,
      related_content_title = v_title
  where schedule_id = any(v_schedule_ids);

  return;
end;
$$;

create or replace function public.create_v2_task_from_schedule(p_schedule_id uuid, p_due_at timestamptz)
returns public.v2_tasks language plpgsql security definer set search_path = public as $$
declare v_schedule public.v2_task_schedules%rowtype; v_version public.v2_task_template_versions%rowtype; v_task public.v2_tasks%rowtype; v_group jsonb; v_item jsonb; v_snapshot jsonb; v_name text;
begin
  select * into v_schedule from public.v2_task_schedules where id = p_schedule_id for update;
  if v_schedule.id is null then raise exception 'task schedule not found' using errcode = 'P0002'; end if;
  select * into v_version from public.v2_task_template_versions where id = v_schedule.template_version_id;
  if v_version.id is null then raise exception 'task template version not found' using errcode = 'P0002'; end if;
  v_snapshot := coalesce(v_schedule.content_snapshot, v_version.snapshot);
  v_name := coalesce(nullif(v_schedule.content_name, ''), v_snapshot->'template'->>'name');
  insert into public.v2_tasks(
    template_id, template_version_id, schedule_id, store_id, assigned_profile_id, target_audiences,
    name, category, snapshot, due_at, publish_at, allow_overdue, requires_review,
    manager_review_enabled, related_sop_id, related_notice_id, related_content_title, created_by
  )
  values(
    v_schedule.template_id, v_schedule.template_version_id, v_schedule.id, v_schedule.store_id,
    v_schedule.assigned_profile_id, v_schedule.target_audiences, v_name,
    v_snapshot->'template'->>'category', v_snapshot, p_due_at, now(),
    coalesce((v_snapshot->'template'->>'allow_overdue')::boolean, false),
    coalesce((v_snapshot->'template'->>'requires_review')::boolean, true),
    v_schedule.manager_review_enabled, v_schedule.related_sop_id, v_schedule.related_notice_id,
    v_schedule.related_content_title, v_schedule.created_by
  )
  returning * into v_task;
  for v_group in select value from jsonb_array_elements(v_snapshot->'groups') loop
    for v_item in select value from jsonb_array_elements(v_group->'items') loop
      insert into public.v2_task_answers(task_id, item_id, group_id, item_snapshot)
      values(v_task.id, (v_item->>'id')::uuid, (v_group->>'id')::uuid, v_item);
    end loop;
  end loop;
  perform public.notify_v2_task_publication(v_task.id);
  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values(
    v_schedule.store_id,
    v_schedule.created_by,
    'v2_scheduled_task_published',
    'v2_tasks',
    v_task.id,
    jsonb_build_object(
      'schedule_id', v_schedule.id,
      'assigned_profile_id', v_schedule.assigned_profile_id,
      'target_audiences', v_schedule.target_audiences,
      'manager_review_enabled', v_schedule.manager_review_enabled,
      'related_sop_id', v_schedule.related_sop_id,
      'related_notice_id', v_schedule.related_notice_id
    )
  );
  return v_task;
end;
$$;

revoke all on function public.validate_v2_task_related_content(uuid,uuid,uuid[],text[]),
  public.publish_v2_tasks_v3(uuid,uuid[],timestamptz,timestamptz,uuid[],text[],boolean,uuid,uuid),
  public.create_v2_task_schedule_v3(uuid,uuid[],uuid[],jsonb,uuid,uuid)
from public, anon, authenticated;

grant execute on function
  public.publish_v2_tasks_v3(uuid,uuid[],timestamptz,timestamptz,uuid[],text[],boolean,uuid,uuid),
  public.create_v2_task_schedule_v3(uuid,uuid[],uuid[],jsonb,uuid,uuid)
to authenticated;
