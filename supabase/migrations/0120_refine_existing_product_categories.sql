-- Refine the initial automatic classification after checking the real product catalogue.
-- Ambiguous goods deliberately remain in other_food for manual review.

create or replace function public.infer_product_category(p_name text,p_spec text default '')
returns text language plpgsql immutable as $$
declare v_name text := lower(coalesce(p_name,'')); v_all text := lower(coalesce(p_name,'') || ' ' || coalesce(p_spec,''));
begin
  if v_all ~ '(冰沙机|酸奶机|制冰机|冰箱|冷柜|空调|插排|电子秤|钢勺|不锈钢|量杯|剪刀|刀具|砧板|器皿|设备|机器|托盘|夹子)' then return 'non_consumable'; end if;
  if v_name ~ '(纸巾|小票纸|收银纸|垃圾袋|手套|口罩|洗洁精|消毒液|清洁剂|抹布|百洁布|保鲜膜|铝箔|拖把|清洁布)' then return 'consumable'; end if;
  if v_name ~ '(杯盖|碗盖|杯套|杯托|餐盒|打包|包装|吸管|纸袋|保温袋|塑料袋|封口膜|封贴|标签|贴纸|腰封|外卖袋|纸杯|塑料杯|注塑杯|果茶杯|燕麦杯|热饮杯|纸碗|透明碗|磨砂罐|酸奶罐罐|叉勺|一次性勺)' then return 'packaging'; end if;
  if v_name ~ '(冷冻|冻果|冰冻|雪酪|冰淇淋|冰沙)' then return 'frozen'; end if;
  if v_name !~ '(果酱|果泥|果汁|果粉|果粒|罐头|糖浆|调味|冻|椰子块|椰子片)'
     and v_name ~ '(凤梨|菠萝|树莓|牛油果|红柚|柚子|芒果|草莓|蓝莓|柠檬|香蕉|无花果|红提|青提|葡萄|绿宝石瓜|哈密瓜|西瓜|羽衣甘蓝|芭乐|番石榴|苹果|梨|橙|橘|火龙果|猕猴桃|奇异果|黑莓|桑葚|桃|李子|荔枝|龙眼|百香果|枇杷|杨梅)' then return 'fruit'; end if;
  return 'other_food';
end $$;

update public.products
set category_code=public.infer_product_category(name,spec);

