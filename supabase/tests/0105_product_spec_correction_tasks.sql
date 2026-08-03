begin;

insert into public.stores (id, name, short_name) values
  ('b1000000-0000-4000-8000-000000000001', '货品规格任务测试门店', '规格测试');

insert into auth.users (id, email, aud, role) values
  ('b1100000-0000-4000-8000-000000000001', 'product-spec-admin@test.invalid', 'authenticated', 'authenticated'),
  ('b1100000-0000-4000-8000-000000000002', 'product-spec-manager@test.invalid', 'authenticated', 'authenticated');

insert into public.profiles (id, store_id, username, display_name, role) values
  ('b1100000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'product_spec_admin', '规格审核管理员', 'admin'),
  ('b1100000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'product_spec_manager', '规格填写店长', 'manager');

insert into public.profile_store_access (profile_id, store_id) values
  ('b1100000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b1100000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001');

insert into public.products (id, store_id, name, spec, count_unit, category_code) values
  ('b1200000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', '待通过货品', '请填写！', '盒', 'other_food'),
  ('b1200000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', '待驳回货品', '2', '瓶', 'consumable');

insert into public.v2_task_templates (
  id, name, category, requires_review, status, current_version, created_by
) values (
  'b1300000-0000-4000-8000-000000000001', '货品规格补全', 'temporary', true, 'published', 1,
  'b1100000-0000-4000-8000-000000000001'
);

insert into public.v2_task_template_stores (template_id, store_id) values
  ('b1300000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001');

insert into public.v2_task_template_versions (
  id, template_id, version_number, snapshot, published_by
) values (
  'b1400000-0000-4000-8000-000000000001',
  'b1300000-0000-4000-8000-000000000001',
  1,
  '{"workflow_type":"product_spec_correction","groups":[]}'::jsonb,
  'b1100000-0000-4000-8000-000000000001'
);

insert into public.v2_tasks (
  id, template_id, template_version_id, store_id, name, category, snapshot,
  status, due_at, requires_review, created_by, assigned_profile_id,
  submitted_by, submitted_by_role, submitted_at
) values (
  'b1500000-0000-4000-8000-000000000001',
  'b1300000-0000-4000-8000-000000000001',
  'b1400000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  '货品规格补全',
  'temporary',
  '{"workflow_type":"product_spec_correction","groups":[]}'::jsonb,
  'submitted',
  now() + interval '1 day',
  true,
  'b1100000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000002',
  'b1100000-0000-4000-8000-000000000002',
  'manager',
  now()
);

insert into public.v2_task_answers (
  task_id, item_id, group_id, item_snapshot, answer, review_status, submission_round
) values
  (
    'b1500000-0000-4000-8000-000000000001',
    'b1600000-0000-4000-8000-000000000001',
    'b1700000-0000-4000-8000-000000000001',
    '{"id":"b1600000-0000-4000-8000-000000000001","answer_schema":"product_spec","product_id":"b1200000-0000-4000-8000-000000000001","product_name":"待通过货品"}'::jsonb,
    '{"spec":"500g/盒×12盒/箱","count_unit":"盒"}'::jsonb,
    'pending',
    1
  ),
  (
    'b1500000-0000-4000-8000-000000000001',
    'b1600000-0000-4000-8000-000000000002',
    'b1700000-0000-4000-8000-000000000001',
    '{"id":"b1600000-0000-4000-8000-000000000002","answer_schema":"product_spec","product_id":"b1200000-0000-4000-8000-000000000002","product_name":"待驳回货品"}'::jsonb,
    '{"spec":"100片/瓶","count_unit":"瓶"}'::jsonb,
    'pending',
    1
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1100000-0000-4000-8000-000000000001', true);

select public.review_v2_task_items(
  'b1500000-0000-4000-8000-000000000001',
  '[
    {"item_id":"b1600000-0000-4000-8000-000000000001","decision":"approved","note":""},
    {"item_id":"b1600000-0000-4000-8000-000000000002","decision":"rejected","note":""}
  ]'::jsonb,
  ''
);

reset role;

do $$
begin
  if not exists (
    select 1 from public.products
    where id = 'b1200000-0000-4000-8000-000000000001'
      and spec = '500g/盒×12盒/箱'
      and count_unit = '盒'
  ) then
    raise exception 'approved specification did not update the product library';
  end if;

  if not exists (
    select 1 from public.products
    where id = 'b1200000-0000-4000-8000-000000000002'
      and spec = '2'
      and count_unit = '瓶'
  ) then
    raise exception 'rejected specification changed the product library';
  end if;

  if not exists (
    select 1 from public.v2_tasks
    where id = 'b1500000-0000-4000-8000-000000000001'
      and status = 'rejected'
      and correction_item_ids = array['b1600000-0000-4000-8000-000000000002'::uuid]
  ) then
    raise exception 'rejected product item was not returned for focused correction';
  end if;

  if not exists (
    select 1 from public.notifications
    where entity_id = 'b1500000-0000-4000-8000-000000000001'
      and type = 'v2_task_rejected'
      and body = '有货品规格需要修改，请打开任务查看。'
  ) then
    raise exception 'optional rejection note must still produce a valid notification';
  end if;

  if not exists (
    select 1 from public.audit_logs
    where entity_id = 'b1200000-0000-4000-8000-000000000001'
      and action = 'product_spec_updated_from_task'
  ) then
    raise exception 'approved product specification update was not audited';
  end if;

  raise notice 'StoreHub product specification correction task checks passed';
end $$;

rollback;
