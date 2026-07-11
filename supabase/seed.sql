insert into public.stores (id, name, short_name)
values
  ('00000000-0000-4000-8000-000000000001', '宝珠奶酪（五道口店）', '宝珠奶酪'),
  ('00000000-0000-4000-8000-000000000002', 'OMEGA酸奶（西直门店）', 'OMEGA酸奶')
on conflict (id) do update
set name = excluded.name,
    short_name = excluded.short_name,
    is_active = true;

insert into public.products (store_id, name, spec, count_unit, product_code, sort_order)
values
  ('00000000-0000-4000-8000-000000000001', '原味奶酪', '120g/杯', '杯', 'BZ-WDK-001', 10),
  ('00000000-0000-4000-8000-000000000001', '红豆双皮奶', '180g/碗', '碗', 'BZ-WDK-002', 20),
  ('00000000-0000-4000-8000-000000000001', '杏仁豆腐', '150g/盒', '盒', 'BZ-WDK-003', 30),
  ('00000000-0000-4000-8000-000000000002', '希腊酸奶原味', '500g/桶', '桶', 'OMG-XZM-001', 10),
  ('00000000-0000-4000-8000-000000000002', '莓果酸奶碗', '350g/份', '份', 'OMG-XZM-002', 20),
  ('00000000-0000-4000-8000-000000000002', '燕麦脆粒', '1kg/袋', '袋', 'OMG-XZM-003', 30)
on conflict (store_id, product_code) do update
set name = excluded.name,
    spec = excluded.spec,
    count_unit = excluded.count_unit,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();
