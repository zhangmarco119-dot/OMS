begin;

insert into public.stores (id, name, short_name) values
  ('a6000000-0000-4000-8000-000000000001', 'SOP 通知测试门店', '通知测试');

insert into auth.users (id, email, aud, role) values
  ('a6100000-0000-4000-8000-000000000001', 'sop-publish-admin@test.invalid', 'authenticated', 'authenticated'),
  ('a6100000-0000-4000-8000-000000000002', 'sop-publish-staff@test.invalid', 'authenticated', 'authenticated');

insert into public.profiles (id, store_id, username, display_name, role) values
  ('a6100000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'sop_publish_admin', 'SOP 发布管理员', 'admin'),
  ('a6100000-0000-4000-8000-000000000002', 'a6000000-0000-4000-8000-000000000001', 'sop_publish_staff', 'SOP 通知员工', 'staff');

insert into public.profile_store_access (profile_id, store_id) values
  ('a6100000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001');

insert into public.v2_sops (id, category, title, body, created_by) values
  ('a6200000-0000-4000-8000-000000000001', '测试', '无整体说明 SOP', '', 'a6100000-0000-4000-8000-000000000001');

insert into public.v2_sop_stores (sop_id, store_id) values
  ('a6200000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001');

insert into public.v2_sop_roles (sop_id, role) values
  ('a6200000-0000-4000-8000-000000000001', 'staff');

insert into public.v2_sop_assets (
  id, sop_id, asset_kind, object_path, file_name, mime_type, size_bytes,
  uploaded_by, sort_order, step_text
) values (
  'a6300000-0000-4000-8000-000000000001',
  'a6200000-0000-4000-8000-000000000001',
  'step', null, null, null, 0,
  'a6100000-0000-4000-8000-000000000001', 0, '完成测试步骤'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6100000-0000-4000-8000-000000000001', true);
select public.publish_v2_sop_with_options('a6200000-0000-4000-8000-000000000001', false);

reset role;

do $$
begin
  if not exists (
    select 1
    from public.notifications
    where recipient_user_id = 'a6100000-0000-4000-8000-000000000002'
      and entity_id = 'a6200000-0000-4000-8000-000000000001'
      and type = 'sop_published'
      and body = '请打开 SOP 查看完整内容。'
  ) then
    raise exception 'non-silent SOP publishing must create a non-blank fallback notification';
  end if;

  raise notice 'StoreHub SOP publish notification body checks passed';
end $$;

rollback;

