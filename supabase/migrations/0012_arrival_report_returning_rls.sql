drop policy if exists arrival_reports_select_allowed on public.arrival_reports;

create policy arrival_reports_select_allowed
on public.arrival_reports for select
to authenticated
using (
  public.has_store_access(store_id)
  and (
    public.current_user_role() = 'admin'
    or (
      public.current_user_role() in ('staff', 'manager')
      and store_id = public.current_user_store_id()
      and (status <> 'draft' or reported_by = auth.uid())
    )
  )
);
