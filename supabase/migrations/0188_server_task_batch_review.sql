-- One network request per batch. Reuse the existing review functions so audits,
-- notifications, product corrections and linked inventory keep their semantics.
-- A recount is a new sheet for the same submitter; uniqueness only applies to
-- the initial sheet. The old index otherwise prevents linked-task rejection.
create unique index if not exists tasks_linked_v2_initial_creator_idx
  on public.tasks(linked_v2_task_id, created_by)
  where linked_v2_task_id is not null and not inventory_recount_only;
drop index if exists public.tasks_linked_v2_task_creator_idx;

create or replace function public.review_v2_tasks_batch(p_task_ids uuid[], p_action text, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_task public.v2_tasks%rowtype;
  v_inventory_id uuid;
  v_decisions jsonb;
  v_rejected_ids uuid[];
  v_results jsonb := '[]'::jsonb;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception '仅管理员可以批量审批任务' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('approved', 'rejected') then
    raise exception '无效的审批操作' using errcode = '22023';
  end if;
  if p_action = 'rejected' and btrim(coalesce(p_note, '')) = '' then
    raise exception '批量拒绝时请填写整改原因' using errcode = '23514';
  end if;
  if coalesce(cardinality(p_task_ids), 0) = 0 or cardinality(p_task_ids) > 500
     or array_position(p_task_ids, null) is not null then
    raise exception '每次请选择 1 至 500 项任务' using errcode = '22023';
  end if;
  -- Stable lock order prevents concurrent batches from deadlocking each other.
  for v_id in select distinct id from unnest(p_task_ids) id order by id loop
    begin
      select * into v_task from public.v2_tasks where id = v_id for update;
      if v_task.id is null or not public.can_review_v2_task(v_id) then
        raise exception '任务已处理或当前账号没有审核权限' using errcode = '42501';
      end if;
      select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', item_id, 'decision', p_action,
        'note', case when p_action = 'rejected' then btrim(p_note) else '' end
      ) order by item_id), '[]'::jsonb) into v_decisions
      from public.v2_task_answers
      where task_id = v_id
        and review_status = case when v_task.status = 'resubmitted' then 'resubmitted' else 'pending' end;

      if v_task.requires_inventory then
        select id into v_inventory_id from public.tasks
        where linked_v2_task_id = v_id and task_type = 'inventory' and status = 'submitted'
          and (v_task.inventory_correction_task_id is null or id = v_task.inventory_correction_task_id)
        order by submitted_at desc, id limit 1 for update;
        if v_inventory_id is null then
          raise exception '关联点货单尚未提交，暂时不能完成审核' using errcode = '55000';
        end if;
        select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_rejected_ids
        from public.task_items where task_id = v_inventory_id and p_action = 'rejected';
        perform public.review_v2_task_items_with_inventory(v_id, v_decisions, btrim(coalesce(p_note, '')), v_inventory_id, v_rejected_ids);
      else
        perform public.review_v2_task_items(v_id, v_decisions, btrim(coalesce(p_note, '')));
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_id, 'success', true));
    exception when others then
      -- Roll back the failed task only; a valid task elsewhere in the batch proceeds.
      v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_id, 'success', false, 'reason', sqlerrm));
    end;
  end loop;
  return v_results;
end;
$$;
revoke all on function public.review_v2_tasks_batch(uuid[], text, text) from public, anon;
grant execute on function public.review_v2_tasks_batch(uuid[], text, text) to authenticated;
