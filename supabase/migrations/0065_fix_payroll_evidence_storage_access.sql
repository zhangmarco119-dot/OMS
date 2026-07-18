-- Resolve private Storage access through a stable security-definer helper.
-- This keeps evidence private while allowing the affected employee to view it.

create or replace function public.can_read_payroll_evidence(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_role() = 'admin'
    or exists (
      select 1
      from public.payroll_penalty_assets asset
      join public.payroll_penalties penalty on penalty.id = asset.penalty_id
      where asset.object_path = p_object_path
        and penalty.profile_id = auth.uid()
    );
$$;

revoke all on function public.can_read_payroll_evidence(text) from public;
grant execute on function public.can_read_payroll_evidence(text) to authenticated;

drop policy if exists payroll_evidence_objects_select on storage.objects;
create policy payroll_evidence_objects_select on storage.objects
for select to authenticated using (
  bucket_id = 'payroll-evidence'
  and (owner_id = auth.uid()::text or public.can_read_payroll_evidence(name))
);
