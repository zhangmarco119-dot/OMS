-- StoreHub V2: durable notice assets, expiry/acknowledgment and actionable notifications.
alter table public.v2_notices add column expires_at timestamptz;

create table public.v2_notice_assets (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.v2_notices(id) on delete cascade,
  bucket text not null default 'v2-notice-assets' check(bucket='v2-notice-assets'),
  object_path text not null unique,
  file_name text not null,
  mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes bigint not null check(size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index v2_notice_assets_notice_idx on public.v2_notice_assets(notice_id, created_at);

create or replace function public.can_read_v2_notice(p_notice_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.can_manage_v2_notice(p_notice_id) or exists(
    select 1 from public.v2_notice_recipients recipient
    join public.v2_notices notice on notice.id=recipient.notice_id
    where recipient.notice_id=p_notice_id and recipient.profile_id=auth.uid()
      and notice.status='published' and (notice.expires_at is null or notice.expires_at > now())
  )
$$;

create policy v2_notice_assets_select_allowed on public.v2_notice_assets for select to authenticated using(public.can_read_v2_notice(notice_id));
create policy v2_notice_assets_insert_admin on public.v2_notice_assets for insert to authenticated with check(uploaded_by=auth.uid() and public.can_manage_v2_notice(notice_id));
create policy v2_notice_assets_delete_admin on public.v2_notice_assets for delete to authenticated using(uploaded_by=auth.uid() and public.can_manage_v2_notice(notice_id));
alter table public.v2_notice_assets enable row level security;
grant select,insert,delete on public.v2_notice_assets to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('v2-notice-assets','v2-notice-assets',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy v2_notice_asset_storage_select on storage.objects for select to authenticated using(bucket_id='v2-notice-assets' and exists(select 1 from public.v2_notice_assets asset where asset.object_path=name and public.can_read_v2_notice(asset.notice_id)));
create policy v2_notice_asset_storage_insert on storage.objects for insert to authenticated with check(bucket_id='v2-notice-assets' and public.current_user_role()='admin');
create policy v2_notice_asset_storage_delete on storage.objects for delete to authenticated using(bucket_id='v2-notice-assets' and owner_id=auth.uid()::text);

create or replace function public.save_v2_notice(p_notice_id uuid, p_fields jsonb, p_store_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_notice public.v2_notices%rowtype; v_title text:=btrim(coalesce(p_fields->>'title','')); v_body text:=coalesce(p_fields->>'body',''); v_pinned boolean:=coalesce((p_fields->>'is_pinned')::boolean,false); v_requires_ack boolean:=coalesce((p_fields->>'requires_acknowledgment')::boolean,false); v_expires_at timestamptz:=nullif(p_fields->>'expires_at','')::timestamptz; v_store_id uuid; v_profile_id uuid;
begin
 if public.current_user_role()<>'admin' then raise exception 'administrator role required' using errcode='42501'; end if;
 if v_title='' then raise exception 'notice title is required' using errcode='22023'; end if;
 if v_expires_at is not null and v_expires_at<=now() then raise exception 'notice expiry must be in the future' using errcode='22023'; end if;
 if coalesce(cardinality(p_store_ids),0)=0 then raise exception 'at least one notice store is required' using errcode='22023'; end if;
 foreach v_store_id in array p_store_ids loop if not public.has_store_access(v_store_id) then raise exception 'notice store access denied' using errcode='42501'; end if; end loop;
 if p_notice_id is null then insert into public.v2_notices(title,body,is_pinned,requires_acknowledgment,expires_at,created_by) values(v_title,v_body,v_pinned,v_requires_ack,v_expires_at,auth.uid()) returning * into v_notice;
 else if not public.can_manage_v2_notice(p_notice_id) then raise exception 'notice management denied' using errcode='42501'; end if; update public.v2_notices set title=v_title,body=v_body,is_pinned=v_pinned,requires_acknowledgment=v_requires_ack,expires_at=v_expires_at where id=p_notice_id returning * into v_notice; delete from public.v2_notice_stores where notice_id=v_notice.id; delete from public.v2_notice_recipients where notice_id=v_notice.id; end if;
 insert into public.v2_notice_stores(notice_id,store_id) select v_notice.id,unnest(p_store_ids);
 for v_profile_id in select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(p_fields->'recipient_ids','[]'::jsonb)) loop
   insert into public.v2_notice_recipients(notice_id,profile_id,store_id,role_snapshot) select v_notice.id,p.id,p.store_id,p.role from public.profiles p where p.id=v_profile_id and p.role in ('staff','manager') and p.is_active and p.deleted_at is null and p.store_id=any(p_store_ids) on conflict do nothing;
 end loop;
 if not exists(select 1 from public.v2_notice_recipients where notice_id=v_notice.id) then raise exception 'at least one notice recipient is required' using errcode='22023'; end if;
 return to_jsonb(v_notice);
end $$;

create or replace function public.acknowledge_v2_notice(p_notice_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not public.can_read_v2_notice(p_notice_id) or public.current_user_role()='admin' then raise exception 'notice acknowledgement denied' using errcode='42501'; end if;
 update public.v2_notice_recipients set acknowledged_at=coalesce(acknowledged_at,now()),first_read_at=coalesce(first_read_at,now()),last_read_at=now() where notice_id=p_notice_id and profile_id=auth.uid();
 if not found then raise exception 'notice recipient required' using errcode='42501'; end if;
 return jsonb_build_object('notice_id',p_notice_id,'acknowledged_at',now());
end $$;

create or replace function public.publish_v2_sop(p_sop_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_sop public.v2_sops%rowtype;
begin
 if not public.can_manage_v2_sop(p_sop_id) then raise exception 'sop management denied' using errcode='42501'; end if;
 update public.v2_sops set status='published',published_at=coalesce(published_at,now()),version=version+1 where id=p_sop_id returning * into v_sop;
 insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
 select p.id,p.store_id,'sop_published',v_sop.title,left(v_sop.body,180),'v2_sop',v_sop.id,'sop:'||v_sop.id||':'||p.id
 from public.profiles p join public.v2_sop_stores ss on ss.store_id=p.store_id join public.v2_sop_roles sr on sr.sop_id=ss.sop_id and sr.role=p.role
 where ss.sop_id=v_sop.id and p.is_active and p.deleted_at is null
 on conflict(dedupe_key) do nothing;
 return to_jsonb(v_sop);
end $$;

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
  insert into public.v2_tasks(template_id,template_version_id,store_id,name,category,snapshot,due_at,allow_overdue,requires_review,created_by) values(v_template.id,v_version.id,v_store,v_template.name,v_template.category,v_version.snapshot,p_due_at,v_template.allow_overdue,v_template.requires_review,auth.uid()) returning * into v_task;
  for v_group in select value from jsonb_array_elements(v_version.snapshot->'groups') loop for v_item in select value from jsonb_array_elements(v_group->'items') loop insert into public.v2_task_answers(task_id,item_id,group_id,item_snapshot) values(v_task.id,(v_item->>'id')::uuid,(v_group->>'id')::uuid,v_item); end loop; end loop;
  insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key) select p.id,v_store,'v2_task_published','新任务：'||v_task.name,'截止时间：'||to_char(v_task.due_at,'YYYY-MM-DD HH24:MI'),'v2_task',v_task.id,'v2-task-published:'||v_task.id||':'||p.id from public.profiles p where p.store_id=v_store and p.role in ('staff','manager') and p.is_active and p.deleted_at is null on conflict(dedupe_key) do nothing;
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(v_store,auth.uid(),'v2_task_published','v2_tasks',v_task.id,jsonb_build_object('template',v_template.name));
  return next v_task;
 end loop;
end $$;

create or replace function public.review_v2_task(p_task_id uuid,p_action text,p_note text,p_correction_item_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_task public.v2_tasks%rowtype;
begin
 select * into v_task from public.v2_tasks where id=p_task_id for update;
 if public.current_user_role()<>'admin' or not public.has_store_access(v_task.store_id) then raise exception 'review denied' using errcode='42501'; end if;
 if v_task.status not in ('submitted','resubmitted') then raise exception 'task is not reviewable' using errcode='55000'; end if;
 if p_action not in ('approved','rejected') then raise exception 'invalid review action' using errcode='22023'; end if;
 if p_action='rejected' and (btrim(coalesce(p_note,''))='' or coalesce(array_length(p_correction_item_ids,1),0)=0) then raise exception 'rejection reason and correction items required' using errcode='23514'; end if;
 update public.v2_tasks set status=p_action,reviewed_by=auth.uid(),reviewed_at=now(),review_note=p_note,correction_item_ids=case when p_action='rejected' then p_correction_item_ids else '{}' end,version=version+1 where id=p_task_id returning * into v_task;
 insert into public.v2_task_reviews(task_id,action,actor_id,note,correction_item_ids) values(p_task_id,p_action,auth.uid(),coalesce(p_note,''),coalesce(p_correction_item_ids,'{}'));
 insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key) values(coalesce(v_task.submitted_by,v_task.started_by),v_task.store_id,'v2_task_'||p_action,case when p_action='approved' then '任务审核通过' else '任务需要整改' end,case when p_action='approved' then v_task.name else left(p_note,180) end,'v2_task',v_task.id,'v2-task-review:'||v_task.id||':'||v_task.version) on conflict(dedupe_key) do nothing;
 insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(v_task.store_id,auth.uid(),'v2_task_'||p_action,'v2_tasks',v_task.id,jsonb_build_object('note',p_note));
 return to_jsonb(v_task);
end $$;

revoke all on function public.acknowledge_v2_notice(uuid) from public;
grant execute on function public.acknowledge_v2_notice(uuid) to authenticated;
