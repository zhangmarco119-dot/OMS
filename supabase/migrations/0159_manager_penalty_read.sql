-- Store managers must be able to read penalties they created so the
-- manager evidence-insert policy can verify penalty ownership.
create policy payroll_penalties_manager_read on public.payroll_penalties
for select to authenticated using (
  public.current_user_role() = 'manager'
  and created_by = auth.uid()
);
