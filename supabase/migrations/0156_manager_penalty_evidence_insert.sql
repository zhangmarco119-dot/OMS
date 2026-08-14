-- Allow a store manager to attach evidence images to penalties they created.
create policy payroll_penalty_assets_manager_insert on public.payroll_penalty_assets
for insert to authenticated with check (
  public.current_user_role() = 'manager'
  and uploaded_by = auth.uid()
  and exists (
    select 1 from public.payroll_penalties penalty
    where penalty.id = penalty_id
      and penalty.created_by = auth.uid()
  )
);
