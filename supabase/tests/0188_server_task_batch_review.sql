begin;
do $test$
declare
  admin_id uuid := gen_random_uuid(); staff_id uuid := gen_random_uuid(); manager_id uuid := gen_random_uuid();
  shop uuid := gen_random_uuid(); other_shop uuid := gen_random_uuid();
  template_id uuid := gen_random_uuid(); version_id uuid := gen_random_uuid();
  fixture_task_id uuid; batch_ids uuid[] := '{}'; failed_id uuid := gen_random_uuid(); foreign_id uuid := gen_random_uuid();
  linked_id uuid := gen_random_uuid(); inventory_id uuid := gen_random_uuid(); recount_id uuid;
  old_item uuid := gen_random_uuid(); result jsonb; started timestamptz; elapsed interval;
begin
  if has_function_privilege('anon', 'public.review_v2_tasks_batch(uuid[],text,text)', 'execute') then
    raise exception 'Anonymous batch approval is allowed';
  end if;
  insert into public.stores(id,name,short_name) values (shop,'批量审批测试-'||shop,'测试'),(other_shop,'另一门店-'||other_shop,'测试');
  insert into auth.users(id,email) values (admin_id,admin_id||'@batch.invalid'),(staff_id,staff_id||'@batch.invalid'),(manager_id,manager_id||'@batch.invalid');
  insert into public.profiles(id,store_id,username,display_name,role,is_active) values
    (admin_id,shop,'batch-admin-'||admin_id,'管理员','admin',true),
    (staff_id,shop,'batch-staff-'||staff_id,'员工','staff',true),
    (manager_id,shop,'batch-manager-'||manager_id,'店长','manager',true);
  insert into public.admin_store_access(admin_profile_id,store_id) values(admin_id,shop);
  insert into public.profile_store_access(profile_id,store_id) values(admin_id,shop),(staff_id,shop),(manager_id,shop);
  insert into public.v2_task_templates(id,name,category,created_by) values(template_id,'批量审批模板','temporary',admin_id);
  insert into public.v2_task_template_versions(id,template_id,version_number,snapshot,published_by)
    values(version_id,template_id,1,'{}',admin_id);
  -- Many tasks and one already-approved answer demonstrate current-round-only approval.
  for i in 1..40 loop
    fixture_task_id := gen_random_uuid(); batch_ids := array_append(batch_ids,fixture_task_id);
    insert into public.v2_tasks(id,template_id,template_version_id,store_id,name,category,snapshot,status,due_at,created_by,submitted_by,submitted_by_role)
      values(fixture_task_id,template_id,version_id,shop,'批量任务'||i,'temporary','{}',case when i=1 then 'resubmitted' else 'submitted' end,now()+interval '1 day',admin_id,staff_id,'staff');
    insert into public.v2_task_answers(task_id,item_id,group_id,item_snapshot,answer,review_status,submission_round)
      values(fixture_task_id,gen_random_uuid(),gen_random_uuid(),'{}','true',case when i=1 then 'resubmitted' else 'pending' end,case when i=1 then 2 else 1 end);
  end loop;
  insert into public.v2_task_answers(task_id,item_id,group_id,item_snapshot,answer,review_status,submission_round)
    values(batch_ids[1],old_item,gen_random_uuid(),'{}','true','approved',1);
  insert into public.v2_tasks(id,template_id,template_version_id,store_id,name,category,snapshot,status,due_at,created_by,submitted_by,submitted_by_role)
    values(failed_id,template_id,version_id,shop,'无待审核项目','temporary','{}','submitted',now()+interval '1 day',admin_id,staff_id,'staff'),
    (foreign_id,template_id,version_id,other_shop,'另一门店任务','temporary','{}','submitted',now()+interval '1 day',admin_id,staff_id,'staff'),
    (linked_id,template_id,version_id,shop,'关联点货任务','temporary','{}','submitted',now()+interval '1 day',admin_id,staff_id,'staff');
  update public.v2_tasks set requires_inventory=true, inventory_category_codes=array['other_food'] where id=linked_id;
  insert into public.tasks(id,store_id,created_by,task_type,status,submitted_at,linked_v2_task_id,inventory_category_codes)
    values(inventory_id,shop,staff_id,'inventory','submitted',now(),linked_id,array['other_food']);
  insert into public.task_items(task_id,store_id,product_snapshot,status,quantity)
    values(inventory_id,shop,'{"name":"货品一"}','completed',3),(inventory_id,shop,'{"name":"货品二"}','completed',7);

  perform set_config('request.jwt.claim.sub',manager_id::text,true);
  begin
    perform public.review_v2_tasks_batch(batch_ids,'approved','');
    raise exception 'Manager batch approval unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  begin
    perform public.review_v2_tasks_batch(batch_ids,'rejected',' ');
    raise exception 'Blank rejection reason unexpectedly accepted';
  exception when check_violation then null; end;
  started := clock_timestamp();
  result := public.review_v2_tasks_batch(batch_ids||array[failed_id,foreign_id,batch_ids[1]],'approved','');
  elapsed := clock_timestamp()-started;
  if (select count(*) from jsonb_array_elements(result) r where (r->>'success')::boolean) <> 40
    or jsonb_array_length(result) <> 42 then raise exception 'Batch result counts incorrect: %',result; end if;
  if exists(select 1 from public.v2_tasks where id=any(batch_ids) and status<>'approved') then raise exception 'Batch task status incorrect'; end if;
  if (select count(*) from public.v2_task_item_reviews where task_id=any(batch_ids)) <> 40 then raise exception 'Current-round review count incorrect'; end if;
  if exists(select 1 from public.v2_task_item_reviews where item_id=old_item) then raise exception 'Previously approved item reviewed twice'; end if;
  if exists(select 1 from public.v2_task_reviews where task_id in(failed_id,foreign_id)) then raise exception 'Failed or forbidden task was changed'; end if;
  if (select count(*) from public.notifications where entity_id=any(batch_ids) and type='v2_task_approved') <> 40 then raise exception 'Employee notifications missing'; end if;
  -- Safe replay: no duplicated approvals, audit rows or notifications.
  result := public.review_v2_tasks_batch(batch_ids,'approved','');
  if exists(select 1 from jsonb_array_elements(result) r where (r->>'success')::boolean) then raise exception 'Replay approved again'; end if;
  if (select count(*) from public.v2_task_reviews where task_id=any(batch_ids)) <> 40 then raise exception 'Duplicate review on replay'; end if;
  -- An inventory-only task can be rejected and later approved using only its recount.
  result := public.review_v2_tasks_batch(array[linked_id],'rejected','重新核对');
  if result->0->>'success' <> 'true' then raise exception 'Linked rejection failed: %',result; end if;
  select inventory_correction_task_id into recount_id from public.v2_tasks where id=linked_id;
  if recount_id is null or (select count(*) from public.task_items where task_id=recount_id)<>2 then raise exception 'Recount items missing'; end if;
  update public.task_items set status='completed',quantity=8 where task_id=recount_id;
  update public.tasks set status='submitted',submitted_at=now() where id=recount_id;
  perform set_config('request.jwt.claim.sub',staff_id::text,true);
  update public.v2_tasks set status='resubmitted' where id=linked_id;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  result := public.review_v2_tasks_batch(array[linked_id],'approved','');
  if result->0->>'success' <> 'true' or (select status from public.v2_tasks where id=linked_id)<>'approved' then raise exception 'Recount approval failed: %',result; end if;
  raise notice 'Batch regression passed: 40 tasks in %, failure isolation, permissions, replay, current round and linked inventory verified',elapsed;
end $test$;
rollback;
