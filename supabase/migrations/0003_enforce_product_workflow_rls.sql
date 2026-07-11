drop policy if exists products_update_manager on public.products;

create policy products_update_admin
on public.products for update
to authenticated
using (
  public.current_user_role() = 'admin'
  and public.has_store_access(store_id)
)
with check (
  public.current_user_role() = 'admin'
  and public.has_store_access(store_id)
);

drop policy if exists product_feedback_update_manager on public.product_feedback;

create policy product_feedback_update_admin
on public.product_feedback for update
to authenticated
using (
  public.current_user_role() = 'admin'
  and public.has_store_access(store_id)
)
with check (
  public.current_user_role() = 'admin'
  and public.has_store_access(store_id)
);

drop policy if exists product_feedback_insert_allowed on public.product_feedback;

create policy product_feedback_insert_allowed
on public.product_feedback for insert
to authenticated
with check (
  public.has_store_access(store_id)
  and created_by = auth.uid()
  and public.can_view_task((select task_id from public.task_items where id = task_item_id))
  and store_id = (select item.store_id from public.task_items item where item.id = task_item_id)
  and (
    product_id is null
    or product_id = (select item.product_id from public.task_items item where item.id = task_item_id)
  )
);
