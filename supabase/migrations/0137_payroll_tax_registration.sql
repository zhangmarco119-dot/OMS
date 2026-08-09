-- Promote the existing monthly individual-income-tax override into the
-- administrator's actual-tax register and keep payroll payslip snapshots in
-- sync. Real-time payroll can still estimate tax when no actual amount exists.

comment on table public.payroll_individual_tax_overrides is
  'Administrator-registered actual individual income tax for each employee and payroll month.';

create or replace function public.payroll_snapshot_with_registered_tax(
  p_snapshot jsonb,
  p_tax numeric,
  p_registered boolean default true
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_tax numeric := round(greatest(coalesce(p_tax, 0), 0), 2);
  v_fine numeric := coalesce(nullif(p_snapshot->>'fineTotal', '')::numeric, 0);
  v_previous_tax numeric := coalesce(nullif(p_snapshot->>'individualIncomeTax', '')::numeric, 0);
  v_known_before_tax numeric := coalesce(
    nullif(p_snapshot->>'knownEstimatedPayable', '')::numeric + v_previous_tax,
    nullif(p_snapshot->>'incomeSubtotalKnown', '')::numeric - v_fine,
    0
  );
  v_estimated_before_tax numeric := nullif(p_snapshot->>'estimatedPayable', '')::numeric + v_previous_tax;
begin
  return p_snapshot || jsonb_build_object(
    'individualIncomeTax', v_tax,
    'registeredIndividualIncomeTax', case when p_registered then v_tax else null end,
    'individualIncomeTaxRegistered', p_registered,
    'deductionTotal', round(v_fine + v_tax, 2),
    'knownEstimatedPayable', round(greatest(v_known_before_tax - v_tax, 0), 2),
    'knownEstimatedNetPayable', round(greatest(v_known_before_tax - v_tax, 0), 2),
    'estimatedPayable', case when v_estimated_before_tax is null then null else round(greatest(v_estimated_before_tax - v_tax, 0), 2) end,
    'estimatedNetPayable', case when v_estimated_before_tax is null then null else round(greatest(v_estimated_before_tax - v_tax, 0), 2) end
  );
end;
$$;

create or replace function public.sync_registered_tax_to_payroll_payslip(
  p_profile_id uuid,
  p_payroll_month date,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_payroll_month)::date;
  v_payslip public.payroll_payslips;
  v_was_confirmed boolean := false;
begin
  select * into v_payslip
  from public.payroll_payslips
  where profile_id = p_profile_id and payroll_month = v_month and status <> 'withdrawn'
  for update;

  if v_payslip.id is null then
    return jsonb_build_object('synced', false, 'reason', 'no_active_payslip');
  end if;

  v_was_confirmed := v_payslip.status = 'confirmed';
  update public.payroll_payslips
  set estimate_snapshot = public.payroll_snapshot_with_registered_tax(estimate_snapshot, p_amount, true),
      status = case when status = 'confirmed' then 'issued' else status end,
      confirmed_at = case when status = 'confirmed' then null else confirmed_at end,
      revision = revision + 1,
      last_modified_by = auth.uid()
  where id = v_payslip.id
  returning * into v_payslip;

  if v_payslip.status = 'issued' then
    insert into public.notifications(
      recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key
    ) values (
      v_payslip.profile_id,
      v_payslip.store_id,
      'payroll_payslip_updated',
      to_char(v_month, 'YYYY年MM月') || '工资单个税已更新',
      case when v_was_confirmed
        then '实际个税登记已同步，请重新核对并确认工资单。'
        else '实际个税登记已同步，请核对最新工资单。' end,
      'payroll_payslip',
      v_payslip.id,
      'payroll-payslip:' || v_payslip.profile_id || ':' || v_month::text
    ) on conflict(dedupe_key) do update set
      type = excluded.type,
      title = excluded.title,
      body = excluded.body,
      entity_id = excluded.entity_id,
      is_read = false,
      read_at = null,
      created_at = now();
  end if;

  return jsonb_build_object(
    'synced', true,
    'payslipId', v_payslip.id,
    'status', v_payslip.status,
    'revision', v_payslip.revision,
    'requiresReconfirmation', v_was_confirmed
  );
end;
$$;

create or replace function public.admin_save_payroll_individual_tax_override(
  p_profile_id uuid,
  p_payroll_month date,
  p_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_payroll_month)::date;
  v_sync jsonb;
begin
  if public.current_user_role() <> 'admin' or not public.can_admin_manage_attendance_profile(p_profile_id) then
    raise exception 'payroll tax access denied';
  end if;
  if p_amount is null then
    delete from public.payroll_individual_tax_overrides
    where profile_id = p_profile_id and payroll_month = v_month;
    return jsonb_build_object('mode', 'automatic', 'amount', null, 'synced', false);
  end if;
  if p_amount < 0 then raise exception 'individual income tax must not be negative'; end if;

  insert into public.payroll_individual_tax_overrides(profile_id, payroll_month, amount, updated_by)
  values(p_profile_id, v_month, round(p_amount, 2), auth.uid())
  on conflict(profile_id, payroll_month) do update set
    amount = excluded.amount,
    updated_by = auth.uid(),
    updated_at = now();

  v_sync := public.sync_registered_tax_to_payroll_payslip(p_profile_id, v_month, round(p_amount, 2));
  return jsonb_build_object('mode', 'registered', 'amount', round(p_amount, 2), 'payslip', v_sync);
end;
$$;

create function public.admin_save_payroll_individual_taxes(
  p_payroll_month date,
  p_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry jsonb;
  v_profile_id uuid;
  v_amount numeric;
  v_saved integer := 0;
  v_synced integer := 0;
  v_reconfirmation integer := 0;
  v_result jsonb;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator permission required'; end if;
  if jsonb_typeof(coalesce(p_entries, '[]'::jsonb)) <> 'array' then raise exception 'tax entries must be an array'; end if;
  if jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) > 500 then raise exception 'single batch is limited to 500 employees'; end if;

  for v_entry in select value from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    v_profile_id := nullif(v_entry->>'profileId', '')::uuid;
    v_amount := nullif(v_entry->>'amount', '')::numeric;
    if v_profile_id is null or v_amount is null or v_amount < 0 then raise exception 'invalid individual income tax entry'; end if;
    v_result := public.admin_save_payroll_individual_tax_override(v_profile_id, p_payroll_month, v_amount);
    v_saved := v_saved + 1;
    if coalesce((v_result#>>'{payslip,synced}')::boolean, false) then v_synced := v_synced + 1; end if;
    if coalesce((v_result#>>'{payslip,requiresReconfirmation}')::boolean, false) then v_reconfirmation := v_reconfirmation + 1; end if;
  end loop;

  return jsonb_build_object(
    'savedCount', v_saved,
    'syncedPayslipCount', v_synced,
    'reconfirmationCount', v_reconfirmation,
    'month', date_trunc('month', p_payroll_month)::date
  );
end;
$$;

create or replace function public.admin_generate_payroll_payslips(
  p_payroll_month date,
  p_profile_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_payroll_month)::date;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_as_of date;
  v_profile public.profiles;
  v_snapshot jsonb;
  v_existing public.payroll_payslips;
  v_tax numeric;
  v_generated integer := 0;
  v_refreshed integer := 0;
  v_skipped integer := 0;
  v_missing_tax integer := 0;
begin
  if public.current_user_role() <> 'admin' then raise exception '需要管理员权限'; end if;
  if v_month > date_trunc('month', v_today)::date then raise exception '不能生成未来月份的工资单'; end if;
  v_as_of := case when v_month = date_trunc('month', v_today)::date then v_today else (v_month + interval '1 month - 1 day')::date end;

  for v_profile in
    select profile.* from public.profiles profile
    where profile.role in ('staff', 'manager') and profile.is_active and profile.deleted_at is null
      and public.can_admin_manage_attendance_profile(profile.id)
      and (coalesce(cardinality(p_profile_ids), 0) = 0 or profile.id = any(p_profile_ids))
    order by profile.display_name
  loop
    select * into v_existing from public.payroll_payslips
    where profile_id = v_profile.id and payroll_month = v_month for update;
    if v_existing.id is not null and v_existing.status in ('issued', 'confirmed') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_snapshot := public.get_payroll_estimate(v_profile.id, v_as_of);
    select amount into v_tax from public.payroll_individual_tax_overrides
    where profile_id = v_profile.id and payroll_month = v_month;
    if v_tax is null then v_missing_tax := v_missing_tax + 1; end if;
    v_snapshot := public.payroll_snapshot_with_registered_tax(v_snapshot, coalesce(v_tax, 0), v_tax is not null);

    if v_existing.id is null then
      insert into public.payroll_payslips(
        profile_id, store_id, payroll_month, estimate_snapshot, status, issue_source,
        issued_at, issued_by, last_modified_by
      ) values (
        v_profile.id, nullif(v_snapshot->>'primaryStoreId', '')::uuid, v_month,
        v_snapshot, 'draft', 'admin', null, null, auth.uid()
      );
      v_generated := v_generated + 1;
    else
      update public.payroll_payslips set
        store_id = nullif(v_snapshot->>'primaryStoreId', '')::uuid,
        estimate_snapshot = v_snapshot,
        status = 'draft', issue_source = 'admin', issued_at = null, issued_by = null,
        confirmed_at = null, admin_note = '', withdrawn_at = null, withdrawn_by = null,
        last_modified_by = auth.uid(), revision = revision + 1
      where id = v_existing.id;
      v_refreshed := v_refreshed + 1;
    end if;
  end loop;

  if v_generated + v_refreshed + v_skipped = 0 then raise exception '没有可生成工资单的员工'; end if;
  return jsonb_build_object(
    'generatedCount', v_generated,
    'refreshedCount', v_refreshed,
    'skippedSentCount', v_skipped,
    'missingTaxCount', v_missing_tax,
    'month', v_month,
    'asOf', v_as_of
  );
end;
$$;

create or replace function public.issue_payroll_payslips_internal(
  p_payroll_month date,
  p_profile_ids uuid[],
  p_issue_source text,
  p_issued_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_payroll_month)::date;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_as_of date;
  v_profile public.profiles;
  v_snapshot jsonb;
  v_existing public.payroll_payslips;
  v_payslip public.payroll_payslips;
  v_tax numeric;
  v_issued integer := 0;
  v_refreshed integer := 0;
  v_skipped integer := 0;
  v_missing_tax integer := 0;
begin
  if p_issue_source not in ('scheduled', 'admin') then raise exception '工资单发放来源无效'; end if;
  if v_month > date_trunc('month', v_today)::date then raise exception '不能发放未来月份的工资单'; end if;
  if coalesce(cardinality(p_profile_ids), 0) = 0 then
    return jsonb_build_object('issuedCount', 0, 'refreshedCount', 0, 'skippedConfirmedCount', 0, 'missingTaxCount', 0, 'month', v_month);
  end if;
  v_as_of := case when v_month = date_trunc('month', v_today)::date then v_today else (v_month + interval '1 month - 1 day')::date end;

  for v_profile in
    select * from public.profiles
    where id = any(p_profile_ids) and role in ('staff', 'manager') and is_active and deleted_at is null
  loop
    select * into v_existing from public.payroll_payslips
    where profile_id = v_profile.id and payroll_month = v_month for update;
    if v_existing.id is not null and v_existing.status = 'confirmed' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_snapshot := public.get_payroll_estimate(v_profile.id, v_as_of);
    select amount into v_tax from public.payroll_individual_tax_overrides
    where profile_id = v_profile.id and payroll_month = v_month;
    if v_tax is null then v_missing_tax := v_missing_tax + 1; end if;
    v_snapshot := public.payroll_snapshot_with_registered_tax(v_snapshot, coalesce(v_tax, 0), v_tax is not null);

    if v_existing.id is null then
      insert into public.payroll_payslips(profile_id, store_id, payroll_month, estimate_snapshot, status, issue_source, issued_at, issued_by)
      values(v_profile.id, nullif(v_snapshot->>'primaryStoreId', '')::uuid, v_month, v_snapshot, 'issued', p_issue_source, now(), p_issued_by)
      returning * into v_payslip;
      v_issued := v_issued + 1;
    else
      update public.payroll_payslips set
        store_id = nullif(v_snapshot->>'primaryStoreId', '')::uuid,
        estimate_snapshot = v_snapshot,
        status = 'issued', issue_source = p_issue_source, issued_at = now(), issued_by = p_issued_by,
        confirmed_at = null, withdrawn_at = null, withdrawn_by = null, revision = revision + 1
      where id = v_existing.id returning * into v_payslip;
      v_refreshed := v_refreshed + 1;
    end if;

    insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
    values(v_profile.id, v_payslip.store_id, 'payroll_payslip_issued', to_char(v_month, 'YYYY年MM月') || '工资单已发放', '请核对工资单内容，并在“我的薪资”中确认。', 'payroll_payslip', v_payslip.id, 'payroll-payslip:' || v_profile.id || ':' || v_month::text)
    on conflict(dedupe_key) do update set type = excluded.type, title = excluded.title, body = excluded.body, entity_id = excluded.entity_id, is_read = false, read_at = null, created_at = now();
  end loop;

  return jsonb_build_object('issuedCount', v_issued, 'refreshedCount', v_refreshed, 'skippedConfirmedCount', v_skipped, 'missingTaxCount', v_missing_tax, 'month', v_month, 'asOf', v_as_of);
end;
$$;

revoke all on function public.payroll_snapshot_with_registered_tax(jsonb,numeric,boolean) from public, anon, authenticated;
revoke all on function public.sync_registered_tax_to_payroll_payslip(uuid,date,numeric) from public, anon, authenticated;
revoke all on function public.admin_save_payroll_individual_taxes(date,jsonb) from public, anon;
grant execute on function public.admin_save_payroll_individual_taxes(date,jsonb) to authenticated;

comment on function public.admin_save_payroll_individual_taxes(date,jsonb) is
  'Atomically registers actual monthly individual income tax and synchronizes active payslip snapshots.';

create function public.admin_payroll_statistics_inputs(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_result jsonb;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator permission required'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'invalid payroll statistics range'; end if;
  if p_to > v_today then raise exception 'payroll statistics cannot include future dates'; end if;
  if p_to - p_from > 1095 then raise exception 'payroll statistics range is limited to 1096 days'; end if;

  with attendance as (
    select date_trunc('month', daily.attendance_date)::date payroll_month,
      daily.profile_id, daily.store_id,
      count(distinct daily.attendance_date)::numeric attendance_days
    from public.attendance_daily_records daily
    where daily.attendance_date between p_from and p_to and daily.is_attended
    group by 1, 2, 3
  ), overtime as (
    select date_trunc('month', request.overtime_date)::date payroll_month,
      request.profile_id, request.store_id,
      round(sum(request.hours), 2) overtime_hours,
      round(sum(request.hours * coalesce(request.approved_hourly_rate, 0)), 2) overtime_cost
    from public.payroll_overtime_requests request
    where request.overtime_date between p_from and p_to and request.status = 'approved'
    group by 1, 2, 3
  ), work_keys as (
    select payroll_month, profile_id, store_id from attendance
    union
    select payroll_month, profile_id, store_id from overtime
  ), work_rows as (
    select key.payroll_month, key.profile_id, key.store_id,
      coalesce(attendance.attendance_days, 0) attendance_days,
      coalesce(overtime.overtime_hours, 0) overtime_hours,
      coalesce(overtime.overtime_cost, 0) overtime_cost
    from work_keys key
    left join attendance using(payroll_month, profile_id, store_id)
    left join overtime using(payroll_month, profile_id, store_id)
  ), revenues as (
    select revenue.store_id, round(sum(revenue.confirmed_amount), 2) amount
    from public.payroll_store_revenues revenue
    where revenue.revenue_date between p_from and p_to and public.has_store_access(revenue.store_id)
    group by revenue.store_id
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'profiles', coalesce((select jsonb_agg(jsonb_build_object(
      'id', profile.id, 'displayName', profile.display_name, 'username', profile.username,
      'employmentType', profile.employment_type, 'primaryStoreId', profile.store_id
    ) order by profile.display_name)
      from public.profiles profile
      where profile.role in ('staff', 'manager') and profile.is_active and profile.deleted_at is null
        and public.can_admin_manage_attendance_profile(profile.id)), '[]'::jsonb),
    'stores', coalesce((select jsonb_agg(jsonb_build_object(
      'id', store.id, 'name', store.name, 'shortName', store.short_name
    ) order by store.name)
      from public.stores store where store.is_active and public.has_store_access(store.id)), '[]'::jsonb),
    'work', coalesce((select jsonb_agg(jsonb_build_object(
      'payrollMonth', row.payroll_month, 'profileId', row.profile_id, 'storeId', row.store_id,
      'attendanceDays', row.attendance_days, 'overtimeHours', row.overtime_hours,
      'overtimeCost', row.overtime_cost
    ) order by row.payroll_month, row.profile_id, row.store_id) from work_rows row), '[]'::jsonb),
    'revenues', coalesce((select jsonb_agg(jsonb_build_object('storeId', revenue.store_id, 'amount', revenue.amount)) from revenues revenue), '[]'::jsonb),
    'payslips', coalesce((select jsonb_agg(jsonb_build_object(
      'id', payslip.id, 'profileId', payslip.profile_id, 'payrollMonth', payslip.payroll_month,
      'status', payslip.status, 'estimate', payslip.estimate_snapshot
    ) order by payslip.payroll_month, payslip.profile_id)
      from public.payroll_payslips payslip
      where payslip.payroll_month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
        and payslip.status <> 'withdrawn' and public.can_admin_manage_attendance_profile(payslip.profile_id)), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_payroll_statistics_inputs(date,date) from public, anon;
grant execute on function public.admin_payroll_statistics_inputs(date,date) to authenticated;

comment on function public.admin_payroll_statistics_inputs(date,date) is
  'Returns bounded administrator payroll-statistics inputs without exposing per-day row volume.';
