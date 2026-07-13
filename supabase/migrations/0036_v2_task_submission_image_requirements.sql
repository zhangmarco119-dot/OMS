-- Keep server-side submission rules aligned with the template's image_requirement,
-- including non-image fields such as confirmation + required evidence photo.
create or replace function public.submit_v2_task(p_task_id uuid,p_expected_version integer,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_task public.v2_tasks%rowtype; v_missing integer;
begin
 select * into v_task from public.v2_tasks where id=p_task_id for update;
 if not public.can_edit_v2_task(p_task_id) then raise exception 'task submit denied' using errcode='42501'; end if;
 if v_task.version<>p_expected_version then raise exception 'task version conflict' using errcode='40001'; end if;

 select count(*) into v_missing
 from public.v2_task_answers a
 where a.task_id=p_task_id
   and coalesce((a.item_snapshot->>'is_required')::boolean,true)
   and (
     (
       (coalesce(a.item_snapshot->>'field_type','') in ('image','multi_image') or coalesce(a.item_snapshot->>'image_requirement','none') in ('single','multiple'))
       and not exists(select 1 from public.v2_task_images i where i.task_id=a.task_id and i.item_id=a.item_id)
     )
     or case coalesce(a.item_snapshot->>'field_type','')
       when 'instruction' then false
       when 'image' then false
       when 'multi_image' then false
       when 'confirmation' then a.answer is distinct from 'true'::jsonb
       when 'multi_choice' then a.answer is null or a.answer='null'::jsonb or (jsonb_typeof(a.answer)='array' and jsonb_array_length(a.answer)=0)
       else a.answer is null or a.answer='null'::jsonb or a.answer='""'::jsonb
     end
   );
 if v_missing>0 then raise exception 'required task answers or images are missing' using errcode='23514'; end if;

 update public.v2_tasks set status=case when status='rejected' then 'resubmitted' when requires_review then 'submitted' else 'approved' end,
 submission_key=p_key,submitted_by=auth.uid(),submitted_at=now(),correction_item_ids='{}',version=version+1
 where id=p_task_id returning * into v_task;
 insert into public.v2_task_reviews(task_id,action,actor_id) values(p_task_id,case when v_task.status='resubmitted' then 'resubmitted' else 'submitted' end,auth.uid());
 insert into public.notifications(recipient_role,store_id,type,title,body,entity_type,entity_id,dedupe_key)
 values('admin',v_task.store_id,'v2_task_submitted','任务待审核',v_task.name,'v2_task',v_task.id,'v2-task-submitted:'||v_task.id||':'||v_task.version)
 on conflict(dedupe_key) do nothing;
 return to_jsonb(v_task);
end $$;

grant execute on function public.submit_v2_task(uuid,integer,text) to authenticated;
