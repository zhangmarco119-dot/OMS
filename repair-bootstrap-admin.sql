-- Repair bootstrap data after duplicate store seed failure.
-- Safe for the current fresh setup. Do not run this after real business data exists.

begin;

delete from public.admin_store_access;
delete from public.product_feedback;
delete from public.task_items;
delete from public.tasks;
delete from public.products;
delete from public.profiles where id = '4527ebff-5791-4934-bc89-2ca01cefcd2f';
delete from public.stores
where id in (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002'
)
or name in (
  '宝珠奶酪（五道口店）',
  '宝珠奶酪(五道口店)',
  'OMEGA酸奶（西直门店）',
  'OMEGA酸奶(西直门店)'
);

insert into public.stores (id, name, short_name)
values
  ('00000000-0000-4000-8000-000000000001', '宝珠奶酪（五道口店）', '宝珠奶酪'),
  ('00000000-0000-4000-8000-000000000002', 'OMEGA酸奶（西直门店）', 'OMEGA酸奶');

insert into public.products (store_id, name, spec, count_unit, product_code, sort_order)
values
  ('00000000-0000-4000-8000-000000000001', '原味奶酪', '120g/杯', '杯', 'BZ-WDK-001', 10),
  ('00000000-0000-4000-8000-000000000001', '红豆双皮奶', '180g/碗', '碗', 'BZ-WDK-002', 20),
  ('00000000-0000-4000-8000-000000000001', '杏仁豆腐', '150g/盒', '盒', 'BZ-WDK-003', 30),
  ('00000000-0000-4000-8000-000000000002', '希腊酸奶原味', '500g/桶', '桶', 'OMG-XZM-001', 10),
  ('00000000-0000-4000-8000-000000000002', '莓果酸奶碗', '350g/份', '份', 'OMG-XZM-002', 20),
  ('00000000-0000-4000-8000-000000000002', '燕麦脆粒', '1kg/袋', '袋', 'OMG-XZM-003', 30);

insert into public.profiles (id, store_id, username, display_name, role, is_active)
values (
  '4527ebff-5791-4934-bc89-2ca01cefcd2f',
  '00000000-0000-4000-8000-000000000001',
  'admin',
  '管理员',
  'admin',
  true
);

insert into public.admin_store_access (admin_profile_id, store_id)
values
  ('4527ebff-5791-4934-bc89-2ca01cefcd2f', '00000000-0000-4000-8000-000000000001'),
  ('4527ebff-5791-4934-bc89-2ca01cefcd2f', '00000000-0000-4000-8000-000000000002');

commit;