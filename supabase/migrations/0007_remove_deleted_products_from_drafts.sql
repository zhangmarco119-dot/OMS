delete from public.task_items item
using public.tasks task
where task.id = item.task_id
  and task.status = 'draft'
  and (
    item.product_action_status = 'deletion_approved'
    or (
      nullif(item.product_snapshot ->> 'product_id', '') is not null
      and not exists (
        select 1
        from public.products product
        where product.id::text = item.product_snapshot ->> 'product_id'
          and product.store_id = item.store_id
          and product.is_active = true
      )
    )
  );
