-- Product categories, scoped inventory tasks, and arrival-driven product requests.

create table public.product_categories (
  code text primary key,
  label text not null unique,
  sort_order integer not null,
  created_at timestamptz not null default now()
);

insert into public.product_categories(code,label,sort_order) values
  ('fruit','水果',10),
  ('frozen','冷冻食材',20),
  ('other_food','其他食材',30),
  ('packaging','包材',40),
  ('consumable','耗材',50),
  ('non_consumable','非消耗性物品',60);

alter table public.product_categories enable row level security;
create policy product_categories_select_authenticated on public.product_categories
  for select to authenticated using (true);
grant select on public.product_categories to authenticated;

alter table public.products
  add column category_code text not null default 'other_food'
  references public.product_categories(code);

create index products_store_category_idx
  on public.products(store_id,category_code,is_active,sort_order,name);

create or replace function public.infer_product_category(p_name text,p_spec text default '')
returns text language plpgsql immutable as $$
declare v text := lower(coalesce(p_name,'') || ' ' || coalesce(p_spec,''));
begin
  if v ~ '(冰沙机|酸奶机|制冰机|冰箱|冷柜|空调|插排|电子秤|钢勺|不锈钢|量杯|剪刀|刀具|砧板|器皿|设备|机器|托盘|夹子)' then return 'non_consumable'; end if;
  if v ~ '(纸巾|小票纸|收银纸|垃圾袋|手套|口罩|洗洁精|消毒液|清洁剂|抹布|百洁布|保鲜膜|铝箔|拖把|清洁布)' then return 'consumable'; end if;
  if v ~ '(杯盖|碗盖|杯套|餐盒|打包|包装|吸管|纸袋|塑料袋|封口膜|标签|贴纸|外卖袋|纸杯|塑料杯|杯|碗|一次性勺)' then return 'packaging'; end if;
  if v ~ '(冷冻|冻果|冰冻|雪酪|冰淇淋|冰沙)' then return 'frozen'; end if;
  if v !~ '(果酱|果泥|果汁|果粉|果粒|罐头|糖浆|调味|冻)' and v ~ '(草莓|蓝莓|芒果|香蕉|苹果|雪梨|梨|橙|橘|柚|柠檬|西瓜|哈密瓜|火龙果|猕猴桃|奇异果|葡萄|树莓|黑莓|桑葚|菠萝|凤梨|桃|李子|荔枝|龙眼|百香果|椰子|牛油果|枇杷|杨梅)' then return 'fruit'; end if;
  return 'other_food';
end $$;

update public.products
set category_code = public.infer_product_category(name,spec);

create or replace function public.update_product_category(p_product_id uuid,p_category_code text)
returns public.products language plpgsql security definer set search_path=public as $$
declare v_product public.products%rowtype;
begin
  if not exists(select 1 from public.product_categories where code=p_category_code) then
    raise exception '请选择有效的货品分类' using errcode='22023';
  end if;
  select * into v_product from public.products where id=p_product_id for update;
  if v_product.id is null or not public.can_manage_store(v_product.store_id) then
    raise exception '没有权限修改此货品分类' using errcode='42501';
  end if;
  update public.products set category_code=p_category_code where id=p_product_id returning * into v_product;
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata)
  values(v_product.store_id,auth.uid(),'product_category_updated','products',v_product.id,jsonb_build_object('category_code',p_category_code));
  return v_product;
end $$;

alter table public.tasks
  add column inventory_category_codes text[] not null default array['fruit','frozen','other_food','packaging','consumable','non_consumable']::text[],
  add column linked_v2_task_id uuid references public.v2_tasks(id) on delete set null;

alter table public.tasks add constraint tasks_inventory_category_codes_check check (
  inventory_category_codes <@ array['fruit','frozen','other_food','packaging','consumable','non_consumable']::text[]
  and cardinality(inventory_category_codes)>0
);
create unique index tasks_linked_v2_task_creator_idx on public.tasks(linked_v2_task_id,created_by)
  where linked_v2_task_id is not null and task_type='inventory';

alter table public.v2_tasks
  add column requires_inventory boolean not null default false,
  add column inventory_category_codes text[] not null default '{}'::text[];
alter table public.v2_task_schedules
  add column requires_inventory boolean not null default false,
  add column inventory_category_codes text[] not null default '{}'::text[];

alter table public.v2_tasks add constraint v2_tasks_inventory_scope_check check (
  inventory_category_codes <@ array['fruit','frozen','other_food','packaging','consumable','non_consumable']::text[]
  and ((requires_inventory and cardinality(inventory_category_codes)>0) or (not requires_inventory and cardinality(inventory_category_codes)=0))
);
alter table public.v2_task_schedules add constraint v2_task_schedules_inventory_scope_check check (
  inventory_category_codes <@ array['fruit','frozen','other_food','packaging','consumable','non_consumable']::text[]
  and ((requires_inventory and cardinality(inventory_category_codes)>0) or (not requires_inventory and cardinality(inventory_category_codes)=0))
);

create table public.product_creation_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  report_id uuid not null references public.arrival_reports(id) on delete cascade,
  arrival_item_id uuid not null references public.arrival_report_items(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),
  name text not null,
  spec text not null,
  count_unit text not null,
  category_code text not null references public.product_categories(code),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  product_id uuid references public.products(id) on delete set null,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(report_id,arrival_item_id)
);
create trigger product_creation_requests_touch_updated_at before update on public.product_creation_requests
  for each row execute function public.touch_updated_at();
create index product_creation_requests_store_status_idx on public.product_creation_requests(store_id,status,created_at desc);
alter table public.product_creation_requests enable row level security;
create policy product_creation_requests_select_allowed on public.product_creation_requests for select to authenticated using (
  requested_by=auth.uid() or public.can_manage_store(store_id)
);
grant select on public.product_creation_requests to authenticated;

create or replace function public.request_arrival_product_creation(p_report_id uuid,p_requests jsonb)
returns setof public.product_creation_requests language plpgsql security definer set search_path=public as $$
declare v_report public.arrival_reports%rowtype; v_entry jsonb; v_item public.arrival_report_items%rowtype; v_request public.product_creation_requests%rowtype;
begin
  select * into v_report from public.arrival_reports where id=p_report_id;
  if v_report.id is null or v_report.reported_by<>auth.uid() or v_report.status not in ('submitted','viewed') then
    raise exception '只能为本人已提交的到货上报申请新增货品' using errcode='42501';
  end if;
  for v_entry in select value from jsonb_array_elements(coalesce(p_requests,'[]'::jsonb)) loop
    select * into v_item from public.arrival_report_items
    where id=(v_entry->>'arrival_item_id')::uuid and report_id=v_report.id and is_unmatched_product;
    if v_item.id is null then raise exception '未匹配的到货明细不存在' using errcode='22023'; end if;
    if nullif(btrim(v_entry->>'name'),'') is null or nullif(btrim(v_entry->>'spec'),'') is null or nullif(btrim(v_entry->>'count_unit'),'') is null then
      raise exception '货品名称、规格和单位均为必填项' using errcode='22023';
    end if;
    if not exists(select 1 from public.product_categories where code=v_entry->>'category_code') then raise exception '请选择有效的货品分类' using errcode='22023'; end if;
    insert into public.product_creation_requests(store_id,report_id,arrival_item_id,requested_by,name,spec,count_unit,category_code)
    values(v_report.store_id,v_report.id,v_item.id,auth.uid(),btrim(v_entry->>'name'),btrim(v_entry->>'spec'),btrim(v_entry->>'count_unit'),v_entry->>'category_code')
    on conflict(report_id,arrival_item_id) do update set name=excluded.name,spec=excluded.spec,count_unit=excluded.count_unit,category_code=excluded.category_code,status='pending',reviewed_by=null,reviewed_at=null,review_note=null
    returning * into v_request;
    insert into public.notifications(recipient_role,store_id,type,title,body,entity_type,entity_id,dedupe_key)
    values('admin',v_report.store_id,'product_creation_requested','到货货品待新增审核',v_request.name,'product_creation_request',v_request.id,'product-create-request:'||v_request.id||':admin') on conflict(dedupe_key) do nothing;
    insert into public.notifications(recipient_role,store_id,type,title,body,entity_type,entity_id,dedupe_key)
    values('manager',v_report.store_id,'product_creation_requested','到货货品待新增审核',v_request.name,'product_creation_request',v_request.id,'product-create-request:'||v_request.id||':manager') on conflict(dedupe_key) do nothing;
    return next v_request;
  end loop;
end $$;

create or replace function public.review_product_creation_request(p_request_id uuid,p_action text,p_note text default null)
returns public.product_creation_requests language plpgsql security definer set search_path=public as $$
declare v_request public.product_creation_requests%rowtype; v_product public.products%rowtype;
begin
  select * into v_request from public.product_creation_requests where id=p_request_id for update;
  if v_request.id is null or not public.can_manage_store(v_request.store_id) then raise exception '没有权限审核此货品申请' using errcode='42501'; end if;
  if v_request.status<>'pending' then raise exception '此货品申请已处理' using errcode='55000'; end if;
  if p_action='approve' then
    select * into v_product from public.products where store_id=v_request.store_id and name=v_request.name and spec=v_request.spec and count_unit=v_request.count_unit limit 1;
    if v_product.id is null then
      insert into public.products(store_id,name,spec,count_unit,category_code,sort_order,is_active)
      values(v_request.store_id,v_request.name,v_request.spec,v_request.count_unit,v_request.category_code,(select coalesce(max(sort_order),0)+10 from public.products where store_id=v_request.store_id),true)
      returning * into v_product;
    else
      update public.products set is_active=true,category_code=v_request.category_code where id=v_product.id returning * into v_product;
    end if;
    update public.arrival_report_items set product_id=v_product.id,is_unmatched_product=false,product_name_snapshot=v_product.name,unit=v_product.count_unit where id=v_request.arrival_item_id;
    update public.product_creation_requests set status='approved',product_id=v_product.id,reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(btrim(p_note),'') where id=v_request.id returning * into v_request;
  elsif p_action='reject' then
    update public.product_creation_requests set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(btrim(p_note),'') where id=v_request.id returning * into v_request;
  else raise exception '无效的审核操作' using errcode='22023'; end if;
  delete from public.notifications where entity_type='product_creation_request' and entity_id=v_request.id;
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata)
  values(v_request.store_id,auth.uid(),'product_creation_request_'||v_request.status,'product_creation_requests',v_request.id,jsonb_build_object('product_id',v_request.product_id));
  return v_request;
end $$;

revoke all on function public.update_product_category(uuid,text),public.request_arrival_product_creation(uuid,jsonb),public.review_product_creation_request(uuid,text,text) from public,anon;
grant execute on function public.update_product_category(uuid,text),public.request_arrival_product_creation(uuid,jsonb),public.review_product_creation_request(uuid,text,text) to authenticated;

create or replace function public.set_inventory_task_categories(p_task_id uuid,p_category_codes text[])
returns public.tasks language plpgsql security definer set search_path=public as $$
declare v_task public.tasks%rowtype; v_product public.products%rowtype;
begin
  if coalesce(cardinality(p_category_codes),0)=0 or not p_category_codes <@ array['fruit','frozen','other_food','packaging','consumable','non_consumable']::text[] then
    raise exception '请至少选择一个有效的点货分类' using errcode='22023';
  end if;
  select * into v_task from public.tasks where id=p_task_id for update;
  if v_task.id is null or v_task.created_by<>auth.uid() or v_task.status<>'draft' or v_task.task_type<>'inventory' then raise exception '点货草稿不可修改' using errcode='42501'; end if;
  if v_task.linked_v2_task_id is not null then raise exception '任务关联点货的范围由管理员设定，不能修改' using errcode='55000'; end if;
  update public.tasks set inventory_category_codes=(select array_agg(distinct value order by value) from unnest(p_category_codes) value) where id=v_task.id returning * into v_task;
  delete from public.task_items item using public.products product
  where item.task_id=v_task.id and item.product_id=product.id and not product.category_code=any(p_category_codes) and not item.is_extra_item;
  for v_product in select * from public.products where store_id=v_task.store_id and is_active and category_code=any(p_category_codes) order by sort_order,name loop
    if not exists(select 1 from public.task_items where task_id=v_task.id and product_id=v_product.id) then
      insert into public.task_items(task_id,store_id,product_id,product_snapshot,status,quantity,sort_order)
      values(v_task.id,v_task.store_id,v_product.id,jsonb_build_object('product_id',v_product.id,'name',v_product.name,'spec',v_product.spec,'count_unit',v_product.count_unit,'product_code',v_product.product_code,'category_code',v_product.category_code),'pending',null,v_product.sort_order);
    end if;
  end loop;
  return v_task;
end $$;

create or replace function public.create_linked_inventory_task(p_v2_task_id uuid)
returns public.tasks language plpgsql security definer set search_path=public as $$
declare v_v2 public.v2_tasks%rowtype; v_task public.tasks%rowtype; v_product public.products%rowtype;
begin
  select * into v_v2 from public.v2_tasks where id=p_v2_task_id;
  if v_v2.id is null or not public.can_edit_v2_task(v_v2.id) or not v_v2.requires_inventory then raise exception '此任务没有可执行的关联点货' using errcode='42501'; end if;
  select * into v_task from public.tasks where linked_v2_task_id=v_v2.id and created_by=auth.uid() limit 1;
  if v_task.id is not null then return v_task; end if;
  insert into public.tasks(store_id,created_by,task_type,status,inventory_category_codes,linked_v2_task_id)
  values(v_v2.store_id,auth.uid(),'inventory','draft',v_v2.inventory_category_codes,v_v2.id) returning * into v_task;
  for v_product in select * from public.products where store_id=v_v2.store_id and is_active and category_code=any(v_v2.inventory_category_codes) order by sort_order,name loop
    insert into public.task_items(task_id,store_id,product_id,product_snapshot,status,quantity,sort_order)
    values(v_task.id,v_task.store_id,v_product.id,jsonb_build_object('product_id',v_product.id,'name',v_product.name,'spec',v_product.spec,'count_unit',v_product.count_unit,'product_code',v_product.product_code,'category_code',v_product.category_code),'pending',null,v_product.sort_order);
  end loop;
  return v_task;
end $$;

create or replace function public.validate_linked_inventory_submission()
returns trigger language plpgsql set search_path=public as $$
declare v_v2 public.v2_tasks%rowtype;
begin
  if new.linked_v2_task_id is null then return new; end if;
  select * into v_v2 from public.v2_tasks where id=new.linked_v2_task_id;
  if v_v2.id is null or not v_v2.requires_inventory or v_v2.store_id<>new.store_id or new.task_type<>'inventory'
     or new.inventory_category_codes<>v_v2.inventory_category_codes then
    raise exception '关联点货范围与任务要求不一致' using errcode='23514';
  end if;
  return new;
end $$;
create trigger tasks_validate_linked_inventory before insert or update of linked_v2_task_id,inventory_category_codes,status on public.tasks
  for each row execute function public.validate_linked_inventory_submission();

create or replace function public.require_inventory_before_v2_task_submission()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.requires_inventory and new.status in ('submitted','resubmitted','approved') and old.status not in ('submitted','resubmitted','approved') and not exists(
    select 1 from public.tasks inventory
    where inventory.linked_v2_task_id=new.id and inventory.task_type='inventory' and inventory.status='submitted'
      and inventory.store_id=new.store_id and inventory.inventory_category_codes=new.inventory_category_codes
      and inventory.created_by=auth.uid()
  ) then
    raise exception '请先完成并提交任务要求范围内的点货单' using errcode='23514';
  end if;
  return new;
end $$;
create trigger v2_tasks_require_inventory before update of status on public.v2_tasks
  for each row execute function public.require_inventory_before_v2_task_submission();

create or replace function public.configure_v2_tasks_inventory(p_task_ids uuid[],p_enabled boolean,p_category_codes text[] default '{}')
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator role required' using errcode='42501'; end if;
  if p_enabled and (coalesce(cardinality(p_category_codes),0)=0 or not p_category_codes <@ array['fruit','frozen','other_food','packaging','consumable','non_consumable']::text[]) then raise exception '请至少选择一个有效的点货分类' using errcode='22023'; end if;
  update public.v2_tasks set requires_inventory=p_enabled,inventory_category_codes=case when p_enabled then p_category_codes else '{}'::text[] end,version=version+1
  where id=any(p_task_ids) and public.has_store_access(store_id) and status in ('pending','in_progress','rejected','overdue');
  get diagnostics v_count=row_count; return v_count;
end $$;

create or replace function public.publish_v2_tasks_v4(
  p_template_id uuid,p_store_ids uuid[],p_due_at timestamptz,p_publish_at timestamptz default now(),p_profile_ids uuid[] default '{}',
  p_target_audiences text[] default array['staff','manager']::text[],p_manager_review_enabled boolean default false,
  p_related_sop_id uuid default null,p_related_notice_id uuid default null,p_requires_inventory boolean default false,p_inventory_category_codes text[] default '{}'
)
returns setof public.v2_tasks language plpgsql security definer set search_path=public as $$
declare v_task public.v2_tasks%rowtype;
begin
  if p_requires_inventory and (coalesce(cardinality(p_inventory_category_codes),0)=0 or not p_inventory_category_codes <@ array['fruit','frozen','other_food','packaging','consumable','non_consumable']::text[]) then raise exception '请至少选择一个有效的点货分类' using errcode='22023'; end if;
  for v_task in select * from public.publish_v2_tasks_v3(p_template_id,p_store_ids,p_due_at,p_publish_at,p_profile_ids,p_target_audiences,p_manager_review_enabled,p_related_sop_id,p_related_notice_id) loop
    update public.v2_tasks set requires_inventory=p_requires_inventory,inventory_category_codes=case when p_requires_inventory then p_inventory_category_codes else '{}'::text[] end where id=v_task.id returning * into v_task;
    return next v_task;
  end loop; return;
end $$;

create or replace function public.create_v2_task_schedule_v4(
  p_template_id uuid,p_store_ids uuid[],p_profile_ids uuid[],p_fields jsonb,p_related_sop_id uuid default null,p_related_notice_id uuid default null,
  p_requires_inventory boolean default false,p_inventory_category_codes text[] default '{}'
)
returns setof public.v2_tasks language plpgsql security definer set search_path=public as $$
declare v_task public.v2_tasks%rowtype; v_started timestamptz:=now(); v_schedule_ids uuid[];
begin
  if p_requires_inventory and (coalesce(cardinality(p_inventory_category_codes),0)=0 or not p_inventory_category_codes <@ array['fruit','frozen','other_food','packaging','consumable','non_consumable']::text[]) then raise exception '请至少选择一个有效的点货分类' using errcode='22023'; end if;
  for v_task in select * from public.create_v2_task_schedule_v3(p_template_id,p_store_ids,p_profile_ids,p_fields,p_related_sop_id,p_related_notice_id) loop return next v_task; end loop;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_schedule_ids from public.v2_task_schedules where created_by=auth.uid() and template_id=p_template_id and store_id=any(p_store_ids) and created_at>=v_started;
  update public.v2_task_schedules set requires_inventory=p_requires_inventory,inventory_category_codes=case when p_requires_inventory then p_inventory_category_codes else '{}'::text[] end where id=any(v_schedule_ids);
  update public.v2_tasks set requires_inventory=p_requires_inventory,inventory_category_codes=case when p_requires_inventory then p_inventory_category_codes else '{}'::text[] end where schedule_id=any(v_schedule_ids);
  return;
end $$;

create or replace function public.update_v2_task_content_v4(
  p_task_id uuid,p_name text,p_snapshot jsonb,p_due_at timestamptz,p_manager_review_enabled boolean default false,
  p_related_sop_id uuid default null,p_related_notice_id uuid default null,p_requires_inventory boolean default false,p_inventory_category_codes text[] default '{}'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  v_result:=public.update_v2_task_content_v3(p_task_id,p_name,p_snapshot,p_due_at,p_manager_review_enabled,p_related_sop_id,p_related_notice_id);
  perform public.configure_v2_tasks_inventory(array[p_task_id],p_requires_inventory,p_inventory_category_codes);
  return (select to_jsonb(task) from public.v2_tasks task where id=p_task_id);
end $$;

create or replace function public.update_v2_task_schedule_all_v3(
  p_schedule_id uuid,p_fields jsonb,p_name text,p_snapshot jsonb,p_related_sop_id uuid default null,p_related_notice_id uuid default null,
  p_requires_inventory boolean default false,p_inventory_category_codes text[] default '{}'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_schedule public.v2_task_schedules%rowtype;
begin
  if p_requires_inventory and (coalesce(cardinality(p_inventory_category_codes),0)=0 or not p_inventory_category_codes <@ array['fruit','frozen','other_food','packaging','consumable','non_consumable']::text[]) then raise exception '请至少选择一个有效的点货分类' using errcode='22023'; end if;
  v_result:=public.update_v2_task_schedule_all_v2(p_schedule_id,p_fields,p_name,p_snapshot,p_related_sop_id,p_related_notice_id);
  update public.v2_task_schedules set requires_inventory=p_requires_inventory,inventory_category_codes=case when p_requires_inventory then p_inventory_category_codes else '{}'::text[] end where id=p_schedule_id returning * into v_schedule;
  update public.v2_tasks set requires_inventory=p_requires_inventory,inventory_category_codes=case when p_requires_inventory then p_inventory_category_codes else '{}'::text[] end,version=version+1 where schedule_id=p_schedule_id and status in ('pending','in_progress','rejected','overdue');
  return v_result;
end $$;

revoke all on function public.set_inventory_task_categories(uuid,text[]),public.create_linked_inventory_task(uuid),public.configure_v2_tasks_inventory(uuid[],boolean,text[]),
  public.publish_v2_tasks_v4(uuid,uuid[],timestamptz,timestamptz,uuid[],text[],boolean,uuid,uuid,boolean,text[]),
  public.create_v2_task_schedule_v4(uuid,uuid[],uuid[],jsonb,uuid,uuid,boolean,text[]),
  public.update_v2_task_content_v4(uuid,text,jsonb,timestamptz,boolean,uuid,uuid,boolean,text[]),
  public.update_v2_task_schedule_all_v3(uuid,jsonb,text,jsonb,uuid,uuid,boolean,text[]) from public,anon;
grant execute on function public.set_inventory_task_categories(uuid,text[]),public.create_linked_inventory_task(uuid),public.configure_v2_tasks_inventory(uuid[],boolean,text[]),
  public.publish_v2_tasks_v4(uuid,uuid[],timestamptz,timestamptz,uuid[],text[],boolean,uuid,uuid,boolean,text[]),
  public.create_v2_task_schedule_v4(uuid,uuid[],uuid[],jsonb,uuid,uuid,boolean,text[]),
  public.update_v2_task_content_v4(uuid,text,jsonb,timestamptz,boolean,uuid,uuid,boolean,text[]),
  public.update_v2_task_schedule_all_v3(uuid,jsonb,text,jsonb,uuid,uuid,boolean,text[]) to authenticated;

create or replace function public.create_v2_task_from_schedule(p_schedule_id uuid,p_due_at timestamptz)
returns public.v2_tasks language plpgsql security definer set search_path=public as $$
declare v_schedule public.v2_task_schedules%rowtype; v_version public.v2_task_template_versions%rowtype; v_task public.v2_tasks%rowtype; v_group jsonb; v_item jsonb; v_snapshot jsonb; v_name text;
begin
  select * into v_schedule from public.v2_task_schedules where id=p_schedule_id for update;
  if v_schedule.id is null then raise exception 'task schedule not found' using errcode='P0002'; end if;
  select * into v_version from public.v2_task_template_versions where id=v_schedule.template_version_id;
  if v_version.id is null then raise exception 'task template version not found' using errcode='P0002'; end if;
  v_snapshot:=coalesce(v_schedule.content_snapshot,v_version.snapshot);
  v_name:=coalesce(nullif(v_schedule.content_name,''),v_snapshot->'template'->>'name');
  insert into public.v2_tasks(
    template_id,template_version_id,schedule_id,store_id,assigned_profile_id,target_audiences,
    name,category,snapshot,due_at,publish_at,allow_overdue,requires_review,manager_review_enabled,
    related_sop_id,related_notice_id,related_content_title,requires_inventory,inventory_category_codes,created_by
  ) values(
    v_schedule.template_id,v_schedule.template_version_id,v_schedule.id,v_schedule.store_id,v_schedule.assigned_profile_id,v_schedule.target_audiences,
    v_name,v_snapshot->'template'->>'category',v_snapshot,p_due_at,now(),coalesce((v_snapshot->'template'->>'allow_overdue')::boolean,false),
    coalesce((v_snapshot->'template'->>'requires_review')::boolean,true),v_schedule.manager_review_enabled,v_schedule.related_sop_id,v_schedule.related_notice_id,
    v_schedule.related_content_title,v_schedule.requires_inventory,v_schedule.inventory_category_codes,v_schedule.created_by
  ) returning * into v_task;
  for v_group in select value from jsonb_array_elements(v_snapshot->'groups') loop
    for v_item in select value from jsonb_array_elements(v_group->'items') loop
      insert into public.v2_task_answers(task_id,item_id,group_id,item_snapshot)
      values(v_task.id,(v_item->>'id')::uuid,(v_group->>'id')::uuid,v_item);
    end loop;
  end loop;
  perform public.notify_v2_task_publication(v_task.id);
  insert into public.audit_logs(store_id,actor_id,action,entity_table,entity_id,metadata)
  values(v_schedule.store_id,v_schedule.created_by,'v2_scheduled_task_published','v2_tasks',v_task.id,
    jsonb_build_object('schedule_id',v_schedule.id,'assigned_profile_id',v_schedule.assigned_profile_id,'target_audiences',v_schedule.target_audiences,
      'manager_review_enabled',v_schedule.manager_review_enabled,'related_sop_id',v_schedule.related_sop_id,'related_notice_id',v_schedule.related_notice_id,
      'requires_inventory',v_schedule.requires_inventory,'inventory_category_codes',v_schedule.inventory_category_codes));
  return v_task;
end $$;
