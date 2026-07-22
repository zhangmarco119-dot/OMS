-- Allow the original store reporter to correct and resubmit an arrival that an
-- administrator voided. The report is reopened in place so its images, item
-- associations and audit history remain intact.

create or replace function public.reopen_voided_arrival_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.arrival_reports%rowtype;
  v_other_draft public.arrival_reports%rowtype;
  v_previous_reason text;
begin
  select * into v_report
  from public.arrival_reports
  where id = p_report_id
  for update;

  if v_report.id is null then
    raise exception 'arrival report not found' using errcode = 'P0002';
  end if;
  if v_report.status <> 'voided' then
    raise exception 'only voided arrival reports can be reopened' using errcode = '55000';
  end if;
  if v_report.reported_by <> auth.uid()
    or not public.can_operate_arrival_modules(v_report.store_id) then
    raise exception 'arrival report reopen denied' using errcode = '42501';
  end if;

  select * into v_other_draft
  from public.arrival_reports
  where store_id = v_report.store_id
    and reported_by = v_report.reported_by
    and status = 'draft'
    and id <> v_report.id
  order by updated_at desc
  limit 1
  for update;

  if v_other_draft.id is not null then
    if exists (select 1 from public.arrival_report_items where report_id = v_other_draft.id)
      or exists (select 1 from public.arrival_report_images where report_id = v_other_draft.id)
      or v_other_draft.carrier_name is not null
      or v_other_draft.tracking_no is not null
      or v_other_draft.note is not null
      or nullif(btrim(v_other_draft.generated_summary), '') is not null then
      raise exception '请先完成当前到货草稿，再修改已作废的上报。' using errcode = '55000';
    end if;
    delete from public.arrival_reports where id = v_other_draft.id;
  end if;

  v_previous_reason := v_report.void_reason;

  update public.arrival_reports
  set status = 'draft',
      submission_key = null,
      submitted_at = null,
      viewed_at = null,
      viewed_by = null,
      voided_at = null,
      voided_by = null,
      void_reason = null
  where id = p_report_id
  returning * into v_report;

  delete from public.notifications
  where entity_type = 'arrival_report'
    and entity_id = p_report_id
    and recipient_role = 'admin';

  insert into public.audit_logs (
    store_id, actor_id, action, entity_table, entity_id, metadata
  ) values (
    v_report.store_id,
    auth.uid(),
    'arrival_report_reopened',
    'arrival_reports',
    v_report.id,
    jsonb_build_object(
      'report_no', v_report.report_no,
      'previous_void_reason', v_previous_reason,
      'version', v_report.version
    )
  );

  return to_jsonb(v_report);
end;
$$;

revoke all on function public.reopen_voided_arrival_report(uuid) from public;
grant execute on function public.reopen_voided_arrival_report(uuid) to authenticated;
