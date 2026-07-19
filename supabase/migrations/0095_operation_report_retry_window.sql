-- Preserve the last failed refresh timestamp so failed attempts also respect
-- the 30-second operation-report anti-spam window.

create or replace function public.release_operation_report_refresh(p_report_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.operation_reports
  set refresh_started_at = coalesce(refresh_started_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where id = p_report_id and status = 'draft' and created_by = auth.uid();
end $$;

revoke all on function public.release_operation_report_refresh(uuid) from public, anon;
grant execute on function public.release_operation_report_refresh(uuid) to authenticated;
