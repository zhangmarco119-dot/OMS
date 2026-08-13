begin;

do $$
declare
  v_table text;
  v_worker_function text;
  v_admin_function text;
  v_definition text;
begin
  foreach v_table in array array[
    'ai_pilot_stores', 'ai_review_runs', 'ai_review_queue',
    'ai_suggestions', 'ai_suggestion_events'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'AI review table is missing: %', v_table;
    end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || v_table)) then
      raise exception 'AI review table must enable RLS: %', v_table;
    end if;
    if has_table_privilege('authenticated', 'public.' || v_table, 'INSERT,UPDATE,DELETE') then
      raise exception 'authenticated users must not directly mutate AI review table: %', v_table;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.ai_review_queue', 'SELECT') then
    raise exception 'browser clients must not read the AI worker queue';
  end if;

  foreach v_admin_function in array array[
    'public.admin_get_ai_settings()',
    'public.admin_save_ai_settings(boolean,boolean,boolean,boolean,jsonb,integer)',
    'public.admin_save_ai_store_scope(uuid,boolean,jsonb)',
    'public.configure_ai_review_automation()',
    'public.admin_ensure_ai_review(uuid,text,uuid)',
    'public.admin_rerun_ai_review(uuid)',
    'public.admin_ai_check_product_draft(uuid,uuid,jsonb)',
    'public.admin_ai_list_reviews(uuid[],text,text,integer,integer)',
    'public.admin_ai_get_review(uuid)',
    'public.admin_ai_skip_review(uuid,text)',
    'public.admin_ai_act_on_suggestion(uuid,text,text,text)',
    'public.admin_ai_backfill_pilot(integer,integer)'
  ] loop
    if to_regprocedure(v_admin_function) is null then
      raise exception 'administrator AI RPC is missing: %', v_admin_function;
    end if;
    if not has_function_privilege('authenticated', v_admin_function, 'EXECUTE') then
      raise exception 'administrator AI RPC is unavailable to authenticated sessions: %', v_admin_function;
    end if;
  end loop;

  foreach v_worker_function in array array[
    'public.verify_ai_review_cron_token(text)',
    'public.claim_ai_review_jobs(integer,text)',
    'public.claim_ai_review_run(uuid,text)',
    'public.complete_ai_review_run(uuid,jsonb,text,text,jsonb,integer)',
    'public.fail_ai_review_run(uuid,text,text,boolean,timestamp with time zone)'
  ] loop
    if to_regprocedure(v_worker_function) is null then
      raise exception 'AI worker RPC is missing: %', v_worker_function;
    end if;
    if has_function_privilege('authenticated', v_worker_function, 'EXECUTE')
      or not has_function_privilege('service_role', v_worker_function, 'EXECUTE') then
      raise exception 'AI worker RPC privilege boundary is invalid: %', v_worker_function;
    end if;
  end loop;

  if not exists(
    select 1 from private.ai_review_settings
    where singleton
      and workflow_flags ->> 'v2_task' = 'false'
      and admin_apply_enabled
      and admin_visible
  ) then
    raise exception 'structured pilot defaults or V2 exclusion are invalid';
  end if;

  if not exists(select 1 from pg_trigger where tgname = 'arrival_reports_ai_review_enqueue' and not tgisinternal)
    or not exists(select 1 from pg_trigger where tgname = 'tasks_ai_review_enqueue' and not tgisinternal)
    or not exists(select 1 from pg_trigger where tgname = 'product_creation_requests_ai_review_enqueue' and not tgisinternal)
    or not exists(select 1 from pg_trigger where tgname = 'products_ai_review_enqueue' and not tgisinternal) then
    raise exception 'structured workflow AI enqueue triggers are incomplete';
  end if;

  select pg_get_functiondef('private.ai_auto_enqueue_entity()'::regprocedure) into v_definition;
  if v_definition !~* 'exception\s+when\s+others'
    or v_definition not like '%private.ai_enqueue_review%' then
    raise exception 'AI automatic enqueue must be fail-open and use the scoped helper';
  end if;

  select pg_get_functiondef(
    'public.complete_ai_review_run(uuid,jsonb,text,text,jsonb,integer)'::regprocedure
  ) into v_definition;
  if v_definition not like '%service_role%'
    or v_definition not like '%critical%'
    or v_definition not like '%AI suggestion action is outside the workflow draft allowlist%' then
    raise exception 'AI completion must enforce service role, critical severity, and draft action allowlists';
  end if;

  select pg_get_functiondef(
    'public.admin_ai_act_on_suggestion(uuid,text,text,text)'::regprocedure
  ) into v_definition;
  if v_definition like '%UPDATE public.products%'
    or v_definition like '%UPDATE public.arrival_reports%'
    or v_definition like '%UPDATE public.tasks%'
    or v_definition like '%UPDATE public.v2_tasks%'
    or v_definition like '%UPDATE public.product_creation_requests%' then
    raise exception 'AI suggestion action must never mutate formal business records';
  end if;
  if v_definition not like '%draft_patch%'
    or v_definition not like '%ai_assert_current_source%' then
    raise exception 'AI suggestion action must return a draft patch with stale protection';
  end if;

  if not exists(select 1 from cron.job where jobname = 'storehub-ai-review-queue') then
    raise exception 'AI queue recovery cron is missing';
  end if;
end;
$$;

insert into public.stores(id, name, short_name) values
  ('a8000000-0000-4000-8000-000000000001', 'AI权限测试门店一', 'AI测试一'),
  ('a8000000-0000-4000-8000-000000000002', 'AI权限测试门店二', 'AI测试二');

insert into auth.users(id, email, aud, role) values
  ('a8100000-0000-4000-8000-000000000001', 'ai-staff@test.invalid', 'authenticated', 'authenticated'),
  ('a8100000-0000-4000-8000-000000000002', 'ai-manager@test.invalid', 'authenticated', 'authenticated'),
  ('a8100000-0000-4000-8000-000000000003', 'ai-admin@test.invalid', 'authenticated', 'authenticated');

insert into public.profiles(id, store_id, username, display_name, role) values
  ('a8100000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'ai_test_staff', 'AI测试员工', 'staff'),
  ('a8100000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000001', 'ai_test_manager', 'AI测试店长', 'manager'),
  ('a8100000-0000-4000-8000-000000000003', 'a8000000-0000-4000-8000-000000000001', 'ai_test_admin', 'AI测试管理员', 'admin');

insert into public.profile_store_access(profile_id, store_id) values
  ('a8100000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001'),
  ('a8100000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000001'),
  ('a8100000-0000-4000-8000-000000000003', 'a8000000-0000-4000-8000-000000000001');

insert into public.ai_pilot_stores(store_id, enabled) values
  ('a8000000-0000-4000-8000-000000000001', true),
  ('a8000000-0000-4000-8000-000000000002', true);

insert into public.ai_review_runs(
  id, store_id, workflow, entity_id, trigger_type, entity_version,
  source_hash, source_context, dedupe_key, status
) values
  (
    'a8200000-0000-4000-8000-000000000001',
    'a8000000-0000-4000-8000-000000000001', 'product',
    'a8300000-0000-4000-8000-000000000001', 'auto', '1',
    repeat('a', 64),
    jsonb_build_object('workflow', 'product', 'storeId', 'a8000000-0000-4000-8000-000000000001'),
    'ai-rls-test-one', 'completed'
  ),
  (
    'a8200000-0000-4000-8000-000000000002',
    'a8000000-0000-4000-8000-000000000002', 'product',
    'a8300000-0000-4000-8000-000000000002', 'auto', '1',
    repeat('b', 64),
    jsonb_build_object('workflow', 'product', 'storeId', 'a8000000-0000-4000-8000-000000000002'),
    'ai-rls-test-two', 'completed'
  );

set local role authenticated;

select set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000001', true);
do $$ begin
  if (select count(*) from public.ai_review_runs where id::text like 'a8200000-%') <> 0 then
    raise exception 'staff can read administrator AI review data';
  end if;
end $$;

select set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000002', true);
do $$ begin
  if (select count(*) from public.ai_review_runs where id::text like 'a8200000-%') <> 0 then
    raise exception 'manager can read administrator AI review data';
  end if;
end $$;

select set_config('request.jwt.claim.sub', 'a8100000-0000-4000-8000-000000000003', true);
do $$
declare
  v_list jsonb;
begin
  if (select count(*) from public.ai_review_runs where id::text like 'a8200000-%') <> 1 then
    raise exception 'administrator AI review store scope is invalid';
  end if;
  if exists(
    select 1 from public.ai_review_runs
    where id = 'a8200000-0000-4000-8000-000000000002'
  ) then
    raise exception 'administrator can read AI review data from an unauthorized store';
  end if;
  v_list := public.admin_ai_list_reviews(null, 'product', 'completed', 50, 0);
  if (v_list ->> 'total')::integer <> 1
    or jsonb_array_length(v_list -> 'items') <> 1 then
    raise exception 'administrator AI review list RPC did not preserve store scope';
  end if;
end;
$$;

reset role;
rollback;
