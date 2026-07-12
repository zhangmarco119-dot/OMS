create sequence public.v2_task_number_seq;

create table public.v2_tasks (
  id uuid primary key default gen_random_uuid(),
  task_no text not null unique default ('TSK-' || to_char(clock_timestamp(),'YYYYMMDD') || '-' || lpad(nextval('public.v2_task_number_seq')::text,8,'0')),
  template_id uuid not null references public.v2_task_templates(id),
  template_version_id uuid not null references public.v2_task_template_versions(id),
  store_id uuid not null references public.stores(id),
  name text not null,
  category text not null,
  snapshot jsonb not null,
  status text not null default 'pending' check (status in ('pending','in_progress','submitted','approved','rejected','resubmitted','overdue','cancelled')),
  due_at timestamptz not null,
  allow_overdue boolean not null default false,
  requires_review boolean not null default true,
  correction_item_ids uuid[] not null default '{}',
  version integer not null default 1,
  submission_key text,
  created_by uuid not null references public.profiles(id),
  started_by uuid references public.profiles(id), started_at timestamptz,
  submitted_by uuid references public.profiles(id), submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
  review_note text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.v2_task_answers (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.v2_tasks(id) on delete cascade,
  item_id uuid not null, group_id uuid not null, item_snapshot jsonb not null,
  answer jsonb, note text not null default '', is_issue boolean not null default false,
  updated_by uuid references public.profiles(id), updated_at timestamptz not null default now(),
  unique(task_id,item_id)
);

create table public.v2_task_images (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.v2_tasks(id) on delete cascade,
  item_id uuid not null, store_id uuid not null references public.stores(id), bucket text not null default 'v2-task-images',
  object_path text not null unique, file_name text not null, mime_type text not null,
  size_bytes bigint not null check(size_bytes>0 and size_bytes<=10485760), uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.v2_task_reviews (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.v2_tasks(id) on delete cascade,
  action text not null check(action in ('submitted','approved','rejected','resubmitted')),
  actor_id uuid not null references public.profiles(id), note text not null default '', correction_item_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index v2_tasks_store_status_due_idx on public.v2_tasks(store_id,status,due_at);
create index v2_task_answers_task_idx on public.v2_task_answers(task_id);
create index v2_task_images_task_item_idx on public.v2_task_images(task_id,item_id);
create index v2_task_reviews_task_idx on public.v2_task_reviews(task_id,created_at);
create trigger v2_tasks_touch_updated_at before update on public.v2_tasks for each row execute function public.touch_updated_at();

create or replace function public.can_read_v2_task(p_task_id uuid) returns boolean language sql security definer set search_path=public stable as $$
 select exists(select 1 from public.v2_tasks t where t.id=p_task_id and public.has_store_access(t.store_id) and (public.current_user_role()='admin' or (public.current_user_role() in ('staff','manager') and t.store_id=public.current_user_store_id())))
$$;
create or replace function public.can_edit_v2_task(p_task_id uuid) returns boolean language sql security definer set search_path=public stable as $$
 select exists(select 1 from public.v2_tasks t where t.id=p_task_id and t.store_id=public.current_user_store_id() and public.current_user_role() in ('staff','manager') and public.has_store_access(t.store_id) and (t.status in ('pending','in_progress','rejected') or (t.status='overdue' and t.allow_overdue)))
$$;

alter table public.v2_tasks enable row level security; alter table public.v2_task_answers enable row level security;
alter table public.v2_task_images enable row level security; alter table public.v2_task_reviews enable row level security;
create policy v2_tasks_select_allowed on public.v2_tasks for select to authenticated using(public.can_read_v2_task(id));
create policy v2_task_answers_select_allowed on public.v2_task_answers for select to authenticated using(public.can_read_v2_task(task_id));
create policy v2_task_images_select_allowed on public.v2_task_images for select to authenticated using(public.can_read_v2_task(task_id));
create policy v2_task_images_insert_allowed on public.v2_task_images for insert to authenticated with check(uploaded_by=auth.uid() and public.can_edit_v2_task(task_id));
create policy v2_task_images_delete_allowed on public.v2_task_images for delete to authenticated using(uploaded_by=auth.uid() and public.can_edit_v2_task(task_id));
create policy v2_task_reviews_select_allowed on public.v2_task_reviews for select to authenticated using(public.can_read_v2_task(task_id));

create or replace function public.publish_v2_tasks(p_template_id uuid,p_store_ids uuid[],p_due_at timestamptz)
returns setof public.v2_tasks language plpgsql security definer set search_path=public as $$
declare v_template public.v2_task_templates%rowtype; v_version public.v2_task_template_versions%rowtype; v_store uuid; v_task public.v2_tasks%rowtype; v_group jsonb; v_item jsonb;
begin
 if public.current_user_role()<>'admin' then raise exception 'administrator role required' using errcode='42501'; end if;
 select * into v_template from public.v2_task_templates where id=p_template_id and status='published';
 if v_template.id is null or not public.can_manage_v2_task_template(v_template.id) then raise exception 'published template required' using errcode='42501'; end if;
 select * into v_version from public.v2_task_template_versions where template_id=v_template.id and version_number=v_template.current_version;
 if p_due_at<=now() then raise exception 'due time must be in the future' using errcode='22023'; end if;
 foreach v_store in array p_store_ids loop
  if not public.has_store_access(v_store) or not exists(select 1 from public.v2_task_template_stores where template_id=v_template.id and store_id=v_store) then raise exception 'template store access denied' using errcode='42501'; end if;
  insert into public.v2_tasks(template_id,template_version_id,store_id,name,category,snapshot,due_at,allow_overdue,requires_review,created_by)
  values(v_template.id,v_version.id,v_store,v_template.name,v_template.category,v_version.snapshot,p_due_at,v_template.allow_overdue,v_template.requires_review,auth.uid()) returning * into v_task;
  for v_group in select value from jsonb_array_elements(v_version.snapshot->'groups') loop
   for v_item in select value from jsonb_array_elements(v_group->'items') loop
    insert into public.v2_task_answers(task_id,item_id,group_id,item_snapshot)
    values(v_task.id,(v_item->>'id')::uuid,(v_group->>'id')::uuid,v_item);
   end loop;
  end loop;
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(v_store,auth.uid(),'v2_task_published','v2_tasks',v_task.id,jsonb_build_object('template',v_template.name));
  return next v_task;
 end loop;
end $$;

create or replace function public.save_v2_task_progress(p_task_id uuid,p_expected_version integer,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_task public.v2_tasks%rowtype; v_answer jsonb;
begin
 select * into v_task from public.v2_tasks where id=p_task_id for update;
 if not public.can_edit_v2_task(p_task_id) then raise exception 'task edit denied' using errcode='42501'; end if;
 if v_task.version<>p_expected_version then raise exception 'task version conflict' using errcode='40001'; end if;
 for v_answer in select value from jsonb_array_elements(coalesce(p_answers,'[]')) loop
  update public.v2_task_answers set answer=v_answer->'answer',note=coalesce(v_answer->>'note',''),is_issue=coalesce((v_answer->>'is_issue')::boolean,false),updated_by=auth.uid(),updated_at=now()
  where task_id=p_task_id and item_id=(v_answer->>'item_id')::uuid;
  if not found then raise exception 'task item not found' using errcode='P0002'; end if;
 end loop;
 update public.v2_tasks set status=case when status='pending' then 'in_progress' else status end,started_by=coalesce(started_by,auth.uid()),started_at=coalesce(started_at,now()),version=version+1 where id=p_task_id returning * into v_task;
 return to_jsonb(v_task);
end $$;

create or replace function public.submit_v2_task(p_task_id uuid,p_expected_version integer,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_task public.v2_tasks%rowtype; v_missing integer;
begin
 select * into v_task from public.v2_tasks where id=p_task_id for update;
 if not public.can_edit_v2_task(p_task_id) then raise exception 'task submit denied' using errcode='42501'; end if;
 if v_task.version<>p_expected_version then raise exception 'task version conflict' using errcode='40001'; end if;
 select count(*) into v_missing from public.v2_task_answers a where a.task_id=p_task_id and coalesce((a.item_snapshot->>'is_required')::boolean,true) and coalesce(a.item_snapshot->>'field_type','')<>'instruction' and (a.answer is null or a.answer='null'::jsonb or a.answer='""'::jsonb);
 if v_missing>0 then raise exception 'required task answers are missing' using errcode='23514'; end if;
 update public.v2_tasks set status=case when status='rejected' then 'resubmitted' when requires_review then 'submitted' else 'approved' end,submission_key=p_key,submitted_by=auth.uid(),submitted_at=now(),correction_item_ids='{}',version=version+1 where id=p_task_id returning * into v_task;
 insert into public.v2_task_reviews(task_id,action,actor_id) values(p_task_id,case when v_task.status='resubmitted' then 'resubmitted' else 'submitted' end,auth.uid());
 insert into public.notifications(recipient_role,store_id,type,title,body,entity_type,entity_id,dedupe_key) values('admin',v_task.store_id,'v2_task_submitted','任务待审核',v_task.name,'v2_task',v_task.id,'v2-task-submitted:'||v_task.id||':'||v_task.version) on conflict(dedupe_key) do nothing;
 return to_jsonb(v_task);
end $$;

create or replace function public.review_v2_task(p_task_id uuid,p_action text,p_note text,p_correction_item_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_task public.v2_tasks%rowtype;
begin
 select * into v_task from public.v2_tasks where id=p_task_id for update;
 if public.current_user_role()<>'admin' or not public.has_store_access(v_task.store_id) then raise exception 'review denied' using errcode='42501'; end if;
 if v_task.status not in ('submitted','resubmitted') then raise exception 'task is not reviewable' using errcode='55000'; end if;
 if p_action not in ('approved','rejected') then raise exception 'invalid review action' using errcode='22023'; end if;
 if p_action='rejected' and (btrim(coalesce(p_note,''))='' or coalesce(array_length(p_correction_item_ids,1),0)=0) then raise exception 'rejection reason and correction items required' using errcode='22023'; end if;
 update public.v2_tasks set status=p_action,reviewed_by=auth.uid(),reviewed_at=now(),review_note=p_note,correction_item_ids=case when p_action='rejected' then p_correction_item_ids else '{}' end,version=version+1 where id=p_task_id returning * into v_task;
 insert into public.v2_task_reviews(task_id,action,actor_id,note,correction_item_ids) values(p_task_id,p_action,auth.uid(),coalesce(p_note,''),coalesce(p_correction_item_ids,'{}'));
 insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(v_task.store_id,auth.uid(),'v2_task_'||p_action,'v2_tasks',v_task.id,jsonb_build_object('note',p_note));
 return to_jsonb(v_task);
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('v2-task-images','v2-task-images',false,10485760,array['image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy v2_task_storage_select on storage.objects for select to authenticated using(bucket_id='v2-task-images' and exists(select 1 from public.v2_task_images i where i.object_path=name and public.can_read_v2_task(i.task_id)));
create policy v2_task_storage_insert on storage.objects for insert to authenticated with check(bucket_id='v2-task-images' and (storage.foldername(name))[1]=public.current_user_store_id()::text);
create policy v2_task_storage_delete on storage.objects for delete to authenticated using(bucket_id='v2-task-images' and owner_id=auth.uid()::text);

revoke insert,update,delete on public.v2_tasks,public.v2_task_answers,public.v2_task_reviews from authenticated;
revoke update on public.v2_task_images from authenticated;
grant select on public.v2_tasks,public.v2_task_answers,public.v2_task_images,public.v2_task_reviews to authenticated;
grant insert,delete on public.v2_task_images to authenticated;
grant execute on function public.can_read_v2_task(uuid),public.can_edit_v2_task(uuid),public.publish_v2_tasks(uuid,uuid[],timestamptz),public.save_v2_task_progress(uuid,integer,jsonb),public.submit_v2_task(uuid,integer,text),public.review_v2_task(uuid,text,text,uuid[]) to authenticated;
