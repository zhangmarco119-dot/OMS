with manager_extra_products as (
  select distinct
    item.store_id,
    trim(item.product_snapshot ->> 'name') as name,
    trim(item.product_snapshot ->> 'spec') as spec,
    trim(item.product_snapshot ->> 'count_unit') as count_unit
  from public.task_items item
  join public.tasks task on task.id = item.task_id
  join public.profiles profile on profile.id = task.created_by
  where item.is_extra_item = true
    and item.product_id is null
    and profile.role = 'manager'
    and nullif(trim(item.product_snapshot ->> 'name'), '') is not null
    and nullif(trim(item.product_snapshot ->> 'spec'), '') is not null
    and nullif(trim(item.product_snapshot ->> 'count_unit'), '') is not null
)
insert into public.products (store_id, name, spec, count_unit, product_code, sort_order, is_active)
select
  store_id,
  name,
  spec,
  count_unit,
  null,
  100000 + row_number() over (partition by store_id order by name, spec, count_unit),
  true
from manager_extra_products
on conflict (store_id, name, spec, count_unit) do nothing;

update public.task_items item
set product_id = product.id,
    product_snapshot = jsonb_set(item.product_snapshot, '{product_id}', to_jsonb(product.id::text), true)
from public.tasks task,
     public.profiles profile,
     public.products product
where task.id = item.task_id
  and profile.id = task.created_by
  and profile.role = 'manager'
  and item.is_extra_item = true
  and item.product_id is null
  and product.store_id = item.store_id
  and product.name = trim(item.product_snapshot ->> 'name')
  and product.spec = trim(item.product_snapshot ->> 'spec')
  and product.count_unit = trim(item.product_snapshot ->> 'count_unit');

insert into public.product_feedback (
  store_id,
  task_item_id,
  product_id,
  feedback_type,
  original_snapshot,
  suggested_changes,
  note,
  created_by
)
select
  item.store_id,
  item.id,
  item.product_id,
  'new',
  item.product_snapshot,
  item.product_snapshot,
  item.staff_note,
  task.created_by
from public.task_items item
join public.tasks task on task.id = item.task_id
join public.profiles profile on profile.id = task.created_by
where item.is_extra_item = true
  and item.product_id is not null
  and profile.role = 'manager'
  and not exists (
    select 1
    from public.product_feedback feedback
    where feedback.task_item_id = item.id
      and feedback.feedback_type = 'new'
  );
