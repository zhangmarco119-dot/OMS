begin;

do $$
declare
  v_definition text;
  v_store_id uuid;
  v_product_id uuid;
  v_billable_today integer;
  v_result jsonb;
begin
  select pg_get_functiondef(
    'private.ai_enqueue_review(uuid,text,uuid,text,jsonb,uuid,uuid,boolean)'::regprocedure
  ) into v_definition;

  if v_definition not ilike
    '%error_code IS DISTINCT FROM ''PILOT_INITIAL_BACKFILL_CANCELLED''%' then
    raise exception 'cost-guarded historical runs still consume the AI pilot daily quota';
  end if;

  if has_function_privilege(
      'authenticated',
      'private.ai_enqueue_review(uuid,text,uuid,text,jsonb,uuid,uuid,boolean)',
      'EXECUTE'
    ) then
    raise exception 'quota fix widened access to the private enqueue function';
  end if;

  select product.store_id, product.id
  into v_store_id, v_product_id
  from public.products product
  join public.ai_pilot_stores scope
    on scope.store_id = product.store_id and scope.enabled
  where product.is_active
  order by product.updated_at desc, product.id
  limit 1;

  if v_product_id is null then
    raise exception 'quota behavior test requires one active pilot product';
  end if;

  select count(*)
  into v_billable_today
  from public.ai_review_runs
  where created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'
    and error_code is distinct from 'PILOT_INITIAL_BACKFILL_CANCELLED';

  if v_billable_today >= 99999 then
    raise exception 'billable daily run count is outside the supported test bound';
  end if;

  update private.ai_review_settings
  set daily_run_limit = v_billable_today + 1
  where singleton;

  insert into public.ai_review_runs(
    store_id, workflow, entity_id, trigger_type, entity_version,
    source_hash, source_context, dedupe_key, status,
    error_code, error_message, completed_at
  )
  select
    v_store_id, 'product', v_product_id, 'auto', fixture.ordinality::text,
    encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
    jsonb_build_object(
      'workflow', 'product',
      'storeId', v_store_id::text,
      'sourceVersion', fixture.ordinality::text
    ),
    'quota-exempt-test:' || gen_random_uuid()::text,
    'stale', 'PILOT_INITIAL_BACKFILL_CANCELLED',
    'Transaction-local quota exemption fixture.', now()
  from unnest(array[1, 2]) with ordinality as fixture(value, ordinality);

  v_result := private.ai_enqueue_review(
    v_store_id, 'product', v_product_id, 'ensure',
    null, null, null, true
  );

  if v_result ->> 'status' <> 'queued' then
    raise exception 'quota-exempt audit rows blocked a new AI run: %', v_result;
  end if;
end;
$$;

rollback;
