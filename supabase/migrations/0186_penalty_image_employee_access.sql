-- Employees must be able to read the metadata for their own penalty photos.
-- The existing security-definer helper checks ownership without requiring the
-- employee to have direct access to the payroll_penalties table.
drop policy if exists payroll_penalty_assets_read on public.payroll_penalty_assets;
create policy payroll_penalty_assets_read on public.payroll_penalty_assets
for select to authenticated using (
  uploaded_by = auth.uid()
  or public.can_read_payroll_evidence(object_path)
);
