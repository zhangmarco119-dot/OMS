create table public.profile_product_permissions (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  can_request_new boolean not null default true,
  can_request_incorrect boolean not null default true,
  can_request_discontinued boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger profile_product_permissions_touch_updated_at before update on public.profile_product_permissions for each row execute function public.touch_updated_at();

create or replace function public.can_request_product_feedback(p_feedback_type text)
returns boolean language sql security definer set search_path = public stable as $$
  select public.current_user_role() in ('staff', 'manager') and case p_feedback_type
    when 'new' then coalesce((select can_request_new from public.profile_product_permissions where profile_id = auth.uid()), true)
    when 'incorrect' then coalesce((select can_request_incorrect from public.profile_product_permissions where profile_id = auth.uid()), true)
    when 'discontinued' then coalesce((select can_request_discontinued from public.profile_product_permissions where profile_id = auth.uid()), true)
    else false end
$$;

create or replace function public.admin_set_product_permissions(p_profile_id uuid, p_can_request_new boolean, p_can_request_incorrect boolean, p_can_request_discontinued boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.profile_product_permissions%rowtype;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator role required' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and role in ('staff','manager') and is_active and deleted_at is null) then raise exception 'active staff or manager profile required' using errcode = '22023'; end if;
  insert into public.profile_product_permissions(profile_id,can_request_new,can_request_incorrect,can_request_discontinued,updated_by)
  values(p_profile_id,p_can_request_new,p_can_request_incorrect,p_can_request_discontinued,auth.uid())
  on conflict(profile_id) do update set can_request_new=excluded.can_request_new,can_request_incorrect=excluded.can_request_incorrect,can_request_discontinued=excluded.can_request_discontinued,updated_by=auth.uid(),updated_at=now()
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

alter table public.profile_product_permissions enable row level security;
create policy profile_product_permissions_select_own_or_admin on public.profile_product_permissions for select to authenticated using (profile_id = auth.uid() or public.current_user_role() = 'admin');
grant select on public.profile_product_permissions to authenticated;
revoke all on function public.can_request_product_feedback(text), public.admin_set_product_permissions(uuid,boolean,boolean,boolean) from public;
grant execute on function public.can_request_product_feedback(text), public.admin_set_product_permissions(uuid,boolean,boolean,boolean) to authenticated;

drop policy if exists product_feedback_insert_allowed on public.product_feedback;
create policy product_feedback_insert_allowed on public.product_feedback for insert to authenticated with check (
  created_by = auth.uid() and public.has_store_access(store_id) and public.can_request_product_feedback(feedback_type)
);

create table public.v2_notice_recipients (
  notice_id uuid not null references public.v2_notices(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  role_snapshot text not null check(role_snapshot in ('staff','manager')),
  first_read_at timestamptz,
  last_read_at timestamptz,
  dismissed_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(notice_id,profile_id)
);
alter table public.v2_notices add column requires_acknowledgment boolean not null default false;
create index v2_notice_recipients_profile_idx on public.v2_notice_recipients(profile_id,notice_id);
insert into public.v2_notice_recipients(notice_id,profile_id,store_id,role_snapshot)
select notice.id, profile.id, profile.store_id, profile.role
from public.v2_notices notice
join public.v2_notice_stores assignment on assignment.notice_id=notice.id
join public.profiles profile on profile.store_id=assignment.store_id
where profile.role in ('staff','manager') and profile.is_active and profile.deleted_at is null
on conflict do nothing;

create or replace function public.can_read_v2_notice(p_notice_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.can_manage_v2_notice(p_notice_id) or exists(select 1 from public.v2_notice_recipients recipient join public.v2_notices notice on notice.id=recipient.notice_id where recipient.notice_id=p_notice_id and recipient.profile_id=auth.uid() and notice.status='published')
$$;
alter table public.v2_notice_recipients enable row level security;
create policy v2_notice_recipients_select_self_or_admin on public.v2_notice_recipients for select to authenticated using (profile_id=auth.uid() or public.can_manage_v2_notice(notice_id));
grant select on public.v2_notice_recipients to authenticated;

create or replace function public.save_v2_notice(p_notice_id uuid, p_fields jsonb, p_store_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_notice public.v2_notices%rowtype; v_title text:=btrim(coalesce(p_fields->>'title','')); v_body text:=coalesce(p_fields->>'body',''); v_pinned boolean:=coalesce((p_fields->>'is_pinned')::boolean,false); v_requires_ack boolean:=coalesce((p_fields->>'requires_acknowledgment')::boolean,false); v_store_id uuid; v_profile_id uuid;
begin
 if public.current_user_role()<>'admin' then raise exception 'administrator role required' using errcode='42501'; end if;
 if v_title='' then raise exception 'notice title is required' using errcode='22023'; end if;
 if coalesce(cardinality(p_store_ids),0)=0 then raise exception 'at least one notice store is required' using errcode='22023'; end if;
 foreach v_store_id in array p_store_ids loop if not public.has_store_access(v_store_id) then raise exception 'notice store access denied' using errcode='42501'; end if; end loop;
 if p_notice_id is null then insert into public.v2_notices(title,body,is_pinned,requires_acknowledgment,created_by) values(v_title,v_body,v_pinned,v_requires_ack,auth.uid()) returning * into v_notice;
 else if not public.can_manage_v2_notice(p_notice_id) then raise exception 'notice management denied' using errcode='42501'; end if; update public.v2_notices set title=v_title,body=v_body,is_pinned=v_pinned,requires_acknowledgment=v_requires_ack where id=p_notice_id returning * into v_notice; delete from public.v2_notice_stores where notice_id=v_notice.id; delete from public.v2_notice_recipients where notice_id=v_notice.id; end if;
 insert into public.v2_notice_stores(notice_id,store_id) select v_notice.id,unnest(p_store_ids);
 for v_profile_id in select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(p_fields->'recipient_ids','[]'::jsonb)) loop
   insert into public.v2_notice_recipients(notice_id,profile_id,store_id,role_snapshot) select v_notice.id,p.id,p.store_id,p.role from public.profiles p where p.id=v_profile_id and p.role in ('staff','manager') and p.is_active and p.deleted_at is null and p.store_id=any(p_store_ids) on conflict do nothing;
 end loop;
 if not exists(select 1 from public.v2_notice_recipients where notice_id=v_notice.id) then raise exception 'at least one notice recipient is required' using errcode='22023'; end if;
 return to_jsonb(v_notice);
end $$;

create or replace function public.publish_v2_notice(p_notice_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_notice public.v2_notices%rowtype;
begin
 if not public.can_manage_v2_notice(p_notice_id) then raise exception 'notice management denied' using errcode='42501'; end if;
 if not exists(select 1 from public.v2_notice_recipients where notice_id=p_notice_id) then raise exception 'notice recipients required' using errcode='22023'; end if;
 update public.v2_notices set status='published',published_at=coalesce(published_at,now()),retracted_at=null where id=p_notice_id returning * into v_notice;
 insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key) select r.profile_id,r.store_id,'notice_published',v_notice.title,left(v_notice.body,180),'v2_notice',v_notice.id,'notice:'||v_notice.id||':'||r.profile_id from public.v2_notice_recipients r where r.notice_id=v_notice.id on conflict(dedupe_key) do nothing;
 return to_jsonb(v_notice);
end $$;

create or replace function public.mark_v2_notice_read(p_notice_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
 if not public.can_read_v2_notice(p_notice_id) or public.current_user_role()='admin' then raise exception 'notice read denied' using errcode='42501'; end if;
 update public.v2_notice_recipients set first_read_at=coalesce(first_read_at,now()),last_read_at=now() where notice_id=p_notice_id and profile_id=auth.uid();
 if not found then raise exception 'notice recipient required' using errcode='42501'; end if;
 update public.notifications set is_read=true,read_at=now() where recipient_user_id=auth.uid() and entity_type='v2_notice' and entity_id=p_notice_id and not is_read;
 return jsonb_build_object('notice_id',p_notice_id,'read_at',now());
end $$;

create policy notifications_update_own on public.notifications for update to authenticated using(recipient_user_id=auth.uid()) with check(recipient_user_id=auth.uid());

create or replace function public.resume_v2_task_schedule(p_schedule_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_schedule public.v2_task_schedules%rowtype;
begin
 if public.current_user_role()<>'admin' then raise exception 'administrator role required' using errcode='42501'; end if;
 select * into v_schedule from public.v2_task_schedules where id=p_schedule_id for update;
 if v_schedule.id is null or not public.has_store_access(v_schedule.store_id) then raise exception 'schedule access denied' using errcode='42501'; end if;
 if v_schedule.is_active then return to_jsonb(v_schedule); end if;
 update public.v2_task_schedules set is_active=true,paused_at=null,paused_by=null,next_due_at=case when v_schedule.next_due_at<=now() then public.v2_task_schedule_next_due(v_schedule.id,now()) else v_schedule.next_due_at end where id=v_schedule.id returning * into v_schedule;
 insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(v_schedule.store_id,auth.uid(),'v2_task_schedule_resumed','v2_task_schedules',v_schedule.id,jsonb_build_object('next_due_at',v_schedule.next_due_at));
 return to_jsonb(v_schedule);
end $$;
revoke all on function public.resume_v2_task_schedule(uuid) from public;
grant execute on function public.resume_v2_task_schedule(uuid) to authenticated;
