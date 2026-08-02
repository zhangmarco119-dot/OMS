-- The historical duplicate for 山楂酱 used an internally inconsistent
-- specification/unit pair (1.2kg/袋 + 瓶). After 0126 consolidates duplicate
-- product IDs, retain the canonical ID but restore the consistent catalogue
-- details from the newer duplicate.

update public.products
set spec = '1.2kg/罐',
    count_unit = '罐'
where store_id = '00000000-0000-4000-8000-000000000002'::uuid
  and public.normalize_product_name(name) = public.normalize_product_name('山楂酱')
  and spec = '1.2kg/袋'
  and count_unit = '瓶';
