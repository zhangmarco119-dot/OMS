-- Keep arrival creation aligned with the multi-store access model, allow
-- administrators to correct effective arrival records directly, and prevent a
-- manager who rejected a shared task from receiving that same correction todo.

create or replace function public.set_arrival_report_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_name text;
  v_reporter_name text;
begin
  select store.name, profile.display_name
  into v_store_name, v_reporter_name
  from public.stores store
  join public.profiles profile on profile.id = new.reported_by
  where store.id = new.store_id
    and store.is_active = true
    and profile.id = auth.uid()
    and profile.is_active = true
    and profile.deleted_at is null
    and profile.role in ('staff', 'manager')
    and public.has_store_access(new.store_id);

  if v_store_name is null or v_reporter_name is null then
    raise exception 'active staff or manager needs access to the arrival store'
      using errcode = '42501';
  end if;

  new.store_name_snapshot := v_store_name;
  new.reporter_name_snapshot := v_reporter_name;
  return new;
end;
$$;

create or replace function public.admin_update_arrival_report(
  p_report_id uuid,
  p_fields jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.arrival_reports%rowtype;
  v_item jsonb;
  v_product_id uuid;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'administrator role required' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_fields), 'null') <> 'object' then
    raise exception 'arrival correction fields must be an object' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_items), 'null') <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception 'arrival correction requires at least one item' using errcode = '22023';
  end if;

  select * into v_report
  from public.arrival_reports
  where id = p_report_id
  for update;

  if v_report.id is null then
    raise exception 'arrival report not found' using errcode = 'P0002';
  end if;
  if not public.has_store_access(v_report.store_id) then
    raise exception 'administrator store access required' using errcode = '42501';
  end if;
  if v_report.status not in ('submitted', 'viewed') then
    raise exception 'only effective arrivals can be corrected' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.arrival_report_correction_requests
    where report_id = p_report_id and status = 'pending'
  ) then
    raise exception 'arrival report already has a pending correction' using errcode = '55000';
  end if;

  perform (p_fields ->> 'arrival_date')::date;
  if nullif(p_fields ->> 'arrival_time', '') is not null then
    perform (p_fields ->> 'arrival_time')::time;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or nullif(btrim(v_item ->> 'product_name_snapshot'), '') is null
      or nullif(btrim(v_item ->> 'unit'), '') is null
      or (v_item ->> 'quantity')::numeric <= 0
      or (v_item ->> 'sort_order')::integer < 0 then
      raise exception 'invalid arrival correction item' using errcode = '22023';
    end if;

    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    if v_product_id is not null and not exists (
      select 1 from public.products product
      where product.id = v_product_id
        and product.store_id = v_report.store_id
        and product.is_active = true
    ) then
      raise exception 'arrival correction product does not belong to this store' using errcode = '23514';
    end if;
  end loop;

  delete from public.arrival_report_items where report_id = v_report.id;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    insert into public.arrival_report_items(
      id, report_id, product_id, product_name_snapshot, quantity, unit,
      note, is_unmatched_product, sort_order
    ) values (
      (v_item ->> 'id')::uuid,
      v_report.id,
      v_product_id,
      btrim(v_item ->> 'product_name_snapshot'),
      (v_item ->> 'quantity')::numeric,
      btrim(v_item ->> 'unit'),
      nullif(btrim(v_item ->> 'note'), ''),
      v_product_id is null,
      (v_item ->> 'sort_order')::integer
    );
  end loop;

  update public.arrival_reports
  set arrival_date = (p_fields ->> 'arrival_date')::date,
      arrival_time = nullif(p_fields ->> 'arrival_time', '')::time,
      carrier_name = nullif(btrim(p_fields ->> 'carrier_name'), ''),
      tracking_no = nullif(btrim(p_fields ->> 'tracking_no'), ''),
      note = nullif(btrim(p_fields ->> 'note'), ''),
      generated_summary = public.generate_arrival_summary(v_report.id)
  where id = v_report.id
  returning * into v_report;

  insert into public.audit_logs(store_id, actor_id, action, entity_table, entity_id, metadata)
  values (
    v_report.store_id, auth.uid(), 'arrival_report_admin_updated',
    'arrival_reports', v_report.id,
    jsonb_build_object('report_no', v_report.report_no, 'version', v_report.version)
  );

  return to_jsonb(v_report);
end;
$$;

revoke all on function public.admin_update_arrival_report(uuid, jsonb, jsonb) from public;
grant execute on function public.admin_update_arrival_report(uuid, jsonb, jsonb) to authenticated;

create or replace function public.can_edit_v2_task(p_task_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1
    from public.v2_tasks task
    where task.id = p_task_id
      and task.publish_at <= now()
      and public.current_user_role() in ('staff', 'manager')
      and public.has_store_access(task.store_id)
      and (
        task.assigned_profile_id = auth.uid()
        or (
          task.assigned_profile_id is null
          and public.v2_task_audience_for_profile(auth.uid()) = any(task.target_audiences)
        )
      )
      and not (task.status = 'rejected' and task.reviewed_by = auth.uid())
      and (
        task.status in ('pending', 'in_progress', 'rejected')
        or (task.status = 'overdue' and task.allow_overdue)
      )
  )
$$;

create or replace function public.notify_other_v2_task_recipients_after_manager_rejection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.v2_tasks%rowtype;
  v_profile public.profiles%rowtype;
begin
  if new.action <> 'rejected' then
    return new;
  end if;

  select * into v_task from public.v2_tasks where id = new.task_id;
  if v_task.id is null
    or not v_task.manager_review_enabled
    or not exists (
      select 1 from public.profiles actor
      where actor.id = new.actor_id and actor.role = 'manager'
    ) then
    return new;
  end if;

  for v_profile in
    select distinct profile.*
    from public.profiles profile
    join public.profile_store_access access on access.profile_id = profile.id
    where access.store_id = v_task.store_id
      and profile.id <> new.actor_id
      and profile.is_active = true
      and profile.deleted_at is null
      and profile.role in ('staff', 'manager')
      and (
        v_task.assigned_profile_id = profile.id
        or (
          v_task.assigned_profile_id is null
          and public.v2_task_audience_for_profile(profile.id) = any(v_task.target_audiences)
        )
      )
  loop
    insert into public.notifications(
      recipient_user_id, store_id, type, title, body,
      entity_type, entity_id, dedupe_key
    ) values (
      v_profile.id, v_task.store_id, 'v2_task_rejected', '任务需要整改',
      coalesce(nullif(btrim(v_task.review_note), ''), '任务已由店长退回，请打开待办完成整改。'),
      'v2_task', v_task.id,
      'v2-task-manager-handoff:' || v_task.id || ':' || new.id || ':' || v_profile.id
    ) on conflict(dedupe_key) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists v2_task_review_notify_other_recipients on public.v2_task_reviews;
create trigger v2_task_review_notify_other_recipients
after insert on public.v2_task_reviews
for each row execute function public.notify_other_v2_task_recipients_after_manager_rejection();

create or replace function public.suppress_self_v2_task_rejection_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = 'v2_task_rejected'
    and new.entity_type = 'v2_task'
    and new.recipient_user_id = auth.uid()
    and exists (
      select 1
      from public.v2_tasks task
      join public.profiles reviewer on reviewer.id = task.reviewed_by
      where task.id = new.entity_id
        and task.status = 'rejected'
        and task.reviewed_by = auth.uid()
        and reviewer.role = 'manager'
    ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_suppress_manager_self_rejection on public.notifications;
create trigger notifications_suppress_manager_self_rejection
before insert on public.notifications
for each row execute function public.suppress_self_v2_task_rejection_notification();
