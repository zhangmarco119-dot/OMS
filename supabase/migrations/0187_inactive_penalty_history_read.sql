-- Keep history visible to an authorized administrator after an account is disabled.
-- The existing policy continues to govern all writes and active employees.
create policy payroll_penalties_admin_inactive_read on public.payroll_penalties
for select to authenticated using (
  public.current_user_role() = 'admin'
  and exists (
    select 1 from public.profiles target
    where target.id = profile_id
      and target.role in ('staff', 'manager')
      and not target.is_active
      and target.deleted_at is null
      and public.has_store_access(target.store_id)
  )
);
