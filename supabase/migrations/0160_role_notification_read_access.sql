-- Role-targeted notifications are shared operational todos. Allow the
-- matching role to acknowledge notifications within its authorized stores.

create policy notifications_update_role_recipient
on public.notifications for update
to authenticated
using (
  recipient_user_id is null
  and recipient_role = public.current_user_role()
  and (store_id is null or public.has_store_access(store_id))
)
with check (
  recipient_user_id is null
  and recipient_role = public.current_user_role()
  and (store_id is null or public.has_store_access(store_id))
);
