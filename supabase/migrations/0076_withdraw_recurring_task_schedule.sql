-- A recurring schedule withdrawal is permanent and differs from pausing or
-- withdrawing only the current occurrence.

alter table public.v2_task_schedules
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_by uuid references public.profiles(id);

create or replace function public.withdraw_v2_task_schedule(p_schedule_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.v2_task_schedules%rowtype; v_count integer;
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator role required' using errcode='42501'; end if;
  select * into s from public.v2_task_schedules where id=p_schedule_id for update;
  if s.id is null or not public.has_store_access(s.store_id) then raise exception 'schedule access denied' using errcode='42501'; end if;
  if s.withdrawn_at is not null then return jsonb_build_object('scheduleId',s.id,'cancelledTasks',0); end if;
  update public.v2_tasks set status='cancelled',version=version+1 where schedule_id=s.id and status in ('pending','in_progress','rejected','overdue');
  get diagnostics v_count=row_count;
  update public.v2_task_schedules set is_active=false,paused_at=now(),paused_by=auth.uid(),withdrawn_at=now(),withdrawn_by=auth.uid() where id=s.id;
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata) values(s.store_id,auth.uid(),'v2_task_schedule_withdrawn','v2_task_schedules',s.id,jsonb_build_object('cancelled_tasks',v_count));
  return jsonb_build_object('scheduleId',s.id,'cancelledTasks',v_count);
end;
$$;

revoke all on function public.withdraw_v2_task_schedule(uuid) from public, anon;
grant execute on function public.withdraw_v2_task_schedule(uuid) to authenticated;
