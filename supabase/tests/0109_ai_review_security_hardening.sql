begin;

do $$
declare
  v_definition text;
  v_function_oid oid;
begin
  if exists(
    select 1
    from pg_trigger
    where tgname = 'stores_initialize_ai_pilot_scope'
      and tgrelid = 'public.stores'::regclass
      and not tgisinternal
  ) or to_regprocedure('private.ai_sync_named_pilot_store()') is not null then
    raise exception 'AI pilot membership must not expand from a store display name';
  end if;

  if has_function_privilege(
      'anon',
      'public.ai_review_is_enabled(uuid,text,boolean,boolean)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.ai_review_is_enabled(uuid,text,boolean,boolean)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.ai_review_is_enabled(uuid,text,boolean,boolean)',
      'EXECUTE'
    ) then
    raise exception 'AI pilot configuration helper must be service-role only';
  end if;

  if has_function_privilege(
      'anon',
      'public.can_admin_access_ai_store(uuid)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.can_admin_access_ai_store(uuid)',
      'EXECUTE'
    ) then
    raise exception 'AI administrator RLS helper privilege boundary is invalid';
  end if;

  select 'private.ai_enqueue_review(uuid,text,uuid,text,jsonb,uuid,uuid,boolean)'::regprocedure::oid
  into v_function_oid;
  select pg_get_functiondef(v_function_oid) into v_definition;
  if v_definition not ilike '%ON CONFLICT (dedupe_key) DO NOTHING%'
    or v_definition not ilike '%pg_advisory_xact_lock%'
    or not exists(
      select 1
      from pg_proc
      where oid = v_function_oid
        and prosecdef
        and exists(
          select 1 from unnest(coalesce(proconfig, '{}'::text[])) setting
          where setting like 'search_path=%'
        )
    ) then
    raise exception 'AI enqueue must be concurrency-safe and have a pinned definer search path';
  end if;

  select 'private.ai_validate_suggestion_draft_patch()'::regprocedure::oid
  into v_function_oid;
  if not exists(
    select 1
    from pg_proc
    where oid = v_function_oid
      and prosecdef
      and exists(
        select 1 from unnest(coalesce(proconfig, '{}'::text[])) setting
        where setting like 'search_path=%'
      )
  ) or not exists(
    select 1
    from pg_trigger
    where tgname = 'ai_suggestions_validate_draft_patch'
      and tgrelid = 'public.ai_suggestions'::regclass
      and not tgisinternal
  ) then
    raise exception 'AI suggestion draft validator is missing or unsafe';
  end if;
end;
$$;

insert into public.stores(id, name, short_name) values
  ('a9000000-0000-4000-8000-000000000001', 'AI hardening store one', 'AI hard one'),
  ('a9000000-0000-4000-8000-000000000002', 'AI hardening store two', 'AI hard two');

insert into auth.users(id, email, aud, role) values
  ('a9100000-0000-4000-8000-000000000001', 'ai-hard-staff@test.invalid', 'authenticated', 'authenticated'),
  ('a9100000-0000-4000-8000-000000000002', 'ai-hard-manager@test.invalid', 'authenticated', 'authenticated'),
  ('a9100000-0000-4000-8000-000000000003', 'ai-hard-admin@test.invalid', 'authenticated', 'authenticated');

insert into public.profiles(id, store_id, username, display_name, role) values
  ('a9100000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'ai_hard_staff', 'AI hard staff', 'staff'),
  ('a9100000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000001', 'ai_hard_manager', 'AI hard manager', 'manager'),
  ('a9100000-0000-4000-8000-000000000003', 'a9000000-0000-4000-8000-000000000001', 'ai_hard_admin', 'AI hard admin', 'admin');

insert into public.profile_store_access(profile_id, store_id) values
  ('a9100000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001'),
  ('a9100000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000001'),
  ('a9100000-0000-4000-8000-000000000003', 'a9000000-0000-4000-8000-000000000001');

insert into public.products(id, store_id, name, spec, count_unit, category_code) values
  ('a9300000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'Reviewed product', '500ml', 'bottle', 'other_food'),
  ('a9300000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000001', 'Same-store target', '1kg', 'bag', 'other_food'),
  ('a9300000-0000-4000-8000-000000000003', 'a9000000-0000-4000-8000-000000000002', 'Other-store target', '1kg', 'bag', 'other_food');

insert into public.tasks(id, store_id, created_by, task_type, status) values
  ('a9400000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'a9100000-0000-4000-8000-000000000003', 'order', 'draft'),
  ('a9400000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000001', 'a9100000-0000-4000-8000-000000000003', 'order', 'draft');

insert into public.task_items(id, task_id, store_id, product_id, product_snapshot) values
  (
    'a9500000-0000-4000-8000-000000000001',
    'a9400000-0000-4000-8000-000000000001',
    'a9000000-0000-4000-8000-000000000001',
    'a9300000-0000-4000-8000-000000000001',
    '{}'::jsonb
  ),
  (
    'a9500000-0000-4000-8000-000000000002',
    'a9400000-0000-4000-8000-000000000002',
    'a9000000-0000-4000-8000-000000000001',
    'a9300000-0000-4000-8000-000000000002',
    '{}'::jsonb
  );

insert into public.ai_review_runs(
  id, store_id, workflow, entity_id, trigger_type, entity_version,
  source_hash, source_context, dedupe_key, status
) values
  (
    'a9200000-0000-4000-8000-000000000001',
    'a9000000-0000-4000-8000-000000000001', 'product',
    'a9300000-0000-4000-8000-000000000001', 'ensure', '1',
    repeat('c', 64),
    jsonb_build_object(
      'workflow', 'product',
      'storeId', 'a9000000-0000-4000-8000-000000000001',
      'catalog', jsonb_build_array(jsonb_build_object(
        'productId', 'a9300000-0000-4000-8000-000000000002'
      ))
    ),
    'ai-hardening-product', 'completed'
  ),
  (
    'a9200000-0000-4000-8000-000000000002',
    'a9000000-0000-4000-8000-000000000001', 'order',
    'a9400000-0000-4000-8000-000000000001', 'ensure', '1',
    repeat('d', 64),
    jsonb_build_object(
      'workflow', 'order',
      'storeId', 'a9000000-0000-4000-8000-000000000001'
    ),
    'ai-hardening-order', 'completed'
  );

insert into public.ai_suggestions(
  run_id, store_id, issue_type, severity, title, rationale,
  action_type, draft_patch, source_hash
) values
  (
    'a9200000-0000-4000-8000-000000000001',
    'a9000000-0000-4000-8000-000000000001',
    'duplicate', 'warning', 'Use existing product', 'Same-store active product',
    'use_existing_product',
    jsonb_build_object('product_id', 'a9300000-0000-4000-8000-000000000002'),
    repeat('c', 64)
  ),
  (
    'a9200000-0000-4000-8000-000000000001',
    'a9000000-0000-4000-8000-000000000001',
    'field', 'info', 'Replace field', 'Valid structured field patch',
    'replace_fields', jsonb_build_object('count_unit', 'box'), repeat('c', 64)
  ),
  (
    'a9200000-0000-4000-8000-000000000002',
    'a9000000-0000-4000-8000-000000000001',
    'quantity', 'warning', 'Edit quantity', 'Current task item',
    'edit_quantity',
    jsonb_build_object(
      'item_id', 'a9500000-0000-4000-8000-000000000001',
      'quantity', 12
    ),
    repeat('d', 64)
  ),
  (
    'a9200000-0000-4000-8000-000000000002',
    'a9000000-0000-4000-8000-000000000001',
    'no_order', 'info', 'No order needed', 'Current order item',
    'mark_no_order_needed',
    jsonb_build_object('item_id', 'a9500000-0000-4000-8000-000000000001'),
    repeat('d', 64)
  );

do $$
begin
  begin
    insert into public.ai_suggestions(
      run_id, store_id, issue_type, severity, title, rationale,
      action_type, draft_patch, source_hash
    ) values (
      'a9200000-0000-4000-8000-000000000001',
      'a9000000-0000-4000-8000-000000000001',
      'cross_store', 'critical', 'Invalid product target', 'Must be rejected',
      'use_existing_product',
      jsonb_build_object('product_id', 'a9300000-0000-4000-8000-000000000003'),
      repeat('c', 64)
    );
    raise exception 'cross-store AI product target was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    insert into public.ai_suggestions(
      run_id, store_id, issue_type, severity, title, rationale,
      action_type, draft_patch, source_hash
    ) values (
      'a9200000-0000-4000-8000-000000000001',
      'a9000000-0000-4000-8000-000000000001',
      'outside_context', 'warning', 'Unreviewed product target', 'Must be rejected',
      'use_existing_product',
      jsonb_build_object('product_id', 'a9300000-0000-4000-8000-000000000001'),
      repeat('c', 64)
    );
    raise exception 'AI product target outside the reviewed catalog was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    insert into public.ai_suggestions(
      run_id, store_id, issue_type, severity, title, rationale,
      action_type, draft_patch, source_hash
    ) values (
      'a9200000-0000-4000-8000-000000000001',
      'a9000000-0000-4000-8000-000000000001',
      'category', 'warning', 'Invalid category', 'Must be rejected',
      'replace_fields', jsonb_build_object('category_code', 'not_a_category'), repeat('c', 64)
    );
    raise exception 'invalid AI category was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    insert into public.ai_suggestions(
      run_id, store_id, issue_type, severity, title, rationale,
      action_type, draft_patch, source_hash
    ) values (
      'a9200000-0000-4000-8000-000000000002',
      'a9000000-0000-4000-8000-000000000001',
      'wrong_item', 'critical', 'Invalid item target', 'Must be rejected',
      'edit_quantity',
      jsonb_build_object(
        'item_id', 'a9500000-0000-4000-8000-000000000002',
        'quantity', 1
      ),
      repeat('d', 64)
    );
    raise exception 'AI quantity action targeting another task was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    insert into public.ai_suggestions(
      run_id, store_id, issue_type, severity, title, rationale,
      action_type, draft_patch, source_hash
    ) values (
      'a9200000-0000-4000-8000-000000000002',
      'a9000000-0000-4000-8000-000000000001',
      'negative_quantity', 'critical', 'Invalid quantity', 'Must be rejected',
      'edit_quantity',
      jsonb_build_object(
        'item_id', 'a9500000-0000-4000-8000-000000000001',
        'quantity', -1
      ),
      repeat('d', 64)
    );
    raise exception 'negative AI quantity was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    insert into public.ai_suggestions(
      run_id, store_id, issue_type, severity, title, rationale,
      action_type, draft_patch, source_hash
    ) values (
      'a9200000-0000-4000-8000-000000000002',
      'a9000000-0000-4000-8000-000000000001',
      'quantity_scale', 'warning', 'Invalid quantity precision', 'Must be rejected',
      'edit_quantity',
      jsonb_build_object(
        'item_id', 'a9500000-0000-4000-8000-000000000001',
        'quantity', 1.234
      ),
      repeat('d', 64)
    );
    raise exception 'AI quantity exceeding task precision was accepted';
  exception when sqlstate '22023' then
    null;
  end;
end;
$$;

insert into public.ai_pilot_stores(store_id, enabled) values
  ('a9000000-0000-4000-8000-000000000001', true),
  ('a9000000-0000-4000-8000-000000000002', true);

set local role authenticated;

select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
do $$
begin
  begin
    perform public.admin_ai_get_review('a9200000-0000-4000-8000-000000000001');
    raise exception 'staff indirectly read administrator AI review detail';
  exception when sqlstate '42501' then
    null;
  end;
  begin
    perform public.admin_ai_list_reviews(null, null, null, 50, 0);
    raise exception 'staff indirectly read administrator AI review list';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000002', true);
do $$
begin
  begin
    perform public.admin_ai_get_review('a9200000-0000-4000-8000-000000000001');
    raise exception 'manager indirectly read administrator AI review detail';
  exception when sqlstate '42501' then
    null;
  end;
  begin
    perform public.admin_ai_list_reviews(null, null, null, 50, 0);
    raise exception 'manager indirectly read administrator AI review list';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;

reset role;
rollback;
