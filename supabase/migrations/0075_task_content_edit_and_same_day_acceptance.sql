-- Restore the established task-template management entry, allow same-day
-- acceptance, and let administrators safely update published task wording
-- without discarding employee answers or image records.

alter table public.v2_task_schedules
  add column if not exists content_name text,
  add column if not exists content_snapshot jsonb;

alter table public.v2_task_schedules drop constraint if exists v2_task_schedules_acceptance_rule_check;
alter table public.v2_task_schedules add constraint v2_task_schedules_acceptance_rule_check check (
  (acceptance_type='daily' and acceptance_interval_days between 0 and 31 and acceptance_weekday is null and acceptance_month_day is null)
  or (acceptance_type='weekly' and acceptance_interval_days is null and acceptance_weekday between 1 and 7 and acceptance_month_day is null)
  or (acceptance_type='monthly' and acceptance_interval_days is null and acceptance_weekday is null and acceptance_month_day between 1 and 31)
);

create or replace function public.apply_v2_task_content(p_task_id uuid,p_name text,p_snapshot jsonb,p_due_at timestamptz default null)
returns public.v2_tasks language plpgsql security definer set search_path=public as $$
declare
  v_task public.v2_tasks%rowtype;
  v_snapshot jsonb;
  v_snapshot_count integer;
  v_snapshot_unique integer;
  v_answer_count integer;
begin
  select * into v_task from public.v2_tasks where id=p_task_id for update;
  if v_task.id is null then raise exception '任务不存在'; end if;
  if btrim(coalesce(p_name,''))='' then raise exception '请填写任务名称'; end if;
  if jsonb_typeof(p_snapshot)<>'object' or jsonb_typeof(p_snapshot->'groups')<>'array' or jsonb_array_length(p_snapshot->'groups')=0 then
    raise exception '任务至少需要一个分组';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_snapshot->'groups') g
    where btrim(coalesce(g->>'id',''))='' or btrim(coalesce(g->>'title',''))=''
      or jsonb_typeof(g->'items')<>'array' or jsonb_array_length(g->'items')=0
  ) then raise exception '请完善任务分组名称和项目'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_snapshot->'groups') g
    cross join lateral jsonb_array_elements(g->'items') i
    where btrim(coalesce(i->>'id',''))='' or btrim(coalesce(i->>'label',''))=''
  ) then raise exception '每个任务项目都需要填写名称'; end if;

  select count(*),count(distinct (i->>'id')::uuid) into v_snapshot_count,v_snapshot_unique
  from jsonb_array_elements(p_snapshot->'groups') g
  cross join lateral jsonb_array_elements(g->'items') i;
  select count(*) into v_answer_count from public.v2_task_answers where task_id=p_task_id;
  if v_snapshot_count<>v_snapshot_unique or v_snapshot_count<>v_answer_count
    or exists(
      select 1 from public.v2_task_answers a where a.task_id=p_task_id and not exists(
        select 1 from jsonb_array_elements(p_snapshot->'groups') g
        cross join lateral jsonb_array_elements(g->'items') i
        where (i->>'id')::uuid=a.item_id
      )
    ) then raise exception '发布后不能增删任务项目，请只修改任务文字内容'; end if;
  if p_due_at is not null and p_due_at<=now() then raise exception '验收截止时间必须晚于当前时间'; end if;

  v_snapshot:=p_snapshot || jsonb_build_object('template',coalesce(p_snapshot->'template','{}'::jsonb) || jsonb_build_object('name',btrim(p_name)));
  update public.v2_tasks set name=btrim(p_name),snapshot=v_snapshot,due_at=coalesce(p_due_at,due_at),version=version+1
  where id=p_task_id returning * into v_task;
  update public.v2_task_answers a set item_snapshot=source.item
  from (
    select i item from jsonb_array_elements(v_snapshot->'groups') g
    cross join lateral jsonb_array_elements(g->'items') i
  ) source where a.task_id=p_task_id and a.item_id=(source.item->>'id')::uuid;
  return v_task;
end;
$$;

create or replace function public.update_v2_task_content(p_task_id uuid,p_name text,p_snapshot jsonb,p_due_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_task public.v2_tasks%rowtype;
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator role required' using errcode='42501'; end if;
  select * into v_task from public.v2_tasks where id=p_task_id for update;
  if v_task.id is null or not public.has_store_access(v_task.store_id) then raise exception 'task access denied' using errcode='42501'; end if;
  if v_task.schedule_id is not null then raise exception '周期任务请从周期计划编辑'; end if;
  if v_task.status not in ('pending','in_progress','rejected','overdue') then raise exception '当前状态不能编辑任务内容'; end if;
  select * into v_task from public.apply_v2_task_content(p_task_id,p_name,p_snapshot,p_due_at);
  insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
  select profile.id,v_task.store_id,'v2_task_updated','任务内容已更新：'||v_task.name,'请打开任务查看管理员更新后的内容。','v2_task',v_task.id,'v2-task-updated:'||v_task.id||':'||v_task.version||':'||profile.id
  from public.profiles profile where profile.is_active and profile.deleted_at is null and profile.role in ('staff','manager') and profile.store_id=v_task.store_id and (v_task.assigned_profile_id is null or profile.id=v_task.assigned_profile_id)
  on conflict(dedupe_key) do nothing;
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(v_task.store_id,auth.uid(),'v2_task_content_updated','v2_tasks',v_task.id,jsonb_build_object('name',v_task.name,'due_at',v_task.due_at));
  return to_jsonb(v_task);
end;
$$;

create or replace function public.get_v2_task_schedule_content(p_schedule_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare s public.v2_task_schedules%rowtype; v_version public.v2_task_template_versions%rowtype;
begin
  select * into s from public.v2_task_schedules where id=p_schedule_id;
  if s.id is null or public.current_user_role()<>'admin' or not public.has_store_access(s.store_id) then raise exception 'schedule access denied' using errcode='42501'; end if;
  select * into v_version from public.v2_task_template_versions where id=s.template_version_id;
  return jsonb_build_object('name',coalesce(nullif(s.content_name,''),v_version.snapshot->'template'->>'name'),'snapshot',coalesce(s.content_snapshot,v_version.snapshot));
end;
$$;

create or replace function public.update_v2_task_schedule_content(p_schedule_id uuid,p_name text,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.v2_task_schedules%rowtype; v_task public.v2_tasks%rowtype; v_updated integer:=0;
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator role required' using errcode='42501'; end if;
  select * into s from public.v2_task_schedules where id=p_schedule_id for update;
  if s.id is null or not public.has_store_access(s.store_id) then raise exception 'schedule access denied' using errcode='42501'; end if;
  if btrim(coalesce(p_name,''))='' then raise exception '请填写任务名称'; end if;
  update public.v2_task_schedules set content_name=btrim(p_name),content_snapshot=p_snapshot || jsonb_build_object('template',coalesce(p_snapshot->'template','{}'::jsonb) || jsonb_build_object('name',btrim(p_name))) where id=s.id returning * into s;
  for v_task in select * from public.v2_tasks where schedule_id=s.id and status in ('pending','in_progress','rejected','overdue') for update loop
    select * into v_task from public.apply_v2_task_content(v_task.id,p_name,s.content_snapshot,null);
    v_updated:=v_updated+1;
    insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
    select profile.id,v_task.store_id,'v2_task_updated','周期任务内容已更新：'||v_task.name,'请打开任务查看管理员更新后的内容。','v2_task',v_task.id,'v2-schedule-task-updated:'||v_task.id||':'||v_task.version||':'||profile.id
    from public.profiles profile where profile.is_active and profile.deleted_at is null and profile.role in ('staff','manager') and profile.store_id=v_task.store_id and (v_task.assigned_profile_id is null or profile.id=v_task.assigned_profile_id)
    on conflict(dedupe_key) do nothing;
  end loop;
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(s.store_id,auth.uid(),'v2_task_schedule_content_updated','v2_task_schedules',s.id,jsonb_build_object('name',p_name,'updated_tasks',v_updated));
  return jsonb_build_object('scheduleId',s.id,'updatedTasks',v_updated);
end;
$$;

create or replace function public.create_v2_task_from_schedule(p_schedule_id uuid,p_due_at timestamptz)
returns public.v2_tasks language plpgsql security definer set search_path=public as $$
declare v_schedule public.v2_task_schedules%rowtype; v_version public.v2_task_template_versions%rowtype; v_task public.v2_tasks%rowtype; v_group jsonb; v_item jsonb; v_snapshot jsonb; v_name text;
begin
  select * into v_schedule from public.v2_task_schedules where id=p_schedule_id for update;
  if v_schedule.id is null then raise exception 'task schedule not found' using errcode='P0002'; end if;
  select * into v_version from public.v2_task_template_versions where id=v_schedule.template_version_id;
  if v_version.id is null then raise exception 'task template version not found' using errcode='P0002'; end if;
  v_snapshot:=coalesce(v_schedule.content_snapshot,v_version.snapshot);
  v_name:=coalesce(nullif(v_schedule.content_name,''),v_snapshot->'template'->>'name');
  insert into public.v2_tasks(template_id,template_version_id,schedule_id,store_id,assigned_profile_id,name,category,snapshot,due_at,allow_overdue,requires_review,created_by)
  values(v_schedule.template_id,v_schedule.template_version_id,v_schedule.id,v_schedule.store_id,v_schedule.assigned_profile_id,v_name,v_snapshot->'template'->>'category',v_snapshot,p_due_at,coalesce((v_snapshot->'template'->>'allow_overdue')::boolean,false),coalesce((v_snapshot->'template'->>'requires_review')::boolean,true),v_schedule.created_by)
  returning * into v_task;
  for v_group in select value from jsonb_array_elements(v_snapshot->'groups') loop
    for v_item in select value from jsonb_array_elements(v_group->'items') loop
      insert into public.v2_task_answers(task_id,item_id,group_id,item_snapshot) values(v_task.id,(v_item->>'id')::uuid,(v_group->>'id')::uuid,v_item);
    end loop;
  end loop;
  insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
  select profile.id,v_schedule.store_id,'v2_task_published','新周期任务：'||v_task.name,'截止时间：'||to_char(v_task.due_at,'YYYY-MM-DD HH24:MI'),'v2_task',v_task.id,'v2-scheduled-task:'||v_task.id||':'||profile.id
  from public.profiles profile where profile.is_active and profile.deleted_at is null and profile.role in ('staff','manager') and profile.store_id=v_schedule.store_id and (v_schedule.assigned_profile_id is null or profile.id=v_schedule.assigned_profile_id)
  on conflict(dedupe_key) do nothing;
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(v_schedule.store_id,v_schedule.created_by,'v2_scheduled_task_published','v2_tasks',v_task.id,jsonb_build_object('schedule_id',v_schedule.id,'assigned_profile_id',v_schedule.assigned_profile_id));
  return v_task;
end;
$$;

create or replace function public.create_v2_task_schedule_v2(p_template_id uuid,p_store_ids uuid[],p_profile_ids uuid[],p_fields jsonb)
returns setof public.v2_tasks language plpgsql security definer set search_path=public as $$
declare
  v_template public.v2_task_templates%rowtype; v_version public.v2_task_template_versions%rowtype; v_profile public.profiles%rowtype;
  v_store uuid; v_schedule public.v2_task_schedules%rowtype; v_task public.v2_tasks%rowtype;
  v_release_type text:=coalesce(p_fields->>'scheduleType',''); v_interval smallint:=nullif(p_fields->>'intervalDays','')::smallint;
  v_weekdays smallint[]:=coalesce(array(select value::smallint from jsonb_array_elements_text(coalesce(p_fields->'weekdays','[]'::jsonb)) value),'{}');
  v_month_day smallint:=nullif(p_fields->>'monthDay','')::smallint; v_publish_time time:=nullif(p_fields->>'publishTime','')::time;
  v_acceptance_type text:=coalesce(p_fields->>'acceptanceType',''); v_acceptance_days smallint:=nullif(p_fields->>'acceptanceIntervalDays','')::smallint;
  v_acceptance_weekday smallint:=nullif(p_fields->>'acceptanceWeekday','')::smallint; v_acceptance_month_day smallint:=nullif(p_fields->>'acceptanceMonthDay','')::smallint;
  v_acceptance_time time:=nullif(p_fields->>'acceptanceTime','')::time; v_now timestamptz:=now(); v_first_due timestamptz; v_next_release timestamptz;
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator role required'; end if;
  select * into v_template from public.v2_task_templates where id=p_template_id and status='published';
  if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then raise exception 'published template required'; end if;
  if v_publish_time is null or v_acceptance_time is null then raise exception '请设置发布和验收时间'; end if;
  if not ((v_release_type='interval_days' and v_interval between 1 and 31 and cardinality(v_weekdays)=0 and v_month_day is null)
    or (v_release_type='weekly' and v_interval is null and cardinality(v_weekdays) between 1 and 7 and v_month_day is null and not exists(select 1 from unnest(v_weekdays) day where day not between 1 and 7))
    or (v_release_type='monthly' and v_interval is null and cardinality(v_weekdays)=0 and v_month_day between 1 and 31)) then raise exception '请完善发布周期'; end if;
  if not ((v_acceptance_type='daily' and v_acceptance_days between 0 and 31 and v_acceptance_weekday is null and v_acceptance_month_day is null)
    or (v_acceptance_type='weekly' and v_acceptance_days is null and v_acceptance_weekday between 1 and 7 and v_acceptance_month_day is null)
    or (v_acceptance_type='monthly' and v_acceptance_days is null and v_acceptance_weekday is null and v_acceptance_month_day between 1 and 31)) then raise exception '请完善验收周期'; end if;
  select * into v_version from public.v2_task_template_versions where template_id=v_template.id and version_number=v_template.current_version;
  for v_profile in select distinct profile.* from public.profiles profile where coalesce(cardinality(p_profile_ids),0)>0 and profile.id=any(p_profile_ids) loop
    if not v_profile.is_active or v_profile.deleted_at is not null or v_profile.role not in ('staff','manager') or v_profile.store_id<>all(p_store_ids) or not public.has_store_access(v_profile.store_id) or not exists(select 1 from public.v2_task_template_stores where template_id=v_template.id and store_id=v_profile.store_id) then raise exception 'task recipient access denied'; end if;
    insert into public.v2_task_schedules(template_id,template_version_id,store_id,assigned_profile_id,schedule_type,interval_days,weekdays,month_day,publish_time,due_time,acceptance_type,acceptance_interval_days,acceptance_weekday,acceptance_month_day,next_due_at,last_published_at,created_by)
    values(v_template.id,v_version.id,v_profile.store_id,v_profile.id,v_release_type,case when v_release_type='interval_days' then v_interval end,case when v_release_type='weekly' then v_weekdays else '{}' end,case when v_release_type='monthly' then v_month_day end,v_publish_time,v_acceptance_time,v_acceptance_type,case when v_acceptance_type='daily' then v_acceptance_days end,case when v_acceptance_type='weekly' then v_acceptance_weekday end,case when v_acceptance_type='monthly' then v_acceptance_month_day end,v_now,v_now,auth.uid()) returning * into v_schedule;
    v_first_due:=public.v2_task_schedule_acceptance_due(v_schedule.id,v_now); v_next_release:=public.v2_task_schedule_next_due(v_schedule.id,v_now);
    if v_first_due<=v_now then raise exception '验收时间必须晚于立即发布时间'; end if;
    if v_first_due>=v_next_release then raise exception '验收截止时间必须早于下一次发布时间，请调整发布或验收周期'; end if;
    update public.v2_task_schedules set next_due_at=v_next_release where id=v_schedule.id;
    select * into v_task from public.create_v2_task_from_schedule(v_schedule.id,v_first_due); return next v_task;
  end loop;
  if coalesce(cardinality(p_profile_ids),0)>0 then return; end if;
  foreach v_store in array p_store_ids loop
    if not public.has_store_access(v_store) or not exists(select 1 from public.v2_task_template_stores where template_id=v_template.id and store_id=v_store) then raise exception 'template store access denied'; end if;
    insert into public.v2_task_schedules(template_id,template_version_id,store_id,schedule_type,interval_days,weekdays,month_day,publish_time,due_time,acceptance_type,acceptance_interval_days,acceptance_weekday,acceptance_month_day,next_due_at,last_published_at,created_by)
    values(v_template.id,v_version.id,v_store,v_release_type,case when v_release_type='interval_days' then v_interval end,case when v_release_type='weekly' then v_weekdays else '{}' end,case when v_release_type='monthly' then v_month_day end,v_publish_time,v_acceptance_time,v_acceptance_type,case when v_acceptance_type='daily' then v_acceptance_days end,case when v_acceptance_type='weekly' then v_acceptance_weekday end,case when v_acceptance_type='monthly' then v_acceptance_month_day end,v_now,v_now,auth.uid()) returning * into v_schedule;
    v_first_due:=public.v2_task_schedule_acceptance_due(v_schedule.id,v_now); v_next_release:=public.v2_task_schedule_next_due(v_schedule.id,v_now);
    if v_first_due<=v_now then raise exception '验收时间必须晚于立即发布时间'; end if;
    if v_first_due>=v_next_release then raise exception '验收截止时间必须早于下一次发布时间，请调整发布或验收周期'; end if;
    update public.v2_task_schedules set next_due_at=v_next_release where id=v_schedule.id;
    select * into v_task from public.create_v2_task_from_schedule(v_schedule.id,v_first_due); return next v_task;
  end loop;
end;
$$;

create or replace function public.update_v2_task_schedule_v2(p_schedule_id uuid,p_fields jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  s public.v2_task_schedules%rowtype; v_now timestamptz:=now(); v_due timestamptz; v_next timestamptz; v_following timestamptz;
  v_release_type text:=coalesce(p_fields->>'scheduleType',''); v_interval smallint:=nullif(p_fields->>'intervalDays','')::smallint;
  v_weekdays smallint[]:=coalesce(array(select value::smallint from jsonb_array_elements_text(coalesce(p_fields->'weekdays','[]'::jsonb)) value),'{}');
  v_month_day smallint:=nullif(p_fields->>'monthDay','')::smallint; v_publish_time time:=nullif(p_fields->>'publishTime','')::time;
  v_acceptance_type text:=coalesce(p_fields->>'acceptanceType',''); v_acceptance_days smallint:=nullif(p_fields->>'acceptanceIntervalDays','')::smallint;
  v_acceptance_weekday smallint:=nullif(p_fields->>'acceptanceWeekday','')::smallint; v_acceptance_month_day smallint:=nullif(p_fields->>'acceptanceMonthDay','')::smallint;
  v_acceptance_time time:=nullif(p_fields->>'acceptanceTime','')::time;
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator role required'; end if;
  select * into s from public.v2_task_schedules where id=p_schedule_id for update;
  if s.id is null or not public.has_store_access(s.store_id) then raise exception 'schedule access denied'; end if;
  if v_publish_time is null or v_acceptance_time is null then raise exception '请设置发布和验收时间'; end if;
  if not ((v_release_type='interval_days' and v_interval between 1 and 31 and cardinality(v_weekdays)=0 and v_month_day is null)
    or (v_release_type='weekly' and v_interval is null and cardinality(v_weekdays) between 1 and 7 and v_month_day is null)
    or (v_release_type='monthly' and v_interval is null and cardinality(v_weekdays)=0 and v_month_day between 1 and 31)) then raise exception '请完善发布周期'; end if;
  if not ((v_acceptance_type='daily' and v_acceptance_days between 0 and 31 and v_acceptance_weekday is null and v_acceptance_month_day is null)
    or (v_acceptance_type='weekly' and v_acceptance_days is null and v_acceptance_weekday between 1 and 7 and v_acceptance_month_day is null)
    or (v_acceptance_type='monthly' and v_acceptance_days is null and v_acceptance_weekday is null and v_acceptance_month_day between 1 and 31)) then raise exception '请完善验收周期'; end if;
  update public.v2_task_schedules set schedule_type=v_release_type,interval_days=case when v_release_type='interval_days' then v_interval end,weekdays=case when v_release_type='weekly' then v_weekdays else '{}' end,month_day=case when v_release_type='monthly' then v_month_day end,publish_time=v_publish_time,due_time=v_acceptance_time,acceptance_type=v_acceptance_type,acceptance_interval_days=case when v_acceptance_type='daily' then v_acceptance_days end,acceptance_weekday=case when v_acceptance_type='weekly' then v_acceptance_weekday end,acceptance_month_day=case when v_acceptance_type='monthly' then v_acceptance_month_day end where id=s.id returning * into s;
  v_due:=public.v2_task_schedule_acceptance_due(s.id,v_now); v_next:=public.v2_task_schedule_next_due(s.id,v_now); v_following:=public.v2_task_schedule_next_due(s.id,v_next);
  if v_due<=v_now then raise exception '验收时间必须晚于当前时间'; end if;
  if v_due>=v_next then raise exception '验收截止时间必须早于下一次发布时间，请调整发布或验收周期'; end if;
  if public.v2_task_schedule_acceptance_due(s.id,v_next)>=v_following then raise exception '后续验收截止时间会晚于下一次发布时间，请调整周期'; end if;
  update public.v2_task_schedules set next_due_at=v_next where id=s.id returning * into s;
  update public.v2_tasks set due_at=v_due,version=version+1 where schedule_id=s.id and status in ('pending','in_progress','rejected','overdue');
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(s.store_id,auth.uid(),'v2_task_schedule_updated','v2_task_schedules',s.id,p_fields);
  return to_jsonb(s);
end;
$$;

create or replace function public.update_v2_task_schedule_all(p_schedule_id uuid,p_fields jsonb,p_name text,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_schedule jsonb; v_content jsonb;
begin
  v_schedule:=public.update_v2_task_schedule_v2(p_schedule_id,p_fields);
  v_content:=public.update_v2_task_schedule_content(p_schedule_id,p_name,p_snapshot);
  return jsonb_build_object('schedule',v_schedule,'content',v_content);
end;
$$;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='v2_tasks') then
    alter publication supabase_realtime add table public.v2_tasks;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='v2_task_answers') then
    alter publication supabase_realtime add table public.v2_task_answers;
  end if;
end;
$$;

revoke all on function public.apply_v2_task_content(uuid,text,jsonb,timestamptz), public.update_v2_task_content(uuid,text,jsonb,timestamptz), public.get_v2_task_schedule_content(uuid), public.update_v2_task_schedule_content(uuid,text,jsonb), public.update_v2_task_schedule_all(uuid,jsonb,text,jsonb) from public, anon;
grant execute on function public.update_v2_task_content(uuid,text,jsonb,timestamptz), public.get_v2_task_schedule_content(uuid), public.update_v2_task_schedule_content(uuid,text,jsonb), public.update_v2_task_schedule_all(uuid,jsonb,text,jsonb) to authenticated;
