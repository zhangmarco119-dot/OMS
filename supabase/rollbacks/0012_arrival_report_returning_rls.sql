drop policy if exists arrival_reports_select_allowed on public.arrival_reports;

create policy arrival_reports_select_allowed
on public.arrival_reports for select
to authenticated
using (public.can_read_arrival_report(id));
