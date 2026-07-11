begin;

drop function if exists public.save_arrival_draft(uuid, integer, jsonb, jsonb);
drop index if exists public.arrival_reports_one_draft_per_reporter_idx;

grant update, delete on public.arrival_reports to authenticated;
grant insert, update, delete on public.arrival_report_items to authenticated;

commit;
